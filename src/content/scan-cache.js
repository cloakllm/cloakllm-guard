// Keeps a scan result warm so the Enter handler can decide SYNCHRONOUSLY.
//
// This is the load-bearing constraint of M2. To stop a send we must call
// preventDefault before the site's own handler runs, and scanning is async (a
// round trip to the service worker). We cannot await inside the keydown
// handler. So: scan continuously as the person types or pastes, and consult
// the cache at Enter.
//
// The risk profile that falls out of this is the one we want:
//   - text matches the cache and is CLEAN  -> never intercepted at all, zero
//     chance of breaking a normal send
//   - text matches the cache and has findings -> blocked, warning shown
//   - cache is stale (typed and hit Enter inside the debounce window) ->
//     blocked pending a scan, then released or warned
// Blocking on "unknown" is the fail-closed choice, and it costs a few ms.
//
// Nothing here stores text. The cache key is a hash; the value is a summary of
// categories and counts.
import { hashText } from '../shared/hash.js';

const DEBOUNCE_MS = 150;

/** @type {{ hash: string, summary: any } | null} */
let cached = null;
/** Hashes the person has already said "send anyway" to. */
const acknowledged = new Set();
let timer = null;

/** Ask the service worker to scan. Resolves to a summary. */
export function requestScan(text, trigger) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'cloakllm:scan', trigger, text }, (result) => {
      if (chrome.runtime.lastError || !result) {
        // Worker asleep or extension reloading. Resolve as "unknown" rather
        // than "clean" -- claiming clean on an error is the one failure that
        // silently voids the guarantee.
        resolve(null);
        return;
      }
      resolve(result);
    });
  });
}

/** Scan now and populate the cache. */
export async function scanAndCache(text, trigger) {
  const summary = await requestScan(text, trigger);
  if (summary) cached = { hash: hashText(text), summary };
  return summary;
}

/** Debounced variant, for input events. */
export function scheduleScan(text, trigger) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; scanAndCache(text, trigger); }, DEBOUNCE_MS);
}

/**
 * Synchronous lookup used by the Enter handler.
 * @returns {{ state: 'clean'|'findings'|'acknowledged'|'unknown', summary?: any }}
 */
export function lookup(text) {
  const hash = hashText(text);
  if (acknowledged.has(hash)) return { state: 'acknowledged' };
  if (!cached || cached.hash !== hash) return { state: 'unknown' };
  if (cached.summary.total === 0) return { state: 'clean' };
  return { state: 'findings', summary: cached.summary };
}

/**
 * Record that the person chose to send this text anyway.
 *
 * Scoped to the exact text: edit it and the warning comes back, which is
 * right -- "I meant to send that card" must not silently cover a different
 * card pasted a minute later.
 */
export function acknowledge(text) {
  acknowledged.add(hashText(text));
}

/** Test seam. */
export function _reset() {
  cached = null;
  acknowledged.clear();
  if (timer) { clearTimeout(timer); timer = null; }
}
