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
