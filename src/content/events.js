// Content script (ISOLATED world): watches for send-intent and, when the text
// carries personal data, stops the send and asks.
//
// M2 semantics, and the reason they are shaped this way:
//
//   PASTE  -> scan only, never a dialog. Pasting is not sending; a person may
//             well paste a record and then edit it down. Interrupting there
//             would also mean warning twice for one mistake (M1 showed exactly
//             this: paste logged, then Enter logged the same text again), which
//             is the false-positive-fatigue failure wearing a different hat.
//   INPUT  -> debounced scan, purely to keep the cache warm.
//   SEND   -> the gate. Enter or submit with findings is blocked, and the
//             person decides.
//
// A clean send is never intercepted: if the cache says the current text has no
// findings, this script does nothing at all to the event. That keeps the
// common path completely free of any risk of breaking the site.
import { textFromPaste, textFromComposer, isSendKey } from '../shared/extract.js';
import { adapterFor, findComposer, findSendButton, resolveComposer, healthLine } from '../sites/index.js';
import { lookup, acknowledge, scanAndCache, scheduleScan, invalidateVerdicts } from './scan-cache.js';
import { showWarning, isOpen } from './warn-ui.js';

const adapter = adapterFor(location.host);

function composerText(target) {
  const el = target && (target.value !== undefined || target.isContentEditable)
    ? target
    : findComposer(document, adapter);
  return textFromComposer(el);
}

/** Resume a send the person confirmed. */
function resumeSend() {
  const btn = findSendButton(document, adapter);
  if (btn) { btn.click(); return true; }
  // Fallback: synthetic Enter on the composer. Less reliable (isTrusted is
  // false and some handlers check it), so it is the second choice, not the
  // first.
  const el = findComposer(document, adapter);
  if (!el) return false;
  el.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true,
  }));
  return true;
}

/**
 * Decide what to do about a send.
 * @returns {boolean} true if the send should be blocked
 */
function shouldBlock(text) {
  if (!text || !text.trim()) return false;
  const { state } = lookup(text);
  // 'clean' and 'acknowledged' pass straight through untouched.
  // 'findings' and 'unknown' are both blocked -- claiming clean on an unknown
  // would silently void the guarantee for anyone who types fast.
  return state === 'findings' || state === 'unknown';
}

async function handleBlockedSend(text, trigger) {
  let { state, summary } = lookup(text);

  if (state === 'unknown') {
    summary = await scanAndCache(text, 'send');
    if (!summary) {
      // Scan failed outright. Do not hold the person's send hostage to our
      // own error -- release it and stay quiet. Failing closed here would
      // mean a broken worker silently bricks their chat.
      console.warn('[CloakLLM Guard] scan unavailable, send released unchecked');
      acknowledge(text);
      resumeSend();
      return;
    }
    if (summary.total === 0) { resumeSend(); return; }
  }

  const choice = await showWarning(summary);

  // Record the decision, not the text. "heeded" rather than "edited": we know
  // they did not send, and claiming to know they then fixed it would require
  // watching what they type next -- which we do not do.
  chrome.runtime.sendMessage({
    type: 'cloakllm:record',
    summary: { total: summary.total, byCategory: summary.byCategory },
    trigger,
    action: choice === 'send' ? 'sent_anyway' : 'heeded',
  }, () => void chrome.runtime.lastError);

  if (choice === 'send') {
    acknowledge(text);
    resumeSend();
  }
  // 'cancel' -> nothing happens; the text is still in the box, ready to edit.
}

// --- paste: scan only, no dialog ------------------------------------------
document.addEventListener('paste', (ev) => {
  const pasted = textFromPaste(ev.clipboardData);
  if (!pasted || !pasted.trim()) return;
  // Scan the composer's resulting text, not the clipboard alone: the warning
  // at send time is about everything in the box.
  setTimeout(() => {
    const text = composerText(ev.target);
    scanAndCache(text || pasted, 'paste');
  }, 0);
}, true);

// --- typing: keep the cache warm ------------------------------------------
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (!t || (t.value === undefined && !t.isContentEditable)) return;
  scheduleScan(textFromComposer(t), 'input');
}, true);

// --- send: the gate -------------------------------------------------------
document.addEventListener('keydown', (ev) => {
  if (isOpen()) {
    // Our own dialog is up; never let a keystroke reach the site underneath.
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopImmediatePropagation(); }
    return;
  }
  if (!isSendKey(ev)) return;
  const text = composerText(ev.target);
  if (!shouldBlock(text)) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  handleBlockedSend(text, 'enter');
}, true);

document.addEventListener('submit', (ev) => {
  if (isOpen()) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
  const el = findComposer(ev.target || document, adapter) || findComposer(document, adapter);
  const text = textFromComposer(el);
  if (!shouldBlock(text)) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  handleBlockedSend(text, 'submit');
}, true);

// --- settings changes -----------------------------------------------------
// A verdict cached under the old settings can be stale-permissive, so drop it.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'cloakllm:settingsChanged') invalidateVerdicts();
});

// --- adapter health -------------------------------------------------------
// Selector drift is invisible by nature: the site keeps working, the extension
// keeps running, and it quietly stops seeing what people type. These sites
// hydrate late, so re-check a few times before concluding anything, then say
// plainly which of the three states we are in.
(function reportHealth(attempt = 0) {
  const resolution = resolveComposer(document, adapter);
  if (!resolution.via && attempt < 6) {
    setTimeout(() => reportHealth(attempt + 1), 1000);
    return;
  }
  const line = healthLine(location.host, adapter, resolution);
  if (line.startsWith('WARNING')) console.warn(`[CloakLLM Guard] ${line}`);
  else console.log(`[CloakLLM Guard] ${line}`);
})();

