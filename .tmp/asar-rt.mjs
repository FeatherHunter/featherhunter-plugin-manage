import fs from 'node:fs';import path from 'node:path';
import { openAsar, listAll, readEntry } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const a = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(a);
const names = new Set();
for (const e of all) { const m = e.path.match(/node_modules\/(@deepseek-ai\/[^/]+)\//); if (m) names.add(m[1]); }
const cands = [...names].filter(n => /runtime|slots|client-modules|cordis-client/.test(n));
console.log('CANDS', cands.join(', '));
for (const n of cands) {
  const pj = all.find(e => e.path === 'dsh/node_modules/' + n + '/package.json');
  if (pj) { const j = JSON.parse(readEntry(a, pj.path).toString('utf8')); console.log(n, j.version, 'files:', (j.files||[]).join(',')); }
}
