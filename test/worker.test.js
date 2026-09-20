// The service worker's MESSAGE HANDLER, driven the way Chrome drives it.
//
// This file exists because of a hole found on 2026-09-20. The worker wires
// its handler behind:
//
//   if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage)
//
// In Node `chrome` is undefined, so that block never ran and ALL SIX message
// cases had zero coverage -- including `cloakllm:scan`, the one the whole
// product depends on. The suite was green while a live run on claude.ai
// could not get a single scan answered.
//
// So: define a `chrome` shim BEFORE importing the module (dynamic import,
// because static imports hoist above any assignment), capture the listener
// it registers, and send it real messages.
import test from 'node:test';
import assert from 'node:assert/strict';

const REAL_WARN = console.warn;
process.on('exit', () => { console.warn = REAL_WARN; });

/** Minimal MV3 `chrome`, close enough that the real wiring runs unchanged. */
function makeChrome({ storageFails = false } = {}) {
  const listeners = [];
  const store = {};
  const warnings = [];
  return {
    api: {
      runtime: {
        id: 'cloakllm-guard-test',
        lastError: null,
        onMessage: { addListener: (fn) => listeners.push(fn) },
        sendMessage: () => {},
      },
      storage: {
        local: {
          async get(key) {
            if (storageFails) throw new Error('storage unavailable');
            return key in store ? { [key]: store[key] } : {};
          },
          async set(obj) {
            if (storageFails) throw new Error('storage unavailable');
            Object.assign(store, obj);
          },
        },
      },
      tabs: { query: async () => [], sendMessage: () => {} },
    },
    listeners,
    warnings,
  };
}

/**
 * Load the worker with a chrome shim in place and return a `send` helper
 * that resolves the way sendResponse would.
 */
async function loadWorker(opts) {
  const shim = makeChrome(opts);
  globalThis.chrome = shim.api;
  // Capture for the WHOLE test, not just the import. Restoring straight
  // after the import meant every warning raised while handling a message
  // went to the real console instead of the array the assertions read --
  // so "and it must report the reason" failed against a worker that was
  // reporting it correctly. The harness was wrong, not the code.
  console.warn = (...a) => shim.warnings.push(a.join(' '));

  // Cache-bust so each test gets a fresh module instance, since the worker
  // memoises its detector and settings at module scope.
  const mod = await import(`../src/worker/index.js?t=${Date.now()}${Math.random()}`);

  assert.ok(shim.listeners.length > 0,
    'the worker must register a message listener at import time');

  const send = (msg, sender = { url: 'https://claude.ai/new' }) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('the worker never called sendResponse')), 3000);
      let answered = false;
      const sendResponse = (r) => { answered = true; clearTimeout(timer); resolve(r); };
      const kept = shim.listeners[0](msg, sender, sendResponse);
      // A handler that returns false AND never responded has dropped the
      // message -- the exact shape of "the worker did not answer".
      if (kept !== true && !answered) {
        clearTimeout(timer);
        resolve(undefined);
      }
    });

  shim.restore = () => { console.warn = REAL_WARN; };
  return { send, mod, shim };
}

test('the worker registers its listener when chrome exists', async () => {
  const { shim } = await loadWorker();
  assert.equal(shim.listeners.length, 1);
});

test('cloakllm:scan ANSWERS -- the case that was failing live', async () => {
  // The single most important assertion in this file. A live run on
  // claude.ai got no answer to this message, twice, and no test could have
  // caught it.
  const { send } = await loadWorker();
  const result = await send({
    type: 'cloakllm:scan',
    trigger: 'send',
    text: 'refund card 4111 1111 1111 1111 for marie@example.com',
  });

  assert.ok(result, 'scan must return a summary, not undefined or null');
  assert.ok(result.categories.includes('CREDIT_CARD'));
  assert.ok(result.categories.includes('EMAIL'));
  assert.equal(typeof result.total, 'number');
});

test('cloakllm:scan finds the contiguous phone from v0.12.4', async () => {
  const { send } = await loadWorker();
  const result = await send({
    type: 'cloakllm:scan', trigger: 'send', text: 'call 4155550199 to confirm',
  });
  assert.ok(result.categories.includes('PHONE'),
    'the rebuilt vendor engine must be the one actually loaded');
});

test('a scan answer carries no trace of the text', async () => {
  // The invariant, asserted at the boundary the content script actually
  // talks to rather than on the function underneath it.
  const { send } = await loadWorker();
  const planted = 'marie.dubois@example-eu.fr and 5500 0000 0000 0004';
  const result = await send({ type: 'cloakllm:scan', trigger: 'send', text: planted });

  const serialised = JSON.stringify(result);
  assert.ok(!serialised.includes('marie.dubois@example-eu.fr'));
  assert.ok(!serialised.includes('5500 0000 0000 0004'));
  assert.ok(!serialised.replace(/\D/g, '').includes('5500000000000004'));
});

test('every message type answers, or explicitly declines', async () => {
  // Six cases, none of which had ever been executed. A case that returns
  // true and then never calls sendResponse leaves the content script
  // hanging forever -- indistinguishable, from the page, from the
  // extension eating the message.
  const { send } = await loadWorker();
  for (const msg of [
    { type: 'cloakllm:scan', trigger: 'send', text: 'hello' },
    { type: 'cloakllm:record', summary: { total: 1, byCategory: { EMAIL: { count: 1 } } }, trigger: 'send', action: 'heeded' },
    { type: 'cloakllm:stats' },
    { type: 'cloakllm:getSettings' },
    { type: 'cloakllm:setSettings', patch: { logEnabled: false } },
    { type: 'cloakllm:clear' },
  ]) {
    const result = await send(msg);
    assert.notEqual(result, undefined, `${msg.type} did not answer`);
  }
});

test('an unknown message type is declined, not left hanging', async () => {
  const { send } = await loadWorker();
  assert.equal(await send({ type: 'cloakllm:nonsense' }), undefined);
  assert.equal(await send(null), undefined);
});

test('a failing storage layer still answers, and says why', async () => {
  // If settings cannot be read, the scan case must not simply go quiet --
  // that is precisely the failure that produced "scan unavailable" with
  // nothing in any console to explain it.
  const { send, shim } = await loadWorker({ storageFails: true });
  const result = await send({ type: 'cloakllm:scan', trigger: 'send', text: 'hello' });

  assert.equal(result, null, 'a broken scan answers null rather than hanging');
  assert.ok(shim.warnings.some((w) => w.includes('scan failed')),
    'and it must report the reason, not swallow it');
});

test('a reported failure cannot carry user text', async () => {
  const { mod } = await loadWorker();
  const out = mod.safeError(
    new Error('boom on marie@example.com card 5500000000000004'));
  assert.ok(!out.includes('marie@example.com'));
  assert.ok(!out.includes('5500000000000004'));
});
