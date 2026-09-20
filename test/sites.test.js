// M3 adapter tests.
//
// The selectors for every site except ChatGPT are inferred rather than read
// off a live DOM (each gates its composer behind a login), so these tests do
// NOT claim the selectors are correct -- nothing offline could. They check the
// two things that are checkable: that every adapter is structurally complete,
// and that the health reporting says the right thing when a guess goes stale.
// Noticing breakage is the actual deliverable here; guessing well is not.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADAPTERS, adapterFor, resolveComposer, findComposer, findSendButton, healthLine,
  resolveSendControl, sendHealthLine,
  resolveSendTarget, isSendTarget, SEND_HINTS,
} from '../src/sites/index.js';

/** A document stand-in that only knows about the selectors it is given. */
const docWith = (map) => ({ querySelector: (sel) => map[sel] || null });

const HOSTS = {
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  claude: ['claude.ai'],
  gemini: ['gemini.google.com'],
  copilot: ['copilot.microsoft.com', 'm365.cloud.microsoft'],
};

// --------------------------------------------------------------- structure --

test('every adapter is structurally complete', () => {
  for (const a of ADAPTERS) {
    assert.ok(a.id, 'adapter needs an id');
    assert.equal(typeof a.matches, 'function');
    assert.ok(a.composerSelectors.length > 0, `${a.id} has no composer selectors`);
    assert.ok(a.sendButtonSelectors.length > 0, `${a.id} has no send-button selectors`);
    // A single selector is a single point of failure on a site that reshuffles
    // its frontend without notice.
    assert.ok(a.composerSelectors.length >= 2,
      `${a.id} should carry more than one composer selector`);
  }
});

test('each known host resolves to its adapter', () => {
  for (const [id, hosts] of Object.entries(HOSTS)) {
    for (const host of hosts) {
      const a = adapterFor(host);
      assert.ok(a, `no adapter for ${host}`);
      assert.equal(a.id, id, `${host} resolved to ${a.id}`);
    }
  }
});

test('unknown hosts get no adapter', () => {
  for (const host of ['example.com', 'chatgpt.com.evil.test', 'notclaude.ai']) {
    assert.equal(adapterFor(host), null, `${host} must not match an adapter`);
  }
});

test('adapter ids are unique and no host matches two adapters', () => {
  const ids = ADAPTERS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate adapter id');
  for (const hosts of Object.values(HOSTS)) {
    for (const host of hosts) {
      const hits = ADAPTERS.filter((a) => a.matches(host));
      assert.equal(hits.length, 1, `${host} matched ${hits.length} adapters`);
    }
  }
});

// ---------------------------------------------------------------- resolve --

test('resolveComposer reports via=site when the adapter works', () => {
  const claude = adapterFor('claude.ai');
  const doc = docWith({ [claude.composerSelectors[0]]: { innerText: 'hi' } });
  const r = resolveComposer(doc, claude);
  assert.equal(r.via, 'site');
  assert.equal(r.selector, claude.composerSelectors[0]);
});

test('resolveComposer reports via=fallback when the adapter has drifted', () => {
  // Still protected, but the adapter is stale -- which is the state that
  // otherwise goes unnoticed for months.
  const gemini = adapterFor('gemini.google.com');
  const doc = docWith({ textarea: { value: 'hi' } });
  const r = resolveComposer(doc, gemini);
  assert.equal(r.via, 'fallback');
  assert.equal(r.selector, 'textarea');
});

test('resolveComposer reports via=null when nothing matches', () => {
  const r = resolveComposer(docWith({}), adapterFor('copilot.microsoft.com'));
  assert.equal(r.via, null);
  assert.equal(r.el, null);
});

test('findComposer still returns just the element', () => {
  const doc = docWith({ '#prompt-textarea': { value: 'x' } });
  assert.equal(findComposer(doc, adapterFor('chatgpt.com')).value, 'x');
});

test('findSendButton prefers the adapter button and skips disabled ones', () => {
  const claude = adapterFor('claude.ai');
  const disabled = docWith({ [claude.sendButtonSelectors[0]]: { disabled: true } });
  assert.equal(findSendButton(disabled, claude), null);

  const enabled = docWith({ [claude.sendButtonSelectors[0]]: { disabled: false, id: 'send' } });
  assert.equal(findSendButton(enabled, claude).id, 'send');
});

