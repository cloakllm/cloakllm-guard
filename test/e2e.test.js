// End-to-end behaviour of the built content script, driven through a fake DOM.
//
// This is the suite that matters most, because the two properties it checks
// cannot be inferred from unit tests:
//   1. a CLEAN send is never touched -- no preventDefault, nothing intercepted,
//      so there is no way for this extension to break a normal message
//   2. a DIRTY send IS stopped, and only resumes when the person says so
//
// It loads the actual bundled dist/content.js, not the source modules, so the
// esbuild output is what gets exercised.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

import { scan } from '../src/worker/index.js';

const CODE = readFileSync(new URL('../dist/content.js', import.meta.url), 'utf8');

const CLEAN = 'explain the difference between a mutex and a semaphore';
const DIRTY = 'please refund the card 5500 0000 0000 0004 for marie@example.com';

/** Minimal DOM good enough for the content script and the interstitial. */
function makeHarness() {
  const handlers = {};
  const logs = [];
  const sentMessages = [];
  const messageListeners = [];
  const sendButton = { disabled: false, clicks: 0, click() { this.clicks += 1; } };
  const composer = { value: '', isContentEditable: false };
  const stubs = new Map();
  const shadow = {
    set innerHTML(_) { /* markup is not asserted on */ },
    querySelector(sel) {
      if (!stubs.has(sel)) {
        stubs.set(sel, {
          textContent: '',
          listeners: {},
          addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
          focus() { this.focused = true; },
        });
      }
      return stubs.get(sel);
    },
  };

  const document = {
    addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); },
    removeEventListener: () => {},
    createElement: () => ({
      style: {}, id: '',
      attachShadow: () => shadow,
      remove() { this.removed = true; },
    }),
    documentElement: { appendChild: () => {} },
    querySelector(sel) {
      if (sel.includes('send-button') || sel.includes('submit')) return sendButton;
      if (sel === '#prompt-textarea' || sel === 'textarea' || sel.includes('contenteditable')) {
        return composer;
      }
      return null;
    },
  };

  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')) },
    location: { host: 'chatgpt.com' },
    URL, setTimeout, clearTimeout, Promise,
    KeyboardEvent: class { constructor(type, init) { Object.assign(this, init, { type }); } },
    document,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) {
          sentMessages.push(msg);
          // Only scan messages get a verdict back; record/stats are fire-and-forget
          // from the content script's point of view.
          if (cb) cb(msg.type === 'cloakllm:scan' ? scan(msg.text) : { ok: true });
        },
        // The content script listens for settings changes so it can drop
        // stale-permissive cached verdicts.
        onMessage: { addListener: (fn) => { messageListeners.push(fn); } },
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: 'content.js' });

  return { handlers, logs, sentMessages, sendButton, composer, stubs, sandbox, messageListeners };
}

/** Make a keydown event object that records whether it was suppressed. */
function enterEvent(target) {
  return {
    key: 'Enter', target,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- wiring --

test('registers paste, input, keydown and submit handlers', () => {
  const h = makeHarness();
  for (const type of ['paste', 'input', 'keydown', 'submit']) {
    assert.ok(h.handlers[type], `missing ${type} handler`);
  }
});

test('paste scans but never opens a dialog', async () => {
  // Pasting is not sending. Warning here would also mean warning twice for one
  // mistake -- the duplicate M1 surfaced on the live site.
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.paste[0]({ clipboardData: { getData: () => DIRTY }, target: h.composer });
  await tick(10);

  assert.ok(h.sentMessages.some((m) => m.trigger === 'paste'), 'paste should scan');
  assert.equal(h.stubs.size, 0, 'no interstitial should have been built');
});

// ------------------------------------------------------------ clean send --

test('a CLEAN send is not intercepted at all', async () => {
  const h = makeHarness();
  h.composer.value = CLEAN;
  h.handlers.input[0]({ target: h.composer });
  await tick(200); // let the debounce fire and warm the cache

  const ev = enterEvent(h.composer);
  h.handlers.keydown[0](ev);

  assert.equal(ev.prevented, false, 'a clean send must not be blocked');
  assert.equal(ev.stopped, false, 'a clean send must reach the site untouched');
  assert.equal(h.sendButton.clicks, 0, 'we must not click send ourselves on the clean path');
});

// ------------------------------------------------------------ dirty send --

test('a DIRTY send is blocked and raises the warning', async () => {
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);

  const ev = enterEvent(h.composer);
  h.handlers.keydown[0](ev);
  await tick(10);

  assert.equal(ev.prevented, true, 'a send carrying PII must be blocked');
  assert.equal(ev.stopped, true, "the site's own handler must not see it");
  assert.ok(h.stubs.has('.send') && h.stubs.has('.cancel'), 'interstitial should be built');

  const shown = h.stubs.get('.found').textContent;
  assert.match(shown, /credit card number/);
  assert.ok(!shown.includes('5500 0000 0000 0004'), 'the dialog must not show the value');
  assert.ok(!shown.replace(/\D/g, '').includes('5500000000000004'), 'nor its digits');
});

test('cancelling leaves the text alone and sends nothing', async () => {
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);
  h.handlers.keydown[0](enterEvent(h.composer));
  await tick(10);

  h.stubs.get('.cancel').listeners.click[0]();
  await tick(10);

  assert.equal(h.sendButton.clicks, 0, 'cancel must not send');
  assert.equal(h.composer.value, DIRTY, 'the text stays in the box for editing');
});

