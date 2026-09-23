// M5 packaging guards.
//
// Two failure modes worth a test. A manifest that names a file which is not
// there installs fine and does nothing -- Chrome does not complain, the
// extension just sits in the toolbar inert. And a privacy policy that has
// drifted from the declared permissions is the single fastest way to get an
// extension pulled after it has shipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ADAPTERS } from '../src/sites/index.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const exists = (p) => { try { statSync(join(ROOT, p)); return true; } catch { return false; } };

test('every file the manifest names exists', () => {
  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...manifest.content_scripts.flatMap((cs) => cs.js),
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action.default_icon || {}),
  ];
  for (const p of referenced) {
    assert.ok(exists(p), `manifest references ${p}, which is not on disk`);
  }
});

test('icons are real PNGs at the declared sizes', () => {
  for (const [size, path] of Object.entries(manifest.icons)) {
    const buf = readFileSync(join(ROOT, path));
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${path} is not a PNG`);
    // IHDR width/height live at bytes 16..24.
    assert.equal(buf.readUInt32BE(16), Number(size), `${path} is the wrong width`);
    assert.equal(buf.readUInt32BE(20), Number(size), `${path} is the wrong height`);
  }
});

test('MANIFEST AND ADAPTERS AGREE, IN BOTH DIRECTIONS', () => {
  // Found by audit, 2026-09-20. The existing checks all ran one way --
  // manifest -> privacy policy, manifest -> listing -- and nothing checked
  // adapter -> manifest. So the copilot adapter claimed www.bing.com and the
  // claude adapter claimed *.claude.ai while the manifest injected into
  // neither: dead branches that overstated coverage to anyone reading the
  // file, and a trap if a later manifest change ever made them live with
  // selectors nobody had verified.
  //
  // The reason it went unnoticed is worth more than the bug: `matches` was a
  // PREDICATE, and a predicate cannot be enumerated, so no test could ask
  // "which hosts does this adapter claim?". It is a list now.
  const declared = manifest.content_scripts.flatMap((cs) => cs.matches)
    .map((p) => p.replace(/^https:\/\//, '').replace(/\/\*$/, ''));

  for (const a of ADAPTERS) {
    for (const host of a.hosts) {
      assert.ok(declared.includes(host),
        `the ${a.id} adapter claims ${host}, but no content script runs there `
        + `-- it would never protect that site`);
    }
  }

  for (const host of declared) {
    const owner = ADAPTERS.find((a) => a.matches(host));
    assert.ok(owner,
      `the manifest injects into ${host}, but no adapter claims it `
      + `-- it would fall back to generic selectors with no health reporting`);
  }
});

test('every adapter host list is non-empty and exactly matched', () => {
  for (const a of ADAPTERS) {
    assert.ok(Array.isArray(a.hosts) && a.hosts.length, `${a.id} has no hosts`);
    for (const h of a.hosts) assert.equal(a.matches(h), true, `${a.id} vs ${h}`);
    // Exact match only -- no accidental subdomain widening.
    assert.equal(a.matches(`evil-${a.hosts[0]}`), false);
    assert.equal(a.matches(`${a.hosts[0]}.evil.test`), false);
  }
});

test('the privacy policy documents every declared permission', () => {
  const privacy = read('PRIVACY.md');
  for (const perm of manifest.permissions || []) {
    assert.match(privacy, new RegExp(`\`${perm}\``),
      `PRIVACY.md does not mention the "${perm}" permission`);
  }
});

