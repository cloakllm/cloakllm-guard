// Service worker: owns detection.
//
// Detection lives here rather than in the content script for one reason: a
// regex pass over a large paste must never run on the page's main thread, or
// the chat box stutters while someone is typing. Measured in the M0 spike
// (PLAN_extension_v01.md): 0.02 ms for a 1 KB message, 1.2 ms for a 63 KB
// paste -- cheap, but not something to put in front of a keystroke.
//
// MV3 service workers are ephemeral. Two consequences are load-bearing here:
//   1. The message listener MUST be registered synchronously at top level, or
//      an event that wakes the worker arrives before the listener exists.
//   2. Module-scope state does not survive a respawn. The detector and the
//      settings are rebuilt on each wake: ~8 ms, dominated by RegexBackend's
//      ReDoS safety corpus re-checking built-ins the SDK's own CI already
//      covers. Acceptable for v0.1.
import { createDetector, detect, summarise } from '../vendor/cloakllm-detect.js';
import { clampForScan } from '../shared/extract.js';
import { record, stats, exportJsonl, clear } from './log.js';
import { load as loadSettings, save as saveSettings, toDetectorConfig, enabledCategories }
  from '../shared/settings.js';

let detector = null;
let active = null;          // Set of categories the user wants reported
let settingsPromise = null;

/**
 * Settings are read once per worker lifetime, not per scan: storage is cheap
 * but not free, and a scan sits in front of a keystroke.
 */
function currentSettings() {
  if (!settingsPromise) settingsPromise = loadSettings();
  return settingsPromise;
}

function getDetector(settings) {
  if (!detector) {
    detector = settings ? createDetector(toDetectorConfig(settings)) : createDetector();
    active = settings ? enabledCategories(settings) : null;
  }
  return detector;
}

/** Drop cached settings and detector so the next scan picks up a change. */
export function invalidate() {
  detector = null;
  active = null;
  settingsPromise = null;
}

/**
 * Scan text and return a PII-FREE summary.
 *
 * The matched values never leave this function. Callers get categories,
 * counts and offsets -- enough to warn a person and to count near-misses,
 * and not enough to reconstruct what they wrote.
 *
 * @param {string} text
 * @param {object} [settings] when omitted, all v0.1 defaults apply
 */
export function scan(text, settings) {
  const t0 = performance.now();
  const { text: scannable, truncated } = clampForScan(text);
  let detections = detect(getDetector(settings), scannable);
  // Post-filter for the shared SDK gates: API_KEY, AWS_KEY and JWT all ride on
  // `detectApiKeys`, so silencing one of them has to happen here rather than in
  // the config, or it would switch off its siblings too.
  if (active) detections = detections.filter((d) => active.has(d.category));
  const summary = summarise(detections);
  return { ...summary, truncated, ms: +(performance.now() - t0).toFixed(3) };
}

/**
 * Tell open tabs to drop cached verdicts after a settings change.
 *
 * Content scripts hold verdicts computed under the OLD settings. Enabling a
 * category would otherwise leave text already judged clean still passing
 * through -- a stale permissive verdict, which is the one kind of staleness
 * that voids the guarantee.
 */
async function notifyTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      chrome.tabs.sendMessage(t.id, { type: 'cloakllm:settingsChanged' },
        () => void chrome.runtime.lastError);
    }
  } catch { /* no tabs to tell; caches also expire as soon as the text changes */ }
}


/**
 * Make an error safe to print.
 *
 * Errors from our own code do not embed what someone typed, but "do not"
 * is an assumption and this is a tool whose entire claim is that your text
 * never leaves your machine or reaches a log. So the assumption is removed
 * rather than relied on: long digit runs and anything email-shaped are
 * stripped before the message is printed.
 *
 * Added after a live run where the worker stopped answering and SIX
 * catch blocks in this file discarded the reason, leaving nothing in any
 * console to diagnose from. A silent catch in the component that makes the
 * safety decision is the same failure as a silent fail-open, one layer down.
 */
export function safeError(err) {
  const raw = err && err.message ? String(err.message) : String(err);
  return raw
    .replace(/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\d{4,}/g, '[digits]')
    .slice(0, 300);
}

function reportFailure(what, err) {
  console.warn(`[CloakLLM Guard] ${what} failed: ${err && err.name ? err.name : 'Error'}: ${safeError(err)}`);
}

// --- wiring ---------------------------------------------------------------
// Guarded so this module can also be imported by tests outside an extension.
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return false;

    switch (msg.type) {
      // Findings-log traffic. Only warnings are recorded; a clean send writes
      // nothing, because logging every message someone types is precisely the
      // product this is not.
      case 'cloakllm:record': {
        currentSettings().then((s) => {
          if (!s.logEnabled) return { seq: null };
          const host = sender && sender.url ? new URL(sender.url).host : null;
          return record(msg.summary, { host, trigger: msg.trigger, action: msg.action });
        })
          .then((entry) => sendResponse({ ok: true, seq: entry ? entry.seq : null }))
          .catch((err) => {
            // A log failure must never break the guard itself.
            console.warn(`[CloakLLM Guard] could not record finding: ${err.message}`);
            sendResponse({ ok: false });
          });
        return true;
      }

      case 'cloakllm:stats':
        stats().then(sendResponse)
          .catch((err) => { reportFailure('stats', err); sendResponse(null); });
        return true;

      case 'cloakllm:export':
        exportJsonl(msg.epoch).then(sendResponse)
          .catch((err) => { reportFailure('export', err); sendResponse(null); });
        return true;

      case 'cloakllm:clear':
        clear().then(() => sendResponse({ ok: true }))
          .catch((err) => { reportFailure('clear', err); sendResponse({ ok: false }); });
        return true;

      case 'cloakllm:getSettings':
        currentSettings().then(sendResponse)
          .catch((err) => { reportFailure('getSettings', err); sendResponse(null); });
        return true;

      case 'cloakllm:setSettings':
        saveSettings(msg.patch)
          .then(async (next) => { invalidate(); await notifyTabs(); sendResponse(next); })
          .catch((err) => { reportFailure('saveSettings', err); sendResponse(null); });
        return true;

      case 'cloakllm:scan':
        currentSettings().then((settings) => {
          const result = scan(typeof msg.text === 'string' ? msg.text : '', settings);

          // Log the SUMMARY only -- never the matched text. Keeping that
          // discipline from the first commit is what makes "we never retain
          // what you wrote" true by construction rather than by intention.
          if (result.total > 0) {
            const where = sender && sender.url ? new URL(sender.url).host : 'unknown';
            console.log(
              `[CloakLLM Guard] ${result.total} finding(s) on ${where} via ${msg.trigger}: `
              + result.categories.map((c) => `${c} x${result.byCategory[c].count}`).join(', ')
              + ` (${result.ms} ms${result.truncated ? ', input truncated' : ''})`
            );
          }
          sendResponse(result);
        }).catch((err) => { reportFailure('scan', err); sendResponse(null); });
        return true;

      default:
        return false;
    }
  });
}
