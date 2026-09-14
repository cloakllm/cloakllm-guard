// M2 tests: hashing, human labels, and the cache that lets the Enter handler
// decide synchronously.
//
// The invariant suite continues M1's discipline one layer further out: it is
// no longer enough that the SUMMARY carries no values -- the sentence a person
// reads must not either.
import test from 'node:test';
import assert from 'node:assert/strict';

import { hashText } from '../src/shared/hash.js';
import { labelFor, describe as describeFindings } from '../src/shared/labels.js';
import { scan } from '../src/worker/index.js';

// chrome must exist before scan-cache's functions run; it is only touched
// inside them, so importing first is safe.
globalThis.chrome = {
  runtime: {
    lastError: null,
    sendMessage: (msg, cb) => cb(scan(msg.text)),
  },
};
const cache = await import('../src/content/scan-cache.js');

const PLANTED = {
  email: 'marie.dubois@example-eu.fr',
  card: '5500 0000 0000 0004',
  iban: 'FR76 3000 6000 0112 3456 7890 189',
};
const DIRTY = `card ${PLANTED.card}, email ${PLANTED.email}, iban ${PLANTED.iban}`;
const CLEAN = 'explain the difference between a mutex and a semaphore';

// ------------------------------------------------------------------ hash --

test('hashText is deterministic and 8 hex chars', () => {
  assert.equal(hashText('hello'), hashText('hello'));
  assert.match(hashText('hello'), /^[0-9a-f]{8}$/);
});

test('hashText separates different inputs, including near-identical ones', () => {
  assert.notEqual(hashText('hello'), hashText('hellp'));
  assert.notEqual(hashText('4111 1111 1111 1111'), hashText('4111 1111 1111 1112'));
  assert.notEqual(hashText(''), hashText(' '));
});

// ---------------------------------------------------------------- labels --

test('labelFor uses singular and plural forms', () => {
  assert.equal(labelFor('CREDIT_CARD', 1), 'a credit card number');
  assert.equal(labelFor('CREDIT_CARD', 3), '3 credit card numbers');
  assert.equal(labelFor('IBAN', 1), 'a bank account number (IBAN)');
});

test('labelFor falls back gracefully for an unmapped category', () => {
  // A new SDK category must degrade to readable prose, never render raw.
  assert.equal(labelFor('PASSPORT', 1), 'a passport');
  assert.equal(labelFor('PASSPORT', 2), 'passport values');
});

test('describe joins one, two and three findings readably', () => {
  const by = { EMAIL: { count: 1 }, CREDIT_CARD: { count: 1 }, IBAN: { count: 2 } };
  assert.equal(describeFindings(['EMAIL'], by), 'an email address');
  assert.equal(
    describeFindings(['CREDIT_CARD', 'EMAIL'], by),
    'a credit card number and an email address');
  assert.equal(
    describeFindings(['CREDIT_CARD', 'EMAIL', 'IBAN'], by),
    'a credit card number, an email address, and 2 bank account numbers (IBAN)');
});

test('describe returns empty for no findings', () => {
  assert.equal(describeFindings([], {}), '');
});

test('INVARIANT: the sentence a person reads contains no planted value', () => {
  const summary = scan(DIRTY);
  const sentence = describeFindings(summary.categories, summary.byCategory);
  assert.ok(sentence.length > 0);
  for (const [label, value] of Object.entries(PLANTED)) {
    assert.ok(!sentence.includes(value), `warning text leaked ${label}`);
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 8) {
      assert.ok(!sentence.replace(/\D/g, '').includes(digits),
        `warning text leaked ${label} in digit-only form`);
    }
  }
});

// ----------------------------------------------------------------- cache --

test('lookup reports unknown before anything is scanned', () => {
  cache._reset();
  assert.equal(cache.lookup(DIRTY).state, 'unknown');
});

test('lookup reports clean for scanned text with no findings', async () => {
  cache._reset();
  await cache.scanAndCache(CLEAN, 'input');
  assert.equal(cache.lookup(CLEAN).state, 'clean');
});

test('lookup reports findings and carries the summary', async () => {
  cache._reset();
  await cache.scanAndCache(DIRTY, 'input');
  const r = cache.lookup(DIRTY);
  assert.equal(r.state, 'findings');
  assert.ok(r.summary.categories.includes('CREDIT_CARD'));
});

test('the cache is keyed to exact text, so an edit invalidates it', async () => {
  cache._reset();
  await cache.scanAndCache(CLEAN, 'input');
  assert.equal(cache.lookup(CLEAN).state, 'clean');
  assert.equal(cache.lookup(CLEAN + ' also my card 5500 0000 0000 0004').state, 'unknown',
    'edited text must not inherit the previous verdict');
});

test('acknowledge lets that exact text through, once', async () => {
  cache._reset();
  await cache.scanAndCache(DIRTY, 'input');
  assert.equal(cache.lookup(DIRTY).state, 'findings');
  cache.acknowledge(DIRTY);
  assert.equal(cache.lookup(DIRTY).state, 'acknowledged');
});

test('acknowledging one text does NOT cover a different one', async () => {
  // "I meant to send that card" must not silently cover a different card
  // pasted a minute later.
  cache._reset();
  const other = 'and another card 4111 1111 1111 1111';
  cache.acknowledge(DIRTY);
  await cache.scanAndCache(other, 'input');
  assert.equal(cache.lookup(other).state, 'findings');
});

test('a failed scan resolves unknown, never clean', async () => {
  // Claiming clean on an error is the one failure that silently voids the
  // guarantee, so the error path must never produce a clean verdict.
  cache._reset();
  const saved = globalThis.chrome.runtime.sendMessage;
  globalThis.chrome.runtime.sendMessage = (msg, cb) => cb(undefined);
  const result = await cache.scanAndCache(DIRTY, 'input');
  globalThis.chrome.runtime.sendMessage = saved;
  assert.equal(result, null);
  assert.equal(cache.lookup(DIRTY).state, 'unknown');
});
