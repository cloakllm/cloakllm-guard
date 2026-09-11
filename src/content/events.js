// Content script (ISOLATED world): captures send-intent and hands the text to
// the service worker for scanning.
//
// Scans on INTENT, never per keystroke. Three triggers cover how text actually
// reaches these boxes:
//   paste  -- the dominant shadow-AI vector, and the only one where we see the
//             text before it is even in the DOM
//   Enter  -- the usual send
//   submit -- the button, and anything the site wires to a real form
//
// M1 is detect-and-log. Nothing is blocked, nothing is shown to the user, and
// no value ever leaves the browser: the text goes to this extension's own
// service worker over chrome.runtime and no further.
import { textFromPaste, textFromComposer, isSendKey } from '../shared/extract.js';
import { adapterFor, findComposer } from '../sites/index.js';

const adapter = adapterFor(location.host);

function report(trigger, text) {
  if (!text || !text.trim()) return;
  chrome.runtime.sendMessage({ type: 'cloakllm:scan', trigger, text }, (result) => {
    // The worker may be asleep or the extension reloading; neither is fatal
    // for M1. Reading lastError suppresses the "unchecked runtime.lastError"
    // console noise.
    if (chrome.runtime.lastError) return;
    if (result && result.total > 0) {
      console.log(
        `[CloakLLM Guard] ${trigger}: `
        + result.categories.map((c) => `${c} x${result.byCategory[c].count}`).join(', ')
      );
    }
  });
}

// 1. Paste. Capture phase so we see it before the site's own handler runs --
//    at M2 this is where the interstitial will need to intercept.
document.addEventListener('paste', (ev) => {
  report('paste', textFromPaste(ev.clipboardData));
}, true);

// 2. Enter-to-send. Read the composer the event came from where possible;
//    fall back to the site adapter's selectors.
document.addEventListener('keydown', (ev) => {
  if (!isSendKey(ev)) return;
  const el = ev.target && (ev.target.value !== undefined || ev.target.isContentEditable)
    ? ev.target
    : findComposer(document, adapter);
  report('enter', textFromComposer(el));
}, true);

// 3. Form submit, for the send button and keyboard-free paths.
document.addEventListener('submit', (ev) => {
  const el = findComposer(ev.target || document, adapter) || findComposer(document, adapter);
  report('submit', textFromComposer(el));
}, true);

console.log(
  `[CloakLLM Guard] watching ${location.host}`
  + (adapter ? ` (adapter: ${adapter.id})` : ' (no adapter, generic selectors)')
);