// ----------------------------------------------------------------- health --

test('healthLine is quiet only when the adapter actually matched', () => {
  const a = adapterFor('claude.ai');
  const ok = healthLine('claude.ai', a, { via: 'site', selector: 'x' });
  assert.ok(!ok.startsWith('WARNING'));
  assert.match(ok, /claude/);
});

test('healthLine warns on drift and names the fallback that caught it', () => {
  const a = adapterFor('gemini.google.com');
  const line = healthLine('gemini.google.com', a, { via: 'fallback', selector: 'textarea' });
  assert.ok(line.startsWith('WARNING'));
  assert.match(line, /textarea/);
  assert.match(line, /degraded/);
});

test('healthLine warns loudest when the page is not protected at all', () => {
  const a = adapterFor('copilot.microsoft.com');
  const line = healthLine('copilot.microsoft.com', a, { via: null, selector: null });
  assert.ok(line.startsWith('WARNING'));
  assert.match(line, /NOT protecting/);
});

// ------------------------------------------------- send-control health --
// The composer had health reporting from the first commit; the send control
// had none, and that asymmetry is what let the missing-click-listener bug
// live. A stale send selector means the click is never recognised as a send:
// no dialog, no warning, and Enter still works, which makes it harder to
// notice rather than easier.

test('a disabled send control still counts as FOUND', () => {
  // The distinction the whole feature turns on. findSendButton skips
  // disabled controls because it is about clicking one; at startup the send
  // button is usually disabled precisely because the box is empty. Reusing
  // it here would have warned about drift on every quiet page, and a health
  // line that cries wolf is worth less than no health line.
  const a = adapterFor('chatgpt.com');
  const btn = { disabled: true };
  const doc = docWith({ [a.sendButtonSelectors[0]]: btn });

  assert.equal(findSendButton(doc, a), null, 'not clickable, correctly');
  assert.equal(resolveSendControl(doc, a).via, 'site', 'but present, so healthy');
  assert.equal(sendHealthLine('chatgpt.com', a, resolveSendControl(doc, a)), null);
});

test('send health is silent when the adapter resolved cleanly', () => {
  const a = adapterFor('claude.ai');
  const doc = docWith({ [a.sendButtonSelectors[0]]: {} });
  assert.equal(sendHealthLine('claude.ai', a, resolveSendControl(doc, a)), null,
    'a healthy page must not gain a second console line');
});

test('send health warns, and names the hint, when adapter selectors miss', () => {
  const a = adapterFor('gemini.google.com');
  // None of gemini's own selectors match; a generic hint does.
  const doc = docWith({ '[aria-label*="send" i]': {} });
  const res = resolveSendControl(doc, a);
  assert.equal(res.via, 'hint');
  const line = sendHealthLine('gemini.google.com', a, res);
  assert.match(line, /^WARNING/);
  assert.match(line, /gemini adapter/);
  assert.match(line, /aria-label/, 'must name the fallback that caught it');
});

test('send health warns LOUDEST when no send control exists at all', () => {
  const a = adapterFor('copilot.microsoft.com');
  const res = resolveSendControl(docWith({}), a);
  assert.equal(res.via, null);
  const line = sendHealthLine('copilot.microsoft.com', a, res);
  assert.match(line, /^WARNING/);
  assert.match(line, /Enter is still guarded/,
    'it must say what still works, not just what does not');
  assert.match(line, /clicking the send button is NOT/i);
});

test('every send health line is ASCII', () => {
  // Project rule: anything printed must survive a non-UTF-8 Windows console.
  const a = adapterFor('gemini.google.com');
  for (const res of [
    resolveSendControl(docWith({ '[aria-label*="send" i]': {} }), a),
    resolveSendControl(docWith({}), a),
    resolveSendControl(docWith({}), null),
  ]) {
    const line = sendHealthLine('x.test', a, res) || '';
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[^\x00-\x7F]/.test(line), `non-ASCII in: ${line}`);
  }
});

