// Capture the Chrome Web Store screenshots with headless Chrome.
//
//   1. start the harness:  node tools/ui-harness.mjs   (or the "guard-ui"
//      launch configuration)
//   2. node tools/store/capture.mjs
//
// Writes store/screenshots/*.png (1280x800) and store/promo-tile-440x280.png,
// then reads each PNG's own header back and FAILS if the dimensions are not
// exactly what the store accepts. Checking the file rather than trusting the
// window size is the point: a screenshot rejected at upload is found on the
// day you are trying to submit.
//
// Zero dependencies. Chrome runs with its own throwaway profile, so an open
// desktop Chrome is untouched, and it is invoked with an argument LIST -- no
// shell, so paths with spaces cannot be split.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const BASE = 'http://localhost:5178/tools/store/frame.html';

const SHOTS = [
  { file: 'screenshots/01-warning.png', shot: 'warning', w: 1280, h: 800 },
  { file: 'screenshots/02-popup.png', shot: 'popup', w: 1280, h: 800 },
  { file: 'screenshots/03-settings.png', shot: 'settings', w: 1280, h: 800 },
  { file: 'screenshots/04-privacy.png', shot: 'privacy', w: 1280, h: 800 },
  { file: 'promo-tile-440x280.png', shot: 'tile', w: 440, h: 280 },
];

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error('No Chrome/Edge found; set CHROME_BIN');
  return hit;
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path) {
  const b = readFileSync(path);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => b[i] === v)) throw new Error(`${path} is not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

async function harnessUp() {
  try {
    const r = await fetch(`${BASE}?shot=tile`);
    return r.ok;
  } catch {
    return false;
  }
}

if (!(await harnessUp())) {
  console.error('FAIL: the UI harness is not answering on :5178. Start it first:');
  console.error('      node tools/ui-harness.mjs');
  process.exit(1);
}

const chrome = findChrome();
const outDir = join(ROOT, 'store');
mkdirSync(join(outDir, 'screenshots'), { recursive: true });

let failed = 0;
for (const s of SHOTS) {
  const out = join(outDir, s.file);
  const profile = mkdtempSync(join(tmpdir(), 'guard-shot-'));
  try {
    execFileSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      `--window-size=${s.w},${s.h}`,
      // Module scripts, an iframe and a worker round trip all have to settle.
      '--virtual-time-budget=5000',
      `--screenshot=${out}`,
      `${BASE}?shot=${s.shot}`,
    ], { stdio: 'pipe', timeout: 60000 });
  } catch (e) {
    console.error(`FAIL ${s.file}: chrome exited: ${e.message.split('\n')[0]}`);
    failed++;
    continue;
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
  const got = pngSize(out);
  const ok = got.w === s.w && got.h === s.h;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${s.file}  ${got.w}x${got.h}${ok ? '' : `  (store needs ${s.w}x${s.h})`}`);
}

process.exit(failed ? 1 : 0);
