import fs from 'node:fs';import path from 'node:path';
import { openAsar, listAll, readEntry } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const a = openAsar('D:/DeepseekHarness/resources/app.asar');
const prefix = 'dsh/node_modules/@deepseek-ai/' + process.argv[2] + '/';
const out = path.join('D:/dsh-plugin/featherhunter-plugin-manage/.dsh-src/_extra');
const all = listAll(a).filter(e => e.path.startsWith(prefix));
let n = 0;
for (const e of all) {
  const rel = e.path.slice(prefix.length);
  const dest = path.join(out, process.argv[2], rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, readEntry(a, e.path)); n++;
}
console.log('extracted', n, 'files for', process.argv[2]);
