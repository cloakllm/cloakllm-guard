// M2.5 findings-log tests.
//
// Two things are being checked, and the second is the one that matters:
//   - the log behaves (chaining, epochs, derived stats, no content)
//   - the entries it writes are hashed the way the SDK hashes entries, so
//     cloakllm-verifier can actually check them. That cross-language claim is
//     proved separately in test/verifier_crosscheck.py, which runs this JS
//     output through the real Python verifier.
import test from 'node:test';
import assert from 'node:assert/strict';

import { scan } from '../src/worker/index.js';
import {
  record, allEntries, stats, exportJsonl, clear, _setStore, _internals,
} from '../src/worker/log.js';

/** In-memory stand-in for chrome.storage.local. */
function memoryStore() {
  const data = {};
  return {
    data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in data) out[k] = data[k];
      return out;
    },
    async set(obj) { Object.assign(data, obj); },
    async remove(keys) {
      for (const k of (Array.isArray(keys) ? keys : [keys])) delete data[k];
    },
  };
}

const PLANTED = {
  card: '5500 0000 0000 0004',
  email: 'marie.dubois@example-eu.fr',
  iban: 'FR76 3000 6000 0112 3456 7890 189',
};
const DIRTY = `refund ${PLANTED.card} for ${PLANTED.email}, iban ${PLANTED.iban}`;

const meta = (action = 'heeded', trigger = 'enter') =>
  ({ host: 'chatgpt.com', trigger, action });

test.beforeEach(() => { _setStore(memoryStore()); });

// ------------------------------------------------------------------ chain --

test('the first record opens an epoch and links from genesis', async () => {
  await record(scan(DIRTY), meta());
  const entries = await allEntries();

  assert.equal(entries.length, 2, 'epoch_open + the warning');
  assert.equal(entries[0].event_type, 'guard_epoch_open');
  assert.equal(entries[0].prev_hash, _internals.GENESIS);
  assert.equal(entries[1].event_type, 'guard_warning');
  assert.equal(entries[1].prev_hash, entries[0].entry_hash);
});

test('entries chain in order across many records', async () => {
  for (let i = 0; i < 12; i++) await record(scan(DIRTY), meta());
  const entries = await allEntries();

  let prev = _internals.GENESIS;
  for (const e of entries) {
    assert.equal(e.prev_hash, prev, `broken link at seq ${e.seq}`);
    prev = e.entry_hash;
  }
  assert.equal(entries.length, 13);
});

test('concurrent records do not fork the chain', async () => {
  // A service worker handles messages concurrently. Two appends reading the
  // same prevHash would both claim it and everything after would fail to
  // verify -- a real race, not a theoretical one.
  await Promise.all(Array.from({ length: 25 }, () => record(scan(DIRTY), meta())));
  const entries = await allEntries();

  const seen = new Set();
  let prev = _internals.GENESIS;
  for (const e of entries) {
    assert.equal(e.prev_hash, prev, `forked at seq ${e.seq}`);
    assert.ok(!seen.has(e.entry_hash), 'duplicate entry hash');
    seen.add(e.entry_hash);
    prev = e.entry_hash;
  }
  assert.equal(entries.length, 26);
});

test('a tampered entry no longer matches its recomputed hash', async () => {
  await record(scan(DIRTY), meta());
  const entries = await allEntries();
  const target = entries[1];
  const stored = target.entry_hash;

  const edited = { ...target, categories: { ...target.categories, IBAN: 99 } };
  delete edited.entry_hash;
  assert.notEqual(await _internals.computeHash(edited), stored);
});

// ----------------------------------------------------------------- epochs --

test('epochs rotate instead of truncating, and stay linked', async () => {
  const n = _internals.MAX_ENTRIES_PER_EPOCH;
  for (let i = 0; i < n; i++) await record(scan(DIRTY), meta());
  const opens = (await allEntries()).filter((e) => e.event_type === 'guard_epoch_open');

  assert.ok(opens.length >= 2, 'a second epoch should have opened');
  const second = opens[1];
  assert.equal(second.prev_hash, _internals.GENESIS, 'each epoch verifies independently');
  assert.match(second.previous_epoch_final_hash, /^[0-9a-f]{64}$/,
    'and records the previous epoch final hash, so the two stay linked');
});

// ------------------------------------------------------------------ stats --

test('stats derive from the entries rather than a stored counter', async () => {
  await record(scan(DIRTY), meta('heeded'));
  await record(scan(DIRTY), meta('heeded'));
  await record(scan(DIRTY), meta('sent_anyway'));
  await record(scan('card 4111 1111 1111 1111'), meta('heeded'));

  const s = await stats();
  assert.equal(s.shown, 4);
  assert.equal(s.heeded, 3);
  assert.equal(s.sent_anyway, 1);
  assert.equal(s.heeded_pct, 75);
  assert.equal(s.byCategory.CREDIT_CARD, 4);
  assert.equal(s.byCategory.IBAN, 3);
  assert.equal(typeof s.heeded_pct, 'number');
  assert.ok(Number.isInteger(s.heeded_pct), 'integer percent, per the cross-SDK rounding lesson');
});

test('stats on an empty log do not divide by zero', async () => {
  const s = await stats();
  assert.deepEqual(
    { shown: s.shown, heeded: s.heeded, pct: s.heeded_pct, first: s.first },
    { shown: 0, heeded: 0, pct: 0, first: null });
});

// -------------------------------------------------------------- INVARIANT --

test('INVARIANT: no planted value appears anywhere in the stored log', async () => {
  await record(scan(DIRTY), meta('sent_anyway'));
  const serialised = JSON.stringify(await allEntries());

  for (const [label, value] of Object.entries(PLANTED)) {
    assert.ok(!serialised.includes(value), `log leaked ${label}`);
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 8) {
      assert.ok(!serialised.replace(/\D/g, '').includes(digits),
        `log leaked ${label} in digit-only form`);
    }
  }
});

test('INVARIANT: spans are dropped from the persisted entry', async () => {
  // The live summary carries offsets for future highlighting; a stored record
  // must not -- offsets leak the length and structure of what was written.
  const summary = scan(DIRTY);
  assert.ok(summary.byCategory.CREDIT_CARD.spans, 'summary still has spans');

  await record(summary, meta());
  const warning = (await allEntries()).find((e) => e.event_type === 'guard_warning');
  assert.deepEqual(Object.keys(warning.categories).sort(), ['CREDIT_CARD', 'EMAIL', 'IBAN']);
  for (const v of Object.values(warning.categories)) {
    assert.equal(typeof v, 'number', 'categories must be plain counts');
  }
  assert.ok(!JSON.stringify(warning).includes('spans'));
});

// ----------------------------------------------------------------- export --

test('export uses an audit_-prefixed filename', async () => {
  // cloakllm-verifier reads ONLY audit_*.jsonl; anything else is ignored.
  await record(scan(DIRTY), meta());
  const out = await exportJsonl();
  assert.match(out.filename, /^audit_.*\.jsonl$/);
  assert.equal(out.entries, 2);
  assert.equal(out.content.trim().split('\n').length, 2);
  for (const line of out.content.trim().split('\n')) JSON.parse(line);
});

test('clear wipes everything', async () => {
  await record(scan(DIRTY), meta());
  await clear();
  assert.deepEqual(await allEntries(), []);
  assert.equal((await stats()).shown, 0);
});
