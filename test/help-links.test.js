// Every message that asks the person to report something must say WHERE.
//
// Until v0.1.1 the extension said "please report this" in four console
// messages and in the "could not read this message box" dialog, and never
// gave an address. The case those messages exist for -- a chat site changing
// its layout so Guard silently stops seeing the message box -- is invisible
// to us unless a user tells us, so a report with nowhere to go is a warning
// that goes nowhere.
//
// These tests drive the real code paths: the dialog's rendered HTML, the
// popup's real link, and every console health line -- not a grep for a
// string in the source.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SUPPORT_URL, HELP } from '../src/shared/support.js';
import { healthLine, sendHealthLine, adapterFor } from '../src/sites/index.js';

// The expected address, written out LITERALLY rather than read from the
// module under test. The first version of this file compared messages
// against HELP.report -- the same constant the messages are built from -- so
// emptying the URL left every "the link is present" test passing, because
// both sides changed together. Checking the output against the code's own
// constant only proves the code agrees with itself.
const EXPECTED = 'https://cloakllm.dev/guard/support';

test('the support address is the live support page', () => {
  assert.equal(SUPPORT_URL, EXPECTED);
  assert.equal(HELP.report, `${EXPECTED}#report`);
  assert.equal(HELP.couldNotCheck, `${EXPECTED}#could-not-check`);
  assert.equal(HELP.unreachable, `${EXPECTED}#unreachable`);
});

// ------------------------------------------------------ console messages --

test('every health line that asks for a report says where', () => {
  const a = adapterFor('gemini.google.com');
  const lines = [
    healthLine('gemini.google.com', a, { via: 'fallback', selector: 'textarea' }),
    healthLine('gemini.google.com', a, { via: null, selector: null }),
    sendHealthLine('gemini.google.com', a, { via: 'hint', selector: '[aria-label*="send" i]' }),
    sendHealthLine('gemini.google.com', a, { via: null, selector: null }),
  ];
  for (const line of lines) {
    assert.match(line, /report/i, `expected a report request in: ${line}`);
    assert.ok(line.includes(`${EXPECTED}#report`), `no address in: ${line}`);
    // Console output must survive a non-UTF-8 Windows console.
    assert.ok(!/[^\x00-\x7F]/.test(line), `non-ASCII in: ${line}`);
  }
});

test('a healthy page still prints one quiet line, with no report link', () => {
  const a = adapterFor('claude.ai');
  const ok = healthLine('claude.ai', a, { via: 'site', selector: 'x' });
  assert.ok(!ok.includes(EXPECTED), 'healthy pages should not nag');
  assert.equal(sendHealthLine('claude.ai', a, { via: 'site', selector: 'x' }), null);
});

// ---------------------------------------------------------------- dialog --

/** Minimal DOM for warn-ui: captures the HTML the dialog renders. */
function stubDom() {
  const rendered = [];
  const el = () => ({
    textContent: '', listeners: {},
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    focus() {},
  });
  globalThis.document = {
    createElement: () => ({
      style: {}, id: '',
      attachShadow: () => ({
        set innerHTML(v) { rendered.push(v); },
        querySelector: () => el(),
      }),
      remove() {},
    }),
    addEventListener() {},
    removeEventListener() {},
    documentElement: { appendChild() {} },
  };
  return rendered;
}

async function renderUnavailable(reason) {
  const rendered = stubDom();
  const mod = await import(`../src/content/warn-ui.js?t=${Date.now()}${Math.random()}`);
  mod.showUnavailable(reason);   // never resolves here; we only need the HTML
  return rendered.join('');
}

test('"could not read this message box" links to the support page', async () => {
  const html = await renderUnavailable('unreadable');
  assert.ok(html.includes(`href="${EXPECTED}#could-not-check"`), 'missing support link');
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('the dialog wording itself is unchanged -- the support page quotes it verbatim', async () => {
  // cloakllm.dev/guard/support quotes this sentence word for word so a person
  // can match their screen to an answer. The link was added on its own line
  // precisely so this text would not change.
  const html = await renderUnavailable('unreadable');
  assert.ok(html.includes(
    'CloakLLM Guard could not read this message box, so it does not know whether '
    + 'the message contains personal data. This usually means the site changed and '
    + 'the extension needs an update.',
  ), 'the quoted wording changed -- update cloakllm.dev/guard/support too');
});

test('the general "could not check" dialog links to what to do', async () => {
  const html = await renderUnavailable('unavailable');
  assert.ok(html.includes(`href="${EXPECTED}#could-not-check"`));
});

test('the "reloaded" dialog has no link -- its own text already says to reload', async () => {
  const html = await renderUnavailable('reloaded');
  assert.ok(!html.includes(EXPECTED), 'reload case should not need a link');
  assert.match(html, /Reload this page/);
});

test('the pre-send WARNING has no support link -- it is not an error', async () => {
  const rendered = stubDom();
  const mod = await import(`../src/content/warn-ui.js?t=${Date.now()}${Math.random()}`);
  mod.showWarning({ categories: ['EMAIL'], byCategory: { EMAIL: { count: 1 } } });
  assert.ok(!rendered.join('').includes(EXPECTED));
});

// ------------------------------------------------------------------ popup --

test('the popup\'s "could not reach" notice links to the matching section', async () => {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id, hidden: false, disabled: false, textContent: '', href: '',
        addEventListener() {}, replaceChildren() {},
      });
    }
    return nodes.get(id);
  };
  globalThis.document = { getElementById: get, createElement: () => get(`x${Math.random()}`) };
  globalThis.chrome = {
    runtime: {
      id: 'help-test', lastError: { message: 'no receiving end' },
      sendMessage(_m, cb) { if (cb) cb(undefined); },
      openOptionsPage() {},
    },
  };
  await import(`../src/ui/popup.js?t=${Date.now()}${Math.random()}`);
  assert.equal(get('unreachable').hidden, false);
  assert.equal(get('unreachableHelp').href, `${EXPECTED}#unreachable`);
});
