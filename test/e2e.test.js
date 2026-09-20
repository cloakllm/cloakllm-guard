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
  // `closest` matters now that clicks are intercepted: a real click lands on
  // the icon inside the button, never the button itself, so the handler walks
  // up from the target. Modelled the way the DOM behaves -- this stub answers
  // to the selectors a send control actually carries.
  const sendButton = {
    disabled: false,
    clicks: 0,
    click() {
      // A real button dispatches a click that our own CAPTURE listener sees
      // before the site's own handler does. If we stop propagation there,
      // the site never learns about the send -- so `clicks` counts sends the
      // site actually received, not sends we attempted.
      //
      // Counting before dispatch (the obvious way to write this) made the
      // resume-loop test below pass whether or not the guard existed, which
      // is worse than not having the test.
      const ev = clickEventOn(this);
      for (const fn of (handlers.click || [])) fn(ev);
      if (!ev.stopped) this.clicks += 1;
    },
    closest(sel) {
      return /send|submit/i.test(sel) ? this : null;
    },
  };
  const composer = { value: '', isContentEditable: false };
  const stubs = new Map();
  let host = null;              // the shadow HOST, set when the dialog is built
  const shadow = {
    set innerHTML(_) { /* markup is not asserted on */ },
    querySelector(sel) {
      if (!stubs.has(sel)) {
        stubs.set(sel, {
          textContent: '',
          listeners: {},
          addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
          focus() { this.focused = true; },
          /**
           * Click this control the way a browser would.
           *
           * Calling `listeners.click[0]()` directly -- the obvious way, and
           * what every test here used to do -- skips the part that matters.
           * A real click inside the dialog is seen FIRST by our own
           * document-level capture listeners, retargeted to the shadow host
           * because the root is closed, and only reaches the button if they
           * let it through. Ours did not: the send gate blocks every click
           * while a warning is open, so it swallowed the warning's own
           * buttons and a flagged message could not be sent at all. Every
           * assertion in this file passed throughout.
           */
          click() {
            // Outside the shadow tree the event is retargeted to the host.
            const outer = clickEventOn(host);
            for (const fn of (handlers.click || [])) fn(outer);
            if (outer.stopped) return false;
            // Inside it, the listener sees the real element.
            const inner = clickEventOn(this, { currentTarget: this });
            for (const fn of (this.listeners.click || [])) fn(inner);
            return true;
          },
        });
      }
      return stubs.get(sel);
    },
  };

  const document = {
    addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); },
    removeEventListener: () => {},
    createElement: () => {
      // Kept, because a click inside a CLOSED shadow root retargets to this
      // element by the time a document-level listener sees it -- which is
      // both how the bug above happened and how the fix recognises its own
      // dialog. warn-ui sets `id` to the host id right after this returns.
      host = {
        style: {}, id: '',
        attachShadow: () => shadow,
        remove() { this.removed = true; },
      };
      return host;
    },
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
        // A live content script always has this. Its ABSENCE is precisely
        // how an orphaned script (extension reloaded under an open tab)
        // is detected, so the harness has to model it or every test runs
        // as if the extension had just been reloaded.
        id: 'cloakllm-guard-test',
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

