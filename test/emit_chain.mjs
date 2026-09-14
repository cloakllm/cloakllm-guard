// Emits a real findings-log chain as audit_*.jsonl, using the extension's own
// code path. Consumed by verifier_crosscheck.py, which runs the output through
// the actual Python cloakllm-verifier.
//
// Usage: node test/emit_chain.mjs <output-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scan } from '../src/worker/index.js';
import { record, exportJsonl, _setStore } from '../src/worker/log.js';

const outDir = process.argv[2];
if (!outDir) { console.error('usage: node test/emit_chain.mjs <output-dir>'); process.exit(2); }

function memoryStore() {
  const data = {};
  return {
    async get(keys) {
      const out = {};
      for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in data) out[k] = data[k];
      return out;
    },
    async set(obj) { Object.assign(data, obj); },
    async remove(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete data[k]; },
  };
}
_setStore(memoryStore());

const SAMPLES = [
  ['refund the card 5500 0000 0000 0004 for marie.dubois@example-eu.fr', 'enter', 'heeded'],
  ['iban FR76 3000 6000 0112 3456 7890 189 please', 'enter', 'sent_anyway'],
  ['key AKIAIOSFODNN7EXAMPLE and phone 06 12 34 56 78', 'submit', 'heeded'],
  ['contact pierre.laurent@example-eu.fr about it', 'enter', 'heeded'],
];

for (const [text, trigger, action] of SAMPLES) {
  await record(scan(text), { host: 'chatgpt.com', trigger, action });
}

const out = await exportJsonl();
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, out.filename), out.content, 'utf8');
console.log(`${out.filename} ${out.entries}`);