test('"send anyway" resumes the send, and the same text is not re-warned', async () => {
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);
  h.handlers.keydown[0](enterEvent(h.composer));
  await tick(10);

  h.stubs.get('.send').listeners.click[0]();
  await tick(10);
  assert.equal(h.sendButton.clicks, 1, 'confirming must actually send');

  // Pressing Enter again on the same text must pass straight through.
  const again = enterEvent(h.composer);
  h.handlers.keydown[0](again);
  assert.equal(again.prevented, false, 'acknowledged text must not be re-warned');
});

test('editing after an acknowledgement brings the guard back', async () => {
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);
  h.handlers.keydown[0](enterEvent(h.composer));
  await tick(10);
  h.stubs.get('.send').listeners.click[0]();
  await tick(10);

  // A DIFFERENT card must not inherit the previous "send anyway".
  h.composer.value = 'and also 4111 1111 1111 1111';
  h.handlers.input[0]({ target: h.composer });
  await tick(200);
  const ev = enterEvent(h.composer);
  h.handlers.keydown[0](ev);
  assert.equal(ev.prevented, true, 'a new value must be warned about again');
});

// --------------------------------------------------------------- settings --

test('a settings change drops the cached verdict', async () => {
  // The stale-permissive case: text judged clean under the old settings must
  // not keep sailing through after a category is switched on. This is the one
  // kind of staleness that voids the guarantee.
  const h = makeHarness();
  h.composer.value = CLEAN;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);

  const before = enterEvent(h.composer);
  h.handlers.keydown[0](before);
  assert.equal(before.prevented, false, 'cached clean verdict lets it through');

  assert.equal(h.messageListeners.length, 1, 'content script must listen for settings changes');
  h.messageListeners[0]({ type: 'cloakllm:settingsChanged' });

  const after = enterEvent(h.composer);
  h.handlers.keydown[0](after);
  assert.equal(after.prevented, true, 'after the change the verdict must be re-derived');
});

test('an acknowledgement survives a settings change', async () => {
  // Acknowledgements are a person's explicit decision about specific text, not
  // a detection result, so they are not invalidated.
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);
  h.handlers.keydown[0](enterEvent(h.composer));
  await tick(10);
  h.stubs.get('.send').listeners.click[0]();
  await tick(10);

  h.messageListeners[0]({ type: 'cloakllm:settingsChanged' });

  const again = enterEvent(h.composer);
  h.handlers.keydown[0](again);
  assert.equal(again.prevented, false, 'the person already decided about this text');
});

test('a warning decision is reported for the log', async () => {
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);
  h.handlers.keydown[0](enterEvent(h.composer));
  await tick(10);
  h.stubs.get('.cancel').listeners.click[0]();
  await tick(10);

  const rec = h.sentMessages.find((m) => m.type === 'cloakllm:record');
  assert.ok(rec, 'the decision must reach the worker');
  assert.equal(rec.action, 'heeded');
  assert.equal(rec.trigger, 'enter');
  assert.ok(rec.summary.byCategory.CREDIT_CARD, 'counts travel');
  // And the text itself must not.
  const serialised = JSON.stringify(rec);
  assert.ok(!serialised.includes('5500 0000 0000 0004'));
  assert.ok(!serialised.replace(/\D/g, '').includes('5500000000000004'));
});

// --------------------------------------------------------- failure modes --

test('an unscanned send is blocked pending a scan, then released if clean', async () => {
  // Typing fast enough to beat the debounce must not create a hole.
  const h = makeHarness();
  h.composer.value = CLEAN;

  const ev = enterEvent(h.composer);
  h.handlers.keydown[0](ev);
  assert.equal(ev.prevented, true, 'unknown text must be blocked, not assumed clean');

  await tick(10);
  assert.equal(h.sendButton.clicks, 1, 'once scanned and clean, the send resumes');
});

test('a broken worker releases the send rather than bricking the chat', async () => {
  // Failing closed here would mean our own error silently stops someone from
  // using their chat at all. Release, and say so.
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.sandbox.chrome.runtime.sendMessage = (msg, cb) => cb(undefined);

  h.handlers.keydown[0](enterEvent(h.composer));
  await tick(10);

  assert.equal(h.sendButton.clicks, 1, 'the send must not be held hostage to our error');
  assert.ok(h.logs.some((l) => l.includes('scan unavailable')), 'and it must be logged');
});

