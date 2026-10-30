
import fs from 'node:fs';
import path from 'node:path';
import { openAsar, listAll, readEntry } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar);
const PKGS = ['dsh-settings','dsh-api-settings-controller','dsh-client-ui-plugin-manager','dsh-client-resources','dsh-client-ui-settings-web-search'];
const OUT = 'D:/dsh-plugin/featherhunter-plugin-manage/.dsh-src';
const PREFIX = 'dsh/node_modules/@deepseek-ai/';
let ok=0, missing=new Set(PKGS);
for (const e of all) {
  const parts = e.path.split('/');
  if (parts[0] !== 'dsh' || parts[1] !== 'node_modules' || parts[2] !== '@deepseek-ai' || !PKGS.includes(parts[3])) continue;
  missing.delete(parts[3]);
  const lower = e.path.toLowerCase();
  if (lower.endsWith('.png')||lower.endsWith('.jpg')||lower.endsWith('.map')||lower.endsWith('.woff2')||lower.endsWith('.ttf')) continue;
  try {
    const buf = readEntry(asar, e.path);
    const dest = path.join(OUT, e.path.startsWith(PREFIX) ? e.path.slice(PREFIX.length) : e.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    ok++;
  } catch (err) { console.log('FAIL', e.path, err.message); }
}
console.log('extracted', ok, 'missing pkgs:', [...missing].join(','));
