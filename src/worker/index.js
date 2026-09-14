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
//   2. Module-scope state does not survive a respawn. The detector is rebuilt
//      on each wake: ~8 ms, dominated by RegexBackend's ReDoS safety corpus
//      re-checking built-ins the SDK's own CI already covers. Acceptable for
//      v0.1; skipping that check for built-ins is a known optimisation.
import { createDetector, detect, summarise } from '../vendor/cloakllm-detect.js';
import { clampForScan } from '../shared/extract.js';
import { record, stats, exportJsonl, clear } from './log.js';

let detector = null;
function getDetector() {
  if (!detector) detector = createDetector();
  return detector;
}

/**
 * Scan text and return a PII-FREE summary.
 *
 * The matched values never leave this function. Callers get categories,
 * counts and offsets -- enough to warn a person and to count near-misses,
 * and not enough to reconstruct what they wrote.
 */
export function scan(text) {
  const t0 = performance.now();
  const { text: scannable, truncated } = clampForScan(text);
  const detections = detect(getDetector(), scannable);
  const summary = summarise(detections);
  return { ...summary, truncated, ms: +(performance.now() - t0).toFixed(3) };
}

// --- wiring ---------------------------------------------------------------
// Guarded so this module can also be imported by tests outside an extension.
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return false;

    // Findings-log traffic. Only warnings are recorded; a clean send writes
    // nothing, because logging every message someone types is precisely the
    // product this is not.
    if (msg.type === 'cloakllm:record') {
      const host = sender && sender.url ? new URL(sender.url).host : null;
      record(msg.summary, { host, trigger: msg.trigger, action: msg.action })
        .then((entry) => sendResponse({ ok: true, seq: entry.seq }))
        .catch((err) => {
          // A log failure must never break the guard itself.
          console.warn(`[CloakLLM Guard] could not record finding: ${err.message}`);
          sendResponse({ ok: false });
        });
      return true;
    }
    if (msg.type === 'cloakllm:stats') {
      stats().then(sendResponse).catch(() => sendResponse(null));
      return true;
    }
    if (msg.type === 'cloakllm:export') {
      exportJsonl(msg.epoch).then(sendResponse).catch(() => sendResponse(null));
      return true;
    }
    if (msg.type === 'cloakllm:clear') {
      clear().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (msg.type !== 'cloakllm:scan') return false;

    const result = scan(typeof msg.text === 'string' ? msg.text : '');

    // M1 is detect-and-log: no UI yet. Log the SUMMARY only -- never the
    // matched text. Keeping that discipline from the first commit is what
    // makes "we never retain what you wrote" true by construction rather
    // than by intention.
    if (result.total > 0) {
      const where = sender && sender.url ? new URL(sender.url).host : 'unknown';
      console.log(
        `[CloakLLM Guard] ${result.total} finding(s) on ${where} via ${msg.trigger}: `
        + result.categories.map((c) => `${c} x${result.byCategory[c].count}`).join(', ')
        + ` (${result.ms} ms${result.truncated ? ', input truncated' : ''})`
      );
    }

    sendResponse(result);
    return true;
  });
}
