// M4 settings tests, plus a manifest guard for the permissions bug this
// milestone uncovered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULTS, CATEGORY_ORDER, load, save, toDetectorConfig, enabledCategories, _setStore,
} from '../src/shared/settings.js';
import { scan, invalidate } from '../src/worker/index.js';

function memoryStore() {
  const data = {};
  return {
    async get(k) { return (k in data) ? { [k]: data[k] } : {}; },
    async set(o) { Object.assign(data, o); },
  };
}

test.beforeEach(() => { _setStore(memoryStore()); invalidate(); });

// --------------------------------------------------------------- defaults --

test('defaults cover every listed category', () => {
  for (const cat of CATEGORY_ORDER) {
    assert.equal(typeof DEFAULTS.categories[cat], 'boolean', `${cat} has no default`);
  }
});

test('IP_ADDRESS is off by default, the rest on', () => {
  assert.equal(DEFAULTS.categories.IP_ADDRESS, false);
  for (const cat of CATEGORY_ORDER.filter((c) => c !== 'IP_ADDRESS')) {
    assert.equal(DEFAULTS.categories[cat], true, `${cat} should default on`);
  }
});

test('a category added in a later version gets its default, not undefined', async () => {
  // Someone upgrading has saved settings from before the category existed.
  await save({ categories: { CREDIT_CARD: false } });
  const s = await load();
  assert.equal(s.categories.CREDIT_CARD, false, 'their choice survives');
  assert.equal(s.categories.IBAN, true, 'and unknown keys fall back to the default');
});

test('saving one field leaves the others alone', async () => {
  await save({ logEnabled: false });
  const s = await load();
  assert.equal(s.logEnabled, false);
  assert.equal(s.categories.CREDIT_CARD, true);
});

// ----------------------------------------------------------- shared gates --

test('the shared API-key gate stays on while any of its categories is on', () => {
  // API_KEY, AWS_KEY and JWT all ride on detectApiKeys in the SDK. Silencing
  // one must not switch off its siblings.
  const s = { categories: { ...DEFAULTS.categories, API_KEY: false, AWS_KEY: false } };
  assert.equal(toDetectorConfig(s).detectApiKeys, true, 'JWT still wants it');

  const off = { categories: { ...DEFAULTS.categories, API_KEY: false, AWS_KEY: false, JWT: false } };
  assert.equal(toDetectorConfig(off).detectApiKeys, false);
});

test('silencing one shared-gate category still filters it out of results', () => {
  const text = 'key AKIAIOSFODNN7EXAMPLE and token '
    + 'secret_EXAMPLE_NOT_A_REAL_KEY_000000';

  const all = scan(text, { categories: DEFAULTS.categories });
  assert.ok(all.categories.includes('AWS_KEY'));
  assert.ok(all.categories.includes('API_KEY'));

  invalidate();
  const noAws = scan(text, { categories: { ...DEFAULTS.categories, AWS_KEY: false } });
  assert.ok(!noAws.categories.includes('AWS_KEY'), 'AWS_KEY must be filtered out');
  assert.ok(noAws.categories.includes('API_KEY'), 'but its sibling must survive');
});

test('enabledCategories reflects the toggles', () => {
  const s = { categories: { ...DEFAULTS.categories, EMAIL: false } };
  const set = enabledCategories(s);
  assert.ok(!set.has('EMAIL'));
  assert.ok(set.has('CREDIT_CARD'));
});

// ------------------------------------------------------------ scan wiring --

test('disabling a category silences it end to end', () => {
  const text = 'mail me at marie.dubois@example-eu.fr about card 5500 0000 0000 0004';

  const on = scan(text, { categories: DEFAULTS.categories });
  assert.ok(on.categories.includes('EMAIL'));

  invalidate();
  const off = scan(text, { categories: { ...DEFAULTS.categories, EMAIL: false } });
  assert.ok(!off.categories.includes('EMAIL'));
  assert.ok(off.categories.includes('CREDIT_CARD'), 'other categories unaffected');
});

test('enabling IP_ADDRESS turns it on', () => {
  const text = 'the server at 192.168.14.203 is down';
  assert.equal(scan(text, { categories: DEFAULTS.categories }).total, 0);

  invalidate();
  const on = scan(text, { categories: { ...DEFAULTS.categories, IP_ADDRESS: true } });
  assert.ok(on.categories.includes('IP_ADDRESS'));
});

test('invalidate is required for a settings change to take effect', () => {
  // Documents the contract rather than a nicety: the worker caches the
  // detector, so the setSettings handler MUST invalidate or the change is
  // silently ignored until the service worker respawns.
  const text = 'mail me at marie.dubois@example-eu.fr';
  assert.ok(scan(text, { categories: DEFAULTS.categories }).categories.includes('EMAIL'));
  const stale = scan(text, { categories: { ...DEFAULTS.categories, EMAIL: false } });
  assert.ok(stale.categories.includes('EMAIL'), 'without invalidate the old detector persists');
  invalidate();
  assert.ok(!scan(text, { categories: { ...DEFAULTS.categories, EMAIL: false } })
    .categories.includes('EMAIL'));
});

// --------------------------------------------------------------- manifest --

test('the manifest declares every chrome permission the code relies on', () => {
  // This is the bug M4 uncovered: M2.5 shipped chrome.storage.local with no
  // "storage" permission, so the log would have silently failed in a real
  // browser while every test passed against an injected memory store. A mock
  // shares the implementation's blind spots -- so assert against the manifest.
  const manifest = JSON.parse(
    readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const declared = new Set(manifest.permissions || []);
  assert.ok(declared.has('storage'),
    'chrome.storage is used by the findings log and by settings');
});

test('the manifest wires up both UI surfaces', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.action.default_popup, 'src/ui/popup.html');
  assert.equal(manifest.options_page, 'src/ui/options.html');
});

test('no UI page uses an inline script or handler', () => {
  // MV3 extension pages forbid inline script outright; an inline onclick would
  // simply never fire, and would fail Web Store review.
  for (const page of ['popup.html', 'options.html']) {
    const html = readFileSync(new URL(`../src/ui/${page}`, import.meta.url), 'utf8');
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html),
      `${page} contains an inline script`);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${page} contains an inline event handler`);
  }
});
