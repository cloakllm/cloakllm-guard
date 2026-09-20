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
import {
  adapterFor, findComposer, findSendButton, resolveComposer, healthLine,
  isSendTarget,
} from '../sites/index.js';
import {
  lookup, acknowledge, scanAndCache, scheduleScan, invalidateVerdicts,
  isContextInvalidated,
} from './scan-cache.js';
import { showWarning, showUnavailable, isOpen, isOwnEvent } from './warn-ui.js';

const adapter = adapterFor(location.host);

function composerText(target) {
  const el = target && (target.value !== undefined || target.isContentEditable)
    ? target
    : findComposer(document, adapter);
  return textFromComposer(el);
}

// True only while we are re-dispatching the person's own send after they
// confirmed it. Every gate below checks this FIRST and stands aside.
//
// Without it the click path eats itself: resumeSend() calls btn.click(),
// our own capture listener sees that click, and blocks the very send it
// was asked to let through. Synchronous, because btn.click() dispatches
// synchronously.
let resuming = false;

/** Resume a send the person confirmed. */
function resumeSend() {
  resuming = true;
  try {
    return dispatchSend();
  } finally {
    resuming = false;
  }
}

function dispatchSend() {
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

// One send gesture can fire several events -- pointerdown then click, or a
// click that a site turns into a submit. Without this, one press of the
// button would stack two or three dialogs on top of each other. Set
// synchronously at the moment we decide to block, so it is already true by
// the time the next event in the same gesture arrives.
let handling = false;

async function handleBlockedSend(text, trigger) {
  handling = true;
  try {
    await runBlockedSend(text, trigger);
  } finally {
    handling = false;
  }
}

async function runBlockedSend(text, trigger) {
  let { state, summary } = lookup(text);

  if (state === 'unknown') {
    summary = await scanAndCache(text, 'send');
    if (!summary) {
      // The scan failed, after a retry. The old behaviour here was to
      // console.warn and send -- which on a live run released a message
      // containing a card number with nothing visible to show for it,
      // while the extension carried on reporting that it was watching the
      // page. That is the exact failure this product exists to prevent,
      // produced by the product itself.
      //
      // Still fail-open on the ACTION: "Send anyway" is right there and a
      // broken worker must never brick someone's chat. But not on the
      // INFORMATION. If we could not check, only the person can decide,
      // and they cannot decide something nobody told them about.
      const reason = isContextInvalidated() ? 'reloaded' : 'unavailable';
      console.warn(`[CloakLLM Guard] scan unavailable (${reason}); asking before sending`);
      const proceed = await showUnavailable(reason);
      chrome.runtime.sendMessage({
        type: 'cloakllm:record',
        summary: { total: 0, byCategory: {} },
        trigger,
        action: proceed === 'send' ? 'sent_unchecked' : 'heeded_unchecked',
      }, () => void chrome.runtime.lastError);
      if (proceed === 'send') {
        acknowledge(text);
        resumeSend();
      }
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
  if (resuming) return;          // our own synthetic Enter, on their behalf
  // Enter on a focused dialog button is how a keyboard user answers the
  // warning. Blocking it left them with no way to confirm at all -- worse
  // than the mouse case, since the dialog focuses its own button on open.
  if (isOwnEvent(ev)) return;
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
  if (resuming) return;          // the resumed click may submit a form
  if (isOpen()) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
  if (handling) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
  const el = findComposer(ev.target || document, adapter) || findComposer(document, adapter);
  const text = textFromComposer(el);
  if (!shouldBlock(text)) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  handleBlockedSend(text, 'submit');
}, true);

// --- send: the button ------------------------------------------------------
// Added after an external review found the claude.ai send button was never
// intercepted while Enter was. The cause was not a stale selector: there was
// no click listener at all. ChatGPT's composer is a real <form>, so its
// button fired `submit` and was caught by the handler above -- which made
// the gap invisible on the one site anyone had tested.
//
// This matters more than a missing path usually would. A guard that is
// fail-open on the most common way people send is worse than no guard,
// because the dialog on the Enter path teaches someone the extension is
// watching and they stop checking their own prompts.
//
// pointerdown is covered as well as click, because a site that acts on
// pointerdown would otherwise have sent before our click handler ran. Both
// go through the same `handling` guard, so one gesture raises one dialog.
function onSendClick(ev) {
  if (resuming) return;          // the person's own confirmed send
  // Our own dialog's buttons. Must come BEFORE the isOpen() block below,
  // which is what was swallowing them -- see isOwnEvent().
  if (isOwnEvent(ev)) return;
  if (isOpen() || handling) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    return;
  }
  // Only primary, unmodified clicks. Ctrl+click or a middle click is not a
  // send, and intercepting them would break ordinary browsing.
  if (ev.button !== undefined && ev.button !== 0) return;
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
  if (!isSendTarget(ev.target, adapter)) return;

  const text = textFromComposer(findComposer(document, adapter));
  if (!shouldBlock(text)) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  handleBlockedSend(text, 'click');
}

document.addEventListener('pointerdown', onSendClick, true);
document.addEventListener('click', onSendClick, true);

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