test('the privacy policy lists every host the extension can read', () => {
  const privacy = read('PRIVACY.md');
  for (const pattern of manifest.content_scripts[0].matches) {
    const host = pattern.replace(/^https:\/\//, '').replace(/\/\*$/, '');
    assert.ok(privacy.includes(host),
      `PRIVACY.md does not disclose access to ${host}`);
  }
});

test('the store listing discloses the coverage boundary', () => {
  // PLAN_extension_v01.md sec.6: the blind spot goes in the listing, not a
  // footnote. A tool that implies coverage it does not have manufactures false
  // assurance, which for a compliance-adjacent brand is worse than shipping
  // nothing.
  const listing = read('STORE_LISTING.md');
  assert.match(listing, /CANNOT SEE/);
  for (const term of ['desktop', 'Cursor']) {
    assert.ok(listing.includes(term), `listing should name the ${term} blind spot`);
  }
});

test('the short description fits the store limit', () => {
  const listing = read('STORE_LISTING.md');
  // CRLF-tolerant. This pattern used to assume \n, and with
  // core.autocrlf=true every Windows checkout is CRLF -- so the test failed
  // on any fresh Windows clone. CI runs on Linux and never saw it; it passed
  // locally only because one working copy happened to be LF. A test that
  // depends on the line endings of the machine it runs on is testing the
  // machine.
  const m = listing.match(/## Short description[^\r\n]*(?:\r?\n)+```\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(m, 'short description block not found');
  assert.ok(m[1].length <= 132, `short description is ${m[1].length} chars, limit is 132`);
});

test('the store summary IS the manifest description, word for word', () => {
  // The dashboard shows manifest.json's `description` under the title and
  // does not let you edit it there. The listing doc had one short
  // description and the manifest another -- and the manifest's said the
  // extension warns "before you paste", when it warns before you SEND.
  // Two copies of a public sentence drift; this makes them one.
  const listing = read('STORE_LISTING.md');
  const m = listing.match(/## Short description[^\r\n]*(?:\r?\n)+```\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(m, 'short description block not found');
  assert.equal(manifest.description, m[1],
    'manifest.json description and STORE_LISTING.md short description differ');
  assert.ok(manifest.description.length <= 132);
});

test('the extension declares no host permissions beyond its content scripts', () => {
  // Broad host_permissions are the single biggest review risk. If one ever
  // appears it should be a deliberate decision, not a drift.
  assert.equal(manifest.host_permissions, undefined,
    'host_permissions appeared -- justify it in STORE_LISTING.md first');
});

// --------------------------------------------------- screenshot claims --
// The store screenshots make public claims. store/screenshots/04-privacy.png
// says "one permission: storage" and "the extension contains no network
// code". A PNG is a frozen artifact: if either stops being true the image
// keeps saying it. These tests make the build fail first, so the screenshot
// is regenerated before the listing is updated, not after someone notices.

test('SCREENSHOT CLAIM: the only permission requested is storage', () => {
  assert.deepEqual(manifest.permissions, ['storage'],
    'permissions changed -- regenerate the store screenshots (npm run store) '
    + 'and update the claims table in STORE_LISTING.md');
});

test('SCREENSHOT CLAIM: nothing that ships contains network code', () => {
  // Deliberately a claim about CODE, not about permissions: an MV3
  // extension without host permissions can still fetch CORS-enabled
  // endpoints, so the permission list alone would not prove this.
  const NET = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|new\s+Image\s*\(|importScripts\s*\(/;

  const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true })
    .flatMap((d) => (d.isDirectory()
      ? walk(join(dir, d.name))
      : /\.(m?js|html)$/.test(d.name) ? [join(dir, d.name)] : []));

  // Built outputs are the most important files to scan -- they are what
  // actually runs -- so their absence must fail, not quietly shrink the scan.
  for (const built of ['dist/content.js', 'src/vendor/cloakllm-detect.js']) {
    assert.ok(exists(built), `${built} missing: run \`npm run build\` first, `
      + 'or this scan would pass without looking at the code that ships');
  }

  const files = [...walk('src'), ...walk('dist')];
  assert.ok(files.length > 10, `scanned only ${files.length} files`);
  const hits = files.filter((f) => NET.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(hits, [],
    `network code found in shipped files: ${hits.join(', ')} -- the store `
    + 'screenshots and PRIVACY.md both say there is none');
});
