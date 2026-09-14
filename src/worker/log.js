// The findings log: a hash-chained, CONTENT-FREE record of warnings.
//
// What it is for, in order of actual value (PLAN_extension_v01.md sec. 5a):
//   1. the pilot instrument -- "37 near-misses across 9 people, mostly IBANs"
//      is a deliverable that needs no prompt to ever be collected
//   2. the product metric -- heeded/shown, which is how this thing is judged
//   3. a record for the person
//
// What it is NOT: evidence about anyone. A chain on a device its subject
// controls detects EDITS but not deletion of the TAIL -- demonstrated, not
// assumed (scratchpad/verifier_probe.py case 3). Local-only, that limit is
// trivial to exploit and so this must never be described as an audit trail.
//
// Only WARNINGS are recorded. A clean send writes nothing, because logging
// every message someone types is exactly the product this is not.
import { canonicalJson } from '../vendor/cloakllm-detect.js';

const STATE_KEY = 'guard_state_v1';
const EPOCH_KEY = (n) => `guard_epoch_${n}`;
const GENESIS = '0'.repeat(64);

const MAX_ENTRIES_PER_EPOCH = 500;
const MAX_EPOCHS = 5;

const hex = (buf) => [...new Uint8Array(buf)]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

/** Entry hash, identical in construction to AuditLogger._compute_hash. */
async function computeHash(entry) {
  return sha256Hex(canonicalJson(entry));
}

// --- storage seam ---------------------------------------------------------
// Indirected so tests can run without a chrome runtime.
let store = {
  async get(keys) { return chrome.storage.local.get(keys); },
  async set(obj) { return chrome.storage.local.set(obj); },
  async remove(keys) { return chrome.storage.local.remove(keys); },
};
export function _setStore(s) { store = s; }

// --- serialisation --------------------------------------------------------
// Appends MUST NOT interleave. Two concurrent records would read the same
// prevHash and both claim it, forking the chain and failing verification for
// everything after. A service worker handles messages concurrently, so this
// is a real race, not a theoretical one.
let tail = Promise.resolve();
function serialise(fn) {
  const next = tail.then(fn, fn);
  tail = next.catch(() => {});
  return next;
}

async function readState() {
  const got = await store.get(STATE_KEY);
  return got[STATE_KEY] || { epoch: 0, seq: 0, prevHash: GENESIS, openedAt: null };
}

async function readEpoch(n) {
  const key = EPOCH_KEY(n);
  const got = await store.get(key);
  return got[key] || [];
}

/**
 * Open a new epoch.
 *
 * Epochs exist because retention cannot be a ring buffer: dropping the oldest
 * entries would break verification from genesis. Each epoch instead starts a
 * fresh chain and records the previous epoch's final hash, so the two remain
 * linked in meaning while each verifies independently.
 */
async function openEpoch(state, now) {
  const epoch = state.epoch + 1;
  const entry = {
    seq: 1,
    timestamp: now,
    event_type: 'guard_epoch_open',
    epoch,
    previous_epoch_final_hash: state.prevHash,
    host: null,
    trigger: null,
    total: 0,
    categories: {},
    action: null,
    prev_hash: GENESIS,
  };
  entry.entry_hash = await computeHash(entry);

  await store.set({ [EPOCH_KEY(epoch)]: [entry] });

  // Drop epochs past the retention window.
  const stale = epoch - MAX_EPOCHS;
  if (stale > 0) await store.remove(EPOCH_KEY(stale));

  return { epoch, seq: 1, prevHash: entry.entry_hash, openedAt: now };
}

/**
 * Record one warning.
 *
 * Takes a summary exactly as `scan()` / `summarise()` produces it -- note that
 * `.categories` there is an ARRAY OF NAMES and `.byCategory` is the map. The
 * counts come from `byCategory`; reshaping at the call site instead is how the
 * two get confused.
 *
 * @param {{total: number, byCategory: Record<string,{count:number}>}} summary
 * @param {{host: string, trigger: string, action: 'sent_anyway'|'heeded'}} meta
 */
