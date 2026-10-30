
import fs from 'node:fs';
import path from 'node:path';
import { openAsar, listAll, readEntry } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar);
const PKGS = ['dsh-cordis-client-runner','dsh-client-ui-settings-general','dsh-client-ui-sidebar','dsh-client-ui-settings-account','dsh-client-ui-settings-models','dsh-client-ui-settings-plugin-inventory','dsh-client-ui-agent-preset','dsh-client-modules','dsh-client-ui-primitives'];
const OUT = 'D:/dsh-plugin/featherhunter-plugin-manage/.dsh-src';
const PREFIX = 'dsh/node_modules/@deepseek-ai/';
let ok=0;
for (const e of all) {
  const parts = e.path.split('/');
  if (parts[0] !== 'dsh' || parts[1] !== 'node_modules' || parts[2] !== '@deepseek-ai' || !PKGS.includes(parts[3])) continue;
  const lower = e.path.toLowerCase();
  if (lower.endsWith('.png')||lower.endsWith('.jpg')||lower.endsWith('.jpeg')||lower.endsWith('.gif')||lower.endsWith('.webp')||lower.endsWith('.map')||lower.endsWith('.woff')||lower.endsWith('.woff2')||lower.endsWith('.ttf')||lower.endsWith('.ico')) continue;
  try {
    const buf = readEntry(asar, e.path);
    const dest = path.join(OUT, e.path.startsWith(PREFIX) ? e.path.slice(PREFIX.length) : e.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    ok++;
  } catch (err) { console.log('FAIL', e.path, err.message); }
}
console.log('extracted', ok);