test('healthLine handles an unknown host with and without a composer', () => {
  assert.ok(!healthLine('x.test', null, { via: 'fallback', selector: 'textarea' }).startsWith('WARNING'));
  assert.ok(healthLine('x.test', null, { via: null, selector: null }).startsWith('WARNING'));
});

// ------------------------------------------------------------------ guard --

test('manifest content-script matches cover every adapter host', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(
    readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const patterns = manifest.content_scripts[0].matches;

  for (const hosts of Object.values(HOSTS)) {
    for (const host of hosts) {
      assert.ok(patterns.some((p) => p === `https://${host}/*`),
        `manifest has no match pattern for ${host} -- the adapter would never run`);
    }
  }
});

// ------------------------------- the real claude.ai send control, 2026-09-20 --
//
// Read off the live DOM with tools/verify-selectors.js. Pinned here because
// it is the one send control anyone has actually looked at, and because two
// of its properties are the whole reason the button bug existed:
//
//   type="button"   -- NOT type="submit"
//   not in a <form> -- so no submit event is ever fired
//
// A listener on `submit` alone could not have seen this button in principle.
// ChatGPT's composer IS a form, which is why the gap looked like it did not
// exist.

/** Faithful stand-in for the live claude.ai send button. */
function realClaudeSendButton() {
  const attrs = {
    'data-testid': 'chat-input-send',
    'aria-label': 'Send message',
    type: 'button',
  };
  return {
    tagName: 'BUTTON',
    disabled: false,
    getAttribute: (k) => attrs[k] ?? null,
    closest(sel) {
      if (sel === 'form') return null;                    // NOT in a form
      if (/chat-input-send/.test(sel)) return this;
      if (/data-testid\*=["']?send/i.test(sel)) return this;
      if (/aria-label="Send message"/.test(sel)) return this;
      if (/aria-label\*=["']?send/i.test(sel)) return this;
      if (/type="submit"/.test(sel)) return null;         // type is "button"
      return null;
    },
  };
}

test('the claude adapter resolves the real send button', () => {
  const btn = realClaudeSendButton();
  const { el, via } = resolveSendTarget(btn, adapterFor('claude.ai'));
  assert.equal(el, btn);
  assert.equal(via, 'site', 'should match the adapter, not fall back to a hint');
});

test('the real claude send button is not in a form and is not type=submit', () => {
  // The two facts that made a submit-only listener structurally incapable of
  // seeing it. If either ever changes, the comment above is stale.
  const btn = realClaudeSendButton();
  assert.equal(btn.closest('form'), null);
  assert.equal(btn.getAttribute('type'), 'button');
});

test('a LOCALISED send button still resolves', () => {
  // Someone running Claude in French has aria-label="Envoyer le message".
  // Every English label selector misses them -- which would be silent
  // non-protection aimed squarely at non-English speakers. The test id is
  // not translated, which is why it is tried first.
  const french = {
    tagName: 'BUTTON',
    disabled: false,
    getAttribute: (k) => (k === 'data-testid' ? 'chat-input-send'
      : k === 'aria-label' ? 'Envoyer le message' : null),
    closest(sel) {
      if (/chat-input-send/.test(sel)) return this;
      if (/data-testid\*=["']?send/i.test(sel)) return this;
      return null;                       // no English label to match on
    },
  };
  assert.ok(isSendTarget(french, adapterFor('claude.ai')),
    'a translated UI must still be protected');
});

test('SEND_HINTS put locale-independent selectors first', () => {
  const firstAria = SEND_HINTS.findIndex((s) => s.includes('aria-label'));
  const firstTestId = SEND_HINTS.findIndex((s) => s.includes('data-testid'));
  assert.ok(firstTestId < firstAria,
    'a test id is never translated; an aria-label always is');
});

test('a click on something else is never a send', () => {
  const other = { closest: () => null };
  assert.equal(isSendTarget(other, adapterFor('claude.ai')), false);
  assert.equal(isSendTarget(null, adapterFor('claude.ai')), false);
  assert.equal(isSendTarget({}, adapterFor('claude.ai')), false);
});
