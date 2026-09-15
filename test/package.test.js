// M5 packaging guards.
//
// Two failure modes worth a test. A manifest that names a file which is not
// there installs fine and does nothing -- Chrome does not complain, the
// extension just sits in the toolbar inert. And a privacy policy that has
// drifted from the declared permissions is the single fastest way to get an
// extension pulled after it has shipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  const m = listing.match(/## Short description[^\n]*\n+```\n([\s\S]*?)\n```/);
  assert.ok(m, 'short description block not found');
  assert.ok(m[1].length <= 132, `short description is ${m[1].length} chars, limit is 132`);
});

test('the extension declares no host permissions beyond its content scripts', () => {
  // Broad host_permissions are the single biggest review risk. If one ever
  // appears it should be a deliberate decision, not a drift.
  assert.equal(manifest.host_permissions, undefined,
    'host_permissions appeared -- justify it in STORE_LISTING.md first');
});
