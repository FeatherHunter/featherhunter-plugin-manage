
import fs from 'node:fs';
import path from 'node:path';
import { openAsar, listAll, readEntry } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar);
const prefixes = [
  'dsh/node_modules/@deepseek-ai/dsh-client-ui-settings/',
  'dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-plugins/',
  'dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-shell/',
  'dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/',
  'dsh/node_modules/@deepseek-ai/dsh-host-webserver/',
  'dsh/node_modules/@deepseek-ai/dsh-shell/',
  'dsh/node_modules/@deepseek-ai/dsh-client-runtime/',
];
const OUT = 'D:/dsh-plugin/featherhunter-plugin-manage/.dsh-src';
let ok = 0, fail = 0;
for (const e of all) {
  const p = prefixes.find(x => e.path.startsWith(x));
  if (!p) continue;
  if (/\.(png|jpg|jpeg|gif|webp|woff2?|ttf|ico)$/i.test(e.path)) continue;
  try {
    const buf = readEntry(asar, e.path);
    const dest = path.join(OUT, e.path.replace(/^dsh\/node_modules\/@deepseek-ai\//, ''));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    ok++;
  } catch (err) { console.log('FAIL', e.path, err.message); fail++; }
}
console.log('extracted', ok, 'failed', fail);
// also report whether dsh-client-runtime exists
console.log('runtime exists:', all.some(e => e.path.includes('dsh-client-runtime')));
