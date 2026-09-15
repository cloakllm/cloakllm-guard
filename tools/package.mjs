// Builds the uploadable .zip.
//
// The failure this guards against is a package that installs but does not
// work: a manifest referencing dist/content.js while the zip omits it, or a
// module the worker imports that never made it in. Chrome will happily accept
// such a package and the extension will sit in the toolbar doing nothing.
//
// So the file list is DERIVED -- the manifest is read, every path it names is
// resolved, and the worker's import graph is walked -- rather than hand-listed
// and hoped over. Anything missing fails the build.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

// --- work out what must ship ---------------------------------------------

/** Follow relative `import ... from '...'` edges from an entry module. */
function importGraph(entry, seen = new Set()) {
  const abs = resolve(ROOT, entry);
  const rel = posix.normalize(relative(ROOT, abs).split('\\').join('/'));
  if (seen.has(rel)) return seen;
  seen.add(rel);
  const src = readFileSync(abs, 'utf8');
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
    if (!m[1].startsWith('.')) continue;
    importGraph(posix.join(posix.dirname(rel), m[1]), seen);
  }
  return seen;
}

/** Relative script/stylesheet references from an HTML page. */
function pageAssets(page) {
  const abs = resolve(ROOT, page);
  const src = readFileSync(abs, 'utf8');
  const dir = posix.dirname(page.split('\\').join('/'));
  const out = new Set([page]);
  for (const m of src.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    if (m[1].startsWith('http') || m[1].startsWith('#')) continue;
    const rel = posix.normalize(posix.join(dir, m[1]));
    out.add(rel);
    if (rel.endsWith('.js')) for (const f of importGraph(rel)) out.add(f);
  }
  return out;
}

const files = new Set(['manifest.json']);
for (const f of importGraph(manifest.background.service_worker)) files.add(f);
for (const cs of manifest.content_scripts) for (const js of cs.js) files.add(js);
for (const p of Object.values(manifest.icons || {})) files.add(p);
for (const p of Object.values((manifest.action && manifest.action.default_icon) || {})) files.add(p);
if (manifest.action && manifest.action.default_popup) {
  for (const f of pageAssets(manifest.action.default_popup)) files.add(f);
}
if (manifest.options_page) for (const f of pageAssets(manifest.options_page)) files.add(f);
files.add('LICENSE');
files.add('PRIVACY.md');

// --- verify ---------------------------------------------------------------

const missing = [...files].filter((f) => {
  try { statSync(join(ROOT, f)); return false; } catch { return true; }
});
if (missing.length) {
  console.error('FAIL: files referenced but not present:\n  ' + missing.join('\n  '));
  console.error('\n(did you run `npm run build`?)');
  process.exit(1);
}

const FORBIDDEN = /^(test\/|tools\/|node_modules\/|\.git)/;
const leaked = [...files].filter((f) => FORBIDDEN.test(f));
if (leaked.length) {
  console.error('FAIL: these must not ship:\n  ' + leaked.join('\n  '));
  process.exit(1);
}

// --- write the zip --------------------------------------------------------
// Store/deflate by hand: a build dependency for one zip is not worth it.

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const entries = [];
const chunks = [];
let offset = 0;

for (const name of [...files].sort()) {
  const data = readFileSync(join(ROOT, name));
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const nameBuf = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(useDeflate ? 8 : 0, 8);
  local.writeUInt32LE(0, 10);                 // fixed dos time -> reproducible
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  entries.push({ name: nameBuf, crc: crc32(data), comp: body.length, raw: data.length, offset, useDeflate });
  chunks.push(local, nameBuf, body);
  offset += local.length + nameBuf.length + body.length;
}

const central = [];
for (const e of entries) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(20, 6);
  h.writeUInt16LE(0, 8);
  h.writeUInt16LE(e.useDeflate ? 8 : 0, 10);
  h.writeUInt32LE(0, 12);
  h.writeUInt32LE(e.crc, 16);
  h.writeUInt32LE(e.comp, 20);
  h.writeUInt32LE(e.raw, 24);
  h.writeUInt16LE(e.name.length, 28);
  h.writeUInt32LE(e.offset, 42);
  central.push(h, e.name);
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(join(ROOT, 'build'), { recursive: true });
const out = join(ROOT, 'build', `cloakllm-guard-${manifest.version}.zip`);
writeFileSync(out, Buffer.concat([...chunks, centralBuf, end]));

const size = statSync(out).size;
console.log(`packaged ${entries.length} files -> build/cloakllm-guard-${manifest.version}.zip `
  + `(${(size / 1024).toFixed(1)} KB)`);
for (const name of [...files].sort()) console.log(`  ${name}`);
