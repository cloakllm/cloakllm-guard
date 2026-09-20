// Bundles the CloakLLM detection subset into src/vendor/cloakllm-detect.js.
//
// Only the regex detection path is vendored. Nothing else from the SDK ships:
// no audit chain, no attestation, no timestamping, no ShieldConfig -- see
// PLAN_extension_v01.md sec.2 for why each is deliberately out of v0.1.
//
// This is possible because of the patterns.js extraction (M0 finding): before
// it, importing PATTERNS reached detector.js -> backends/llm.js ->
// llm-detector.js -> child_process/net, which fails a browser build outright
// and puts "child_process" in an extension bundle.
import * as esbuild from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const OUT = 'src/vendor/cloakllm-detect.js';
mkdirSync('src/vendor', { recursive: true });

await esbuild.build({
  entryPoints: ['src/vendor-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome111',
  minify: true,
  outfile: OUT,
  legalComments: 'none',
});

// The content script must be a CLASSIC script -- MV3 content_scripts have no
// ES-module support (unlike the service worker, which runs as type: "module"
// and can import the vendor bundle directly). So it gets bundled to an IIFE.
await esbuild.build({
  entryPoints: ['src/content/events.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome111',
  outfile: 'dist/content.js',
  legalComments: 'none',
});
console.log('built dist/content.js');

const bytes = readFileSync(OUT);
const gz = gzipSync(bytes).length;

// Guard rails: the whole point of the vendored subset is that it carries no
// Node runtime and no runtime code generation. Fail the build if either
// creeps back in via an SDK change upstream.
const src = bytes.toString('utf8');
const FORBIDDEN = [
  ['node require', /__require\s*\(|(?<![\w.$])require\s*\(/],
  ['child_process', /child_process/],
  ['node:net', /["']net["']/],
  ['node:fs', /["']fs["']/],
  ['eval()', /(?<![\w.$])eval\s*\(/],
  ['new Function()', /new\s+Function\s*\(/],
  ['importScripts()', /importScripts\s*\(/],
];
const hits = FORBIDDEN.filter(([, re]) => re.test(src)).map(([label]) => label);

// v0.12.5: the list above only catches Node builtins imported BY NAME. It
// said "ok: no Node builtins" about a bundle that called process.cpuUsage()
// on every detector construction -- because `process` is an ambient global,
// not an import. The service worker died on ReferenceError the moment it
// tried to scan, and the build had certified it as clean.
//
// So the real question is not "is a builtin imported" but "does this run
// outside Node". Answer it by running it outside Node: strip the global and
// build a detector.
const realProcess = globalThis.process;
let browserSafe = true;
let browserError = '';
try {
  delete globalThis.process;
  const mod = await import(`data:text/javascript,${encodeURIComponent(src)}`);
  const detector = mod.createDetector();
  mod.detect(detector, 'smoke test 4111 1111 1111 1111');
} catch (err) {
  browserSafe = false;
  browserError = `${err.name}: ${err.message}`;
} finally {
  globalThis.process = realProcess;
}

console.log(`built ${OUT}  ${(bytes.length / 1024).toFixed(1)} KB  (${(gz / 1024).toFixed(1)} KB gzipped)`);
if (hits.length) {
  console.error(`FAIL: forbidden constructs in the vendored bundle: ${hits.join(', ')}`);
  process.exit(1);
}
if (!browserSafe) {
  console.error(`FAIL: the bundle cannot run outside Node -- ${browserError}`);
  console.error('       A service worker has no `process`. Guard the reference');
  console.error('       with `typeof process !== "undefined"` or drop it.');
  process.exit(1);
}
console.log('ok: no Node builtins, no runtime code generation, runs without `process`');