/** A left-click, the way a person sends by pressing the button. */
function clickEventOn(target, over = {}) {
  return {
    type: 'click', target, button: 0,
    ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
    ...over,
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

  h.stubs.get('.cancel').click();
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

  h.stubs.get('.send').click();
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
  h.stubs.get('.send').click();
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
  h.stubs.get('.send').click();
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
  h.stubs.get('.cancel').click();
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

test('a broken worker ASKS before sending, and never releases silently', async () => {
  // Rewritten 2026-09-20. This test used to assert the opposite -- that a
  // failed scan released the send with only a console.warn -- and a live run
  // on claude.ai showed what that means in practice: a message containing a
  // card number went to the model, with nothing visible to show for it,
  // while the extension carried on reporting that it was watching the page.
  // The product's own failure mode producing the exact leak it exists to
  // prevent.
  //
  // Fail-open on the ACTION is still right: "Send anyway" is one click away
  // and a broken worker must never brick someone's chat. Fail-open on the
  // INFORMATION is not. If we could not check, only the person can decide.
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.sandbox.chrome.runtime.sendMessage = (msg, cb) => { if (cb) cb(undefined); };

  h.handlers.keydown[0](enterEvent(h.composer));
  await tick(120);   // long enough for the retry

  assert.equal(h.sendButton.clicks, 0, 'nothing may be sent before the person answers');
  assert.ok(h.stubs.size > 0, 'the person must be told we could not check');
  assert.ok(h.logs.some((l) => l.includes('scan unavailable')), 'and it must be logged');
});

test('after being told, "send anyway" still works', async () => {
  // The other half: being honest must not become bricking the chat.
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.sandbox.chrome.runtime.sendMessage = (msg, cb) => { if (cb) cb(undefined); };

  h.handlers.keydown[0](enterEvent(h.composer));
  await tick(120);

  let control = null;
  for (const [sel, el] of h.stubs) {
    if (/send/i.test(sel) && el.listeners && el.listeners.click) control = el;
  }
  assert.ok(control, 'the dialog must offer a way through');
  for (const fn of control.listeners.click) fn({});
  await tick(20);

  assert.equal(h.sendButton.clicks, 1, 'the person can always proceed');
});

test('the scan is retried once before giving up', async () => {
  // MV3 evicts a service worker after about thirty seconds idle, and the
  // first message after eviction can fail while Chrome is still waking it.
  // Without a retry that transient becomes a dialog on an ordinary send --
  // and a dialog people see when nothing is wrong is one they learn to
  // click through, which is how this kind of tool dies.
  const h = makeHarness();
  h.composer.value = DIRTY;
  let attempts = 0;
  const real = h.sandbox.chrome.runtime.sendMessage;
  h.sandbox.chrome.runtime.sendMessage = (msg, cb) => {
    if (msg.type !== 'cloakllm:scan') { if (cb) cb({ ok: true }); return; }
    attempts += 1;
    if (attempts === 1) { if (cb) cb(undefined); return; }   // first try fails
    real(msg, cb);                                            // second succeeds
  };

  h.handlers.keydown[0](enterEvent(h.composer));
  await tick(150);

  assert.equal(attempts, 2, 'a transient failure should be retried');
  assert.ok(h.stubs.size > 0, 'and the real findings dialog shown, not "could not check"');
  assert.ok(!h.logs.some((l) => l.includes('scan unavailable')),
    'a recovered scan must not report itself as unavailable');
});

// ----------------------------------------------------- the send BUTTON --
//
// An external review driving a real Chrome (2026-09-18) found the claude.ai
// send button was never intercepted while Enter was. The cause was not a
// stale selector: there was NO click listener at all. ChatGPT wraps its
// composer in a real <form>, so its button fired `submit` and was caught by
// the handler above -- which hid the gap on the one site anyone had tested.
//
// A guard that is fail-open on the most common way people send is worse than
// no guard, because the dialog on the Enter path teaches someone the
// extension is watching and they stop checking their own prompts.

test('registers click and pointerdown handlers', () => {
  // The gap itself, at its simplest. This one assertion would have caught
  // the reported bug.
  const h = makeHarness();
  for (const type of ['click', 'pointerdown']) {
    assert.ok(h.handlers[type], `missing ${type} handler`);
  }
});

test('a DIRTY send by BUTTON is stopped', async () => {
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);

  const ev = clickEventOn(h.sendButton);
  h.handlers.click[0](ev);
  await tick(10);

  assert.ok(ev.prevented, 'the click must be prevented');
  assert.ok(ev.stopped, 'and must not reach the site');
  assert.ok(h.stubs.size > 0, 'the dialog should have been built');
});

test('a CLEAN send by BUTTON is not touched', async () => {
  // The other half, and the more important one: this extension must have no
  // way of breaking an ordinary message.
  const h = makeHarness();
  h.composer.value = CLEAN;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);

  const ev = clickEventOn(h.sendButton);
  h.handlers.click[0](ev);
  await tick(10);

  assert.equal(ev.prevented, false);
  assert.equal(ev.stopped, false);
  assert.equal(h.stubs.size, 0, 'no dialog for a clean message');
});

test('a click that is not the send control is ignored', async () => {
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);

  const elsewhere = { closest: () => null };
  const ev = clickEventOn(elsewhere);
  h.handlers.click[0](ev);
  await tick(10);

  assert.equal(ev.prevented, false, 'ordinary clicks must pass through');
  assert.equal(h.stubs.size, 0);
});

test('modified and non-primary clicks are not sends', async () => {
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);

  for (const over of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }]) {
    const ev = clickEventOn(h.sendButton, over);
    h.handlers.click[0](ev);
    await tick(5);
    assert.equal(ev.prevented, false, JSON.stringify(over));
  }
});

test('one gesture raises one dialog, not three', async () => {
  // pointerdown, then click, then a submit the site derives from it. Without
  // the in-flight guard each would open its own interstitial on top of the
  // last.
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);

  h.handlers.pointerdown[0](clickEventOn(h.sendButton));
  h.handlers.click[0](clickEventOn(h.sendButton));
  h.handlers.submit[0](clickEventOn(h.sendButton));
  await tick(20);

  const decisions = h.sentMessages.filter((m) => m.type === 'cloakllm:record').length;
  assert.ok(decisions <= 1, `expected at most one recorded decision, got ${decisions}`);
});

