// M1 acceptance + invariant tests.
//
// The invariant suite is the important one. "Zero content storage" is the
// property that lets a privacy company ship a tool that reads what people
// type, so it is tested the way the SDK tests its no-PII-in-logs guarantee:
// plant known values, then assert they appear nowhere in anything the
// extension would log, count or persist.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

import {
  textFromPaste, textFromComposer, clampForScan, isSendKey, MAX_SCAN_CHARS,
} from '../src/shared/extract.js';
import { adapterFor, findComposer } from '../src/sites/index.js';
import { scan } from '../src/worker/index.js';

// Planted values. Every one of these must be DETECTED and none may appear in
// any summary the extension produces.
const PLANTED = {
  email: 'marie.dubois@example-eu.fr',
  card: '5500 0000 0000 0004',
  iban: 'FR76 3000 6000 0112 3456 7890 189',
  awsKey: 'AKIAIOSFODNN7EXAMPLE',
  apiKey: 'secret_EXAMPLE_NOT_A_REAL_KEY_000000',
  phone: '06 12 34 56 78',
};
const SAMPLE = `Customer ${PLANTED.email} called about card ${PLANTED.card}.
Billing IBAN ${PLANTED.iban}, phone ${PLANTED.phone}.
Our key is ${PLANTED.apiKey} and the role is ${PLANTED.awsKey}.`;

// ---------------------------------------------------------------- extract --

test('textFromPaste reads text/plain', () => {
  const cd = { getData: (t) => (t === 'text/plain' ? 'hello' : '<b>hello</b>') };
  assert.equal(textFromPaste(cd), 'hello');
});

test('textFromPaste tolerates a missing clipboard', () => {
  assert.equal(textFromPaste(null), '');
  assert.equal(textFromPaste({}), '');
});

test('textFromComposer handles textarea and contenteditable', () => {
  assert.equal(textFromComposer({ value: 'from textarea' }), 'from textarea');
  assert.equal(textFromComposer({ innerText: 'from div' }), 'from div');
  assert.equal(textFromComposer(null), '');
});

test('textFromComposer prefers innerText over textContent', () => {
  // textContent fuses block elements, which can invent digit runs that were
  // never adjacent on screen.
  const el = { innerText: 'line one\nline two', textContent: 'line oneline two' };
  assert.equal(textFromComposer(el), 'line one\nline two');
});

test('clampForScan leaves short text alone', () => {
  const r = clampForScan('short');
  assert.equal(r.text, 'short');
  assert.equal(r.truncated, false);
});

test('clampForScan never splits inside a token', () => {
  // A cut landing mid-number could hide the tail of a card, so the cut must
  // fall on whitespace.
  const text = 'x'.repeat(MAX_SCAN_CHARS - 3) + ' 4111111111111111 tail';
  const r = clampForScan(text);
  assert.equal(r.truncated, true);
  assert.ok(!/\S$/.test(r.text) || r.text.length < MAX_SCAN_CHARS,
    'truncated text must not end mid-token');
  assert.ok(!r.text.includes('41111111111111'),
    'a partially-cut card must not survive into the scanned text');
});

test('isSendKey distinguishes send from newline and IME', () => {
  assert.equal(isSendKey({ key: 'Enter' }), true);
  assert.equal(isSendKey({ key: 'Enter', shiftKey: true }), false, 'Shift+Enter is a newline');
  assert.equal(isSendKey({ key: 'Enter', isComposing: true }), false, 'IME commit is not a send');
  assert.equal(isSendKey({ key: 'a' }), false);
  assert.equal(isSendKey(null), false);
});

// ------------------------------------------------------------------ sites --

test('adapterFor resolves the chatgpt hosts', () => {
  assert.equal(adapterFor('chatgpt.com').id, 'chatgpt');
  assert.equal(adapterFor('chat.openai.com').id, 'chatgpt');
  assert.equal(adapterFor('example.com'), null);
});

test('findComposer tries site selectors before generic ones', () => {
  const tried = [];
  const root = {
    querySelector(sel) {
      tried.push(sel);
      return sel === 'form textarea' ? { value: 'found' } : null;
    },
  };
  const el = findComposer(root, adapterFor('chatgpt.com'));
  assert.equal(el.value, 'found');
  assert.equal(tried[0], '#prompt-textarea', 'site-specific selector must be tried first');
});

test('findComposer falls back to generic selectors when the site misses', () => {
  // A missed composer means silent non-protection -- the worst failure mode
  // this extension has -- so over-scanning is the correct direction.
  const root = { querySelector: (sel) => (sel === 'textarea' ? { value: 'x' } : null) };
  assert.ok(findComposer(root, adapterFor('chatgpt.com')));
});

// ------------------------------------------------------------------- scan --

test('scan detects every planted high-confidence category', () => {
  const r = scan(SAMPLE);
  for (const cat of ['EMAIL', 'CREDIT_CARD', 'IBAN', 'AWS_KEY', 'API_KEY', 'PHONE']) {
    assert.ok(r.categories.includes(cat), `expected ${cat} in ${r.categories.join(',')}`);
  }
  assert.ok(r.total >= 6);
});

test('scan is silent on clean text', () => {
  const r = scan('what is the capital of France, and can you explain why?');
  assert.equal(r.total, 0);
  assert.deepEqual(r.categories, []);
});

test('scan leaves IP addresses alone in v0.1', () => {
  // Deliberately off: too noisy around developer chatter, and in a warn-UI a
  // false positive costs a person's attention.
  const r = scan('the server at 192.168.14.203 is down');
  assert.equal(r.total, 0);
});

// -------------------------------------------------------------- INVARIANT --

test('INVARIANT: a scan summary contains none of the planted values', () => {
  const serialised = JSON.stringify(scan(SAMPLE));
  for (const [label, value] of Object.entries(PLANTED)) {
    assert.ok(!serialised.includes(value), `summary leaked ${label}`);
    // Also check the digits-only projection, so a reformatted copy cannot hide.
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 8) {
      assert.ok(!serialised.replace(/\D/g, '').includes(digits),
        `summary leaked ${label} in digit-only form`);
    }
  }
});

test('INVARIANT: the summary shape carries counts and offsets only', () => {
  const r = scan(SAMPLE);
  assert.deepEqual(Object.keys(r).sort(), ['byCategory', 'categories', 'ms', 'total', 'truncated']);
  for (const entry of Object.values(r.byCategory)) {
    assert.deepEqual(Object.keys(entry).sort(), ['count', 'spans']);
    for (const span of entry.spans) {
      assert.equal(span.length, 2);
      assert.equal(typeof span[0], 'number');
    }
  }
});

// End-to-end behaviour moved to test/e2e.test.js once M2 added the send gate.