export function record(summary, meta) {
  return serialise(async () => {
    const now = new Date().toISOString();
    let state = await readState();

    if (state.epoch === 0) state = await openEpoch({ epoch: 0, prevHash: GENESIS }, now);
    else if ((await readEpoch(state.epoch)).length >= MAX_ENTRIES_PER_EPOCH) {
      state = await openEpoch(state, now);
    }

    // Counts only. `spans` are deliberately dropped: the live summary needs
    // offsets for future highlighting, a stored record does not, and offsets
    // leak the length and structure of what was written -- against a known
    // template that is more revealing than it looks.
    const categories = {};
    for (const [cat, v] of Object.entries(summary.byCategory || {})) {
      categories[cat] = typeof v === 'number' ? v : v.count;
    }

    const entry = {
      seq: state.seq + 1,
      timestamp: now,
      event_type: 'guard_warning',
      epoch: state.epoch,
      host: meta.host || null,
      trigger: meta.trigger || null,
      total: summary.total || 0,
      categories,
      action: meta.action,
      prev_hash: state.prevHash,
    };
    entry.entry_hash = await computeHash(entry);

    const entries = await readEpoch(state.epoch);
    entries.push(entry);
    await store.set({
      [EPOCH_KEY(state.epoch)]: entries,
      [STATE_KEY]: { ...state, seq: entry.seq, prevHash: entry.entry_hash },
    });
    return entry;
  });
}

/** Every retained entry, oldest epoch first. */
export async function allEntries() {
  const state = await readState();
  const out = [];
  for (let n = Math.max(1, state.epoch - MAX_EPOCHS + 1); n <= state.epoch; n++) {
    out.push(...await readEpoch(n));
  }
  return out;
}

/**
 * Derived stats. Never stored alongside the log -- a separately-maintained
 * counter can disagree with the entries it claims to summarise.
 */
export async function stats() {
  const entries = (await allEntries()).filter((e) => e.event_type === 'guard_warning');
  const byCategory = {};
  let heeded = 0;
  for (const e of entries) {
    if (e.action === 'heeded') heeded += 1;
    for (const [cat, n] of Object.entries(e.categories || {})) {
      byCategory[cat] = (byCategory[cat] || 0) + n;
    }
  }
  const shown = entries.length;
  return {
    shown,
    heeded,
    sent_anyway: shown - heeded,
    // Integer percent: the cross-SDK rounding-divergence lesson applies to any
    // number that might later be compared across implementations.
    heeded_pct: shown === 0 ? 0 : Math.round((heeded * 100) / shown),
    byCategory,
    first: entries.length ? entries[0].timestamp : null,
    last: entries.length ? entries[entries.length - 1].timestamp : null,
  };
}

/**
 * Export as JSONL.
 *
 * The filename matters: cloakllm-verifier reads ONLY audit_*.jsonl and ignores
 * anything else (it fails cleanly rather than passing, but it will not verify
 * a differently-named file). Callers must keep that prefix.
 *
 * It must ALSO never be written into an SDK audit directory: verify_chain's
 * compliance-report mode aggregates `categories` from every entry it reads, so
 * co-located guard entries would silently inflate a real report's PII totals
 * with browser near-miss counts.
 */
export async function exportJsonl(epoch) {
  const state = await readState();
  const n = epoch || state.epoch;
  const entries = await readEpoch(n);
  return {
    filename: `audit_guard_epoch_${n}.jsonl`,
    content: entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''),
    entries: entries.length,
  };
}

/** Wipe everything. Always available -- coherent because this is not evidence. */
export function clear() {
  return serialise(async () => {
    const state = await readState();
    const keys = [STATE_KEY];
    for (let n = 1; n <= state.epoch; n++) keys.push(EPOCH_KEY(n));
    await store.remove(keys);
  });
}

export const _internals = { computeHash, GENESIS, MAX_ENTRIES_PER_EPOCH, MAX_EPOCHS };