test('THE RESUME LOOP: confirming a button-send actually sends it', async () => {
  // The bug this nearly shipped with. resumeSend() calls btn.click(), our own
  // capture listener sees that click, and blocks the very send it was asked
  // to let through -- so "Send anyway" would silently do nothing at all. The
  // stub button replays its click into the handlers precisely so that this
  // is reachable from a test rather than only from a real browser.
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);

  h.handlers.click[0](clickEventOn(h.sendButton));
  await tick(10);
  assert.ok(h.stubs.size > 0, 'dialog should be open');

  const before = h.sendButton.clicks;
  let sendControl = null;
  for (const [sel, el] of h.stubs) {
    if (/send/i.test(sel) && el.listeners && el.listeners.click) sendControl = el;
  }
  assert.ok(sendControl, 'interstitial should offer a send-anyway control');
  // Through the real click path. Invoking the listener directly (what this
  // line used to do) skips our own document-level capture listeners, which
  // is where the send gate lives -- and is why the gate swallowing this very
  // button went unnoticed until someone clicked it in a browser.
  assert.equal(sendControl.click(), true,
    'the click must actually reach the button, not be eaten by our own gate');
  await tick(20);

  assert.ok(h.sendButton.clicks > before,
    'the confirmed send must reach the site button');
});

test('THE DIALOG IS CLICKABLE: our own send gate must not eat its buttons', async () => {
  // Found in a live browser on claude.ai, 2026-09-20, immediately after the
  // send-button interception started working -- the two are the same bug seen
  // from opposite sides. onSendClick blocks every click in the document while
  // a warning is open, so that a second send cannot slip past underneath it.
  // The dialog lives in the document too.
  //
  // Consequence was worse than "a button does nothing": the text stays in the
  // box, every further attempt re-raises the dialog, and Escape only cancels.
  // A flagged message could not be sent AT ALL. That is a coach turning into
  // a cop, which this product must never do -- fail-open on the ACTION is the
  // whole design.
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);

  h.handlers.click[0](clickEventOn(h.sendButton));
  await tick(10);
  assert.ok(h.stubs.has('.send') && h.stubs.has('.cancel'), 'dialog should be open');

  // The real test: a click on each control survives our capture listeners.
  for (const sel of ['.cancel', '.send']) {
    const ev = clickEventOn(h.sandbox.document.createElement());
    ev.target.id = 'cloakllm-guard-root';
    for (const fn of (h.handlers.click || [])) fn(ev);
    assert.equal(ev.stopped, false,
      `a click inside our own dialog must not be stopped (${sel})`);
    assert.equal(ev.prevented, false,
      `nor prevented (${sel})`);
  }
});

test('the dialog is reachable by KEYBOARD too', async () => {
  // The dialog focuses its own cancel button on open, so Enter is how a
  // keyboard user answers it. The keydown gate blocks Enter while a warning
  // is up -- for the site underneath, correctly -- and was blocking it for
  // the dialog as well, leaving keyboard users no way to confirm at all.
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.handlers.input[0]({ target: h.composer });
  await tick(200);

  h.handlers.click[0](clickEventOn(h.sendButton));
  await tick(10);
  assert.ok(h.stubs.size > 0, 'dialog should be open');

  const host = h.sandbox.document.createElement();
  host.id = 'cloakllm-guard-root';
  const ev = enterEvent(host);
  for (const fn of (h.handlers.keydown || [])) fn(ev);
  assert.equal(ev.stopped, false, 'Enter inside our own dialog must get through');

  // And the site underneath is still protected, which is what the gate is for.
  const under = enterEvent(h.composer);
  for (const fn of (h.handlers.keydown || [])) fn(under);
  assert.equal(under.stopped, true, 'Enter on the page underneath is still blocked');
});

test('an ORPHANED content script says so, and does not retry', async () => {
  // Reloading an unpacked extension leaves every already-open tab running
  // the OLD content script with no way to reach the worker. This is what
  // actually happened on the live claude.ai run: chrome.runtime.id goes
  // undefined, sendMessage fails forever, and retrying cannot help.
  //
  // Worth telling apart from a sleeping worker, because the fix is
  // different and the person can act on it: refresh the page.
  const h = makeHarness();
  h.composer.value = DIRTY;
  delete h.sandbox.chrome.runtime.id;            // orphaned
  let attempts = 0;
  h.sandbox.chrome.runtime.sendMessage = (msg, cb) => {
    if (msg.type === 'cloakllm:scan') attempts += 1;
    if (cb) cb(undefined);
  };

  h.handlers.keydown[0](enterEvent(h.composer));
  await tick(120);

  assert.equal(attempts, 1, 'retrying an invalidated context is pointless');
  assert.equal(h.sendButton.clicks, 0, 'and nothing may be sent unasked');
  assert.ok(h.logs.some((l) => l.includes('reloaded')),
    'the log should name the recoverable cause, not a generic failure');
});

test('sendMessage THROWING is handled, not left hanging', async () => {
  // Once the context is invalidated sendMessage throws synchronously
  // rather than calling back. Without the try/catch the promise never
  // settles and the send hangs forever with the dialog never appearing --
  // which looks, from the outside, exactly like the extension silently
  // eating someone's message.
  const h = makeHarness();
  h.composer.value = DIRTY;
  h.sandbox.chrome.runtime.sendMessage = (msg) => {
    if (msg.type === 'cloakllm:scan') throw new Error('Extension context invalidated');
  };

  h.handlers.keydown[0](enterEvent(h.composer));
  await tick(150);

  assert.ok(h.stubs.size > 0, 'a throwing sendMessage must still reach a dialog');
});
