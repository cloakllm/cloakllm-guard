// Render popup.html and options.html in a real browser.
//
// These two pages had never been opened anywhere when this was written
// (2026-09-23) -- the only part of the extension with no coverage of any
// kind. Every defect found in this codebase in the preceding week lived in
// code that had never been run in a browser, so "never opened" is not a
// small gap.
//
// They cannot simply be loaded from disk: both are ES modules that call
// `chrome.runtime` / `chrome.storage`, which do not exist outside an
// extension. So this serves the REAL files over http and injects a `chrome`
// shim as a CLASSIC script before the module tag -- classic scripts run
// before deferred modules, so the shim is in place by the time popup.js
// executes.
//
// What this does NOT prove: real MV3 message passing, real extension
// packaging, real popup sizing chrome applies. It proves the pages render,
// their own logic runs against realistic worker responses, and they behave
// when the worker answers nothing. Those are the failures worth catching
// before a store submission.
//
// Usage: node tools/ui-harness.mjs   (serves on 5178)
//        /?state=empty | populated | broken
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// The extension's REAL defaults, not a hand-written copy. The first version
// of this shim carried its own settings map, which happened to agree with
// settings.js -- by coincidence, and only until someone changed a default.
import { DEFAULTS } from '../src/shared/settings.js';

// fileURLToPath, not URL.pathname: on Windows the latter yields
// "/C:/Users/..." with forward slashes, while path.join returns backslashes,
// so the containment check below compared two different spellings of the same
// directory and refused every request with a 403.
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = 5178;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Realistic worker responses, so the pages render what a real user sees. */
const SHIM = (state) => `
(() => {
  const STATE = ${JSON.stringify(state)};
  const stats = STATE === 'empty'
    ? { shown: 0, heeded: 0, sent_anyway: 0, heeded_pct: 0, byCategory: {}, first: null, last: null }
    : { shown: 37, heeded: 31, sent_anyway: 6, heeded_pct: 84,
        byCategory: { IBAN: 14, EMAIL: 11, CREDIT_CARD: 7, PHONE: 3, API_KEY: 2 },
        first: '2026-09-01T09:12:00.000Z', last: '2026-09-23T16:40:00.000Z' };
  const settings = ${JSON.stringify(DEFAULTS)};
  const answer = (msg) => {
    if (STATE === 'broken') return null;            // worker never answers usefully
    switch (msg && msg.type) {
      case 'cloakllm:stats': return stats;
      case 'cloakllm:getSettings': return settings;
      case 'cloakllm:setSettings': return Object.assign({}, settings, msg.patch || {});
      case 'cloakllm:clear': return { ok: true };
      case 'cloakllm:export': return {
        filename: 'audit_guard_epoch_1.jsonl', entries: 37,
        content: '{"seq":1,"event_type":"guard_warning"}\\n',
      };
      default: return null;
    }
  };
  globalThis.chrome = {
    runtime: {
      id: 'cloakllm-guard-harness',
      lastError: STATE === 'broken' ? { message: 'no receiving end' } : null,
      sendMessage: (msg, cb) => { if (cb) setTimeout(() => cb(answer(msg)), 0); },
      openOptionsPage: () => { location.href = '/src/ui/options.html?state=' + STATE; },
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async () => [], sendMessage: () => {} },
  };
  window.__HARNESS_ERRORS = [];
  addEventListener('error', (e) => window.__HARNESS_ERRORS.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => window.__HARNESS_ERRORS.push('unhandled: ' + e.reason));
})();
`;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const state = url.searchParams.get('state') || 'populated';

  if (url.pathname === '/__shim.js') {
    res.writeHead(200, { 'content-type': TYPES['.js'] });
    res.end(SHIM(state));
    return;
  }

  // Redirect rather than serve popup.html AT "/": the page's own references
  // are relative ("popup.js", "shared.css", "../shared/labels.js"), so
  // serving it from the root resolves every one of them against "/" and they
  // all 404 -- which renders the EMPTY state and looks like a data problem
  // instead of a harness problem.
  if (url.pathname === '/') {
    res.writeHead(302, { location: `/src/ui/popup.html?state=${state}` });
    res.end();
    return;
  }
  const p = url.pathname;
  const file = resolve(join(ROOT, normalize(decodeURIComponent(p)).replace(/^[\\/]+/, '')));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('outside root');
    return;
  }

  try {
    let body = await readFile(file);
    if (extname(file) === '.html') {
      // Classic script, so it runs BEFORE the deferred module tag.
      // The state MUST ride on the shim's own URL. Without it the browser
      // requests a bare /__shim.js, the server sees no query string, and
      // every state silently renders as "populated" -- a harness that
      // answers the same thing whatever you ask it.
      body = body.toString('utf8').replace(
        /<script type="module"/,
        `<script src="/__shim.js?state=${encodeURIComponent(state)}"></script>\n  <script type="module"`,
      );
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: ' + p);
  }
}).listen(PORT, () => console.log(`ui-harness on http://localhost:${PORT}`));
