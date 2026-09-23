// The popup and options pages, driven headlessly.
//
// These two pages had NO coverage of any kind until 2026-09-23 and had never
// been opened in a browser. Rendering them found the defect below in about
// ten minutes, which is roughly the base rate for this codebase: every
// serious bug in the preceding week lived in code nobody had run.
//
// THE BUG: "could not ask the worker" and "asked, nothing to report" rendered
// IDENTICALLY. A broken extension displayed "Nothing caught yet. Guard is
// watching your AI chats and will step in before personal data is sent." --
// a product whose entire value is trust, actively reassuring someone while
// not working. Same fail-open class as the content script's silent release
// of an unscanned message: open on the ACTION is acceptable, open on the
// INFORMATION is not.
//
// These pages are ES modules that read the DOM at module scope and call
// chrome.*, so the stubs go in BEFORE the dynamic import. Cache-busted so
// each case re-executes the module body.
import test from 'node:test';
import assert from 'node:assert/strict';

/** Minimal element good enough for what these pages actually touch. */
function el(id) {
  return {
    id,
    hidden: false,
    checked: false,
    indeterminate: false,
    disabled: false,
    textContent: '',
    className: '',
    htmlFor: '',
    type: '',
    style: {},
    children: [],
    listeners: {},
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    replaceChildren(...kids) { this.children = kids; },
    append(...kids) { this.children.push(...kids); },
    focus() {},
    click() {},
  };
}

function makeDom() {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, el(id));
    return nodes.get(id);
  };
  globalThis.document = {
    getElementById: get,
    createElement: () => el(''),
    documentElement: { appendChild() {} },
  };
  globalThis.URL = globalThis.URL;
  return { nodes, get };
}

/**
 * @param {'populated'|'empty'|'broken'} state
 */
function makeChrome(state) {
  const stats = state === 'empty'
    ? { shown: 0, heeded: 0, heeded_pct: 0, byCategory: {}, first: null, last: null }
    : { shown: 37, heeded: 31, heeded_pct: 84,
        byCategory: { IBAN: 14, EMAIL: 11 },
        first: '2026-09-01T09:12:00.000Z', last: '2026-09-23T16:40:00.000Z' };
  const settings = { logEnabled: true, categories: { EMAIL: true, IBAN: true } };

  globalThis.chrome = {
    runtime: {
      id: 'ui-test',
      lastError: state === 'broken' ? { message: 'no receiving end' } : null,
      sendMessage(msg, cb) {
        if (!cb) return;
        if (state === 'broken') { cb(undefined); return; }
        if (msg.type === 'cloakllm:stats') { cb(stats); return; }
        if (msg.type === 'cloakllm:getSettings') { cb(settings); return; }
        cb({ ok: true });
      },
      openOptionsPage() {},
    },
  };
}

const load = async (mod, state) => {
  makeDom();
  makeChrome(state);
  const dom = globalThis.document;
  await import(`../src/ui/${mod}?t=${Date.now()}${Math.random()}`);
  return dom;
};

// ----------------------------------------------------------------- popup --

test('POPUP: a broken worker is NOT reported as "nothing caught"', async () => {
  // The finding. Before the fix both branches showed #empty, so the page
  // told someone it was watching while it could not reach the thing that
  // does the watching.
  const doc = await load('popup.js', 'broken');
  assert.equal(doc.getElementById('unreachable').hidden, false,
    'the unreachable notice must be shown');
  assert.equal(doc.getElementById('empty').hidden, true,
    'the reassuring "Guard is watching" card must NOT be shown');
  assert.equal(doc.getElementById('summary').hidden, true);
  assert.equal(doc.getElementById('export').disabled, true,
    'there is nothing to export if we could not read the log');
});

test('POPUP: a genuinely empty log still says "nothing caught"', async () => {
  const doc = await load('popup.js', 'empty');
  assert.equal(doc.getElementById('empty').hidden, false);
  assert.equal(doc.getElementById('unreachable').hidden, true,
    'an empty log is not a failure and must not be reported as one');
  assert.equal(doc.getElementById('summary').hidden, true);
});

test('POPUP: a populated log renders the summary', async () => {
  const doc = await load('popup.js', 'populated');
  assert.equal(doc.getElementById('summary').hidden, false);
  assert.equal(doc.getElementById('unreachable').hidden, true);
  assert.equal(doc.getElementById('empty').hidden, true);
  assert.equal(doc.getElementById('shown').textContent, 37);
  assert.equal(doc.getElementById('export').disabled, false);
});

test('POPUP: the three states are mutually exclusive', async () => {
  // The bug was two states colliding, so assert exactly one panel at a time.
  for (const state of ['broken', 'empty', 'populated']) {
    const doc = await load('popup.js', state);
    const visible = ['unreachable', 'empty', 'summary']
      .filter((id) => doc.getElementById(id).hidden === false);
    assert.deepEqual(visible.length, 1, `${state} showed ${visible.join('+')}`);
  }
});

// --------------------------------------------------------------- options --

test('OPTIONS: a broken worker does not silently show an empty settings list', async () => {
  const doc = await load('options.js', 'broken');
  const cats = doc.getElementById('cats');
  assert.equal(cats.children.length, 1, 'expected an explanatory row, not nothing');
  assert.match(cats.children[0].textContent, /did not respond/);
});

test('OPTIONS: an unknown logging setting is not rendered as OFF', async () => {
  // It used to show an unchecked box, which states that the findings log is
  // disabled. The truth was that nothing was known.
  const doc = await load('options.js', 'broken');
  const box = doc.getElementById('logEnabled');
  assert.equal(box.indeterminate, true, 'unknown must be indeterminate');
  assert.equal(box.disabled, true, 'and not toggleable while unknown');
});

test('OPTIONS: settings render normally when the worker answers', async () => {
  const doc = await load('options.js', 'populated');
  assert.ok(doc.getElementById('cats').children.length > 1);
  assert.equal(doc.getElementById('logEnabled').checked, true);
  assert.equal(doc.getElementById('logEnabled').indeterminate, false);
});

test('OPTIONS: the watched-site list comes from the adapters, not a copy', async () => {
  // It used to probe adapter.matches() against a hard-coded array of hosts
  // maintained in options.js -- a second source of truth that could drift.
  const { ADAPTERS } = await import('../src/sites/index.js');
  const doc = await load('options.js', 'populated');
  const shown = doc.getElementById('sites').children.map((li) => li.textContent);
  const expected = [...new Set(ADAPTERS.flatMap((a) => a.hosts))];
  assert.deepEqual(shown, expected);
  for (const h of shown) {
    assert.ok(ADAPTERS.some((a) => a.matches(h)), `${h} is listed but no adapter claims it`);
  }
});
