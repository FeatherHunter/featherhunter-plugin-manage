
import { openAsar, listAll, readText } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = await openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar).map(e => e.path);
const p = all.find(x => /dsh-web-frontend\/dist\/.*index-.*\.js$/.test(x));
const t = await readText(asar, p);
for (const kw of ['asset', '__ModuleLoader__']) {
  let i = -1, n = 0;
  while ((i = t.indexOf(kw, i + 1)) !== -1 && n < 4) { n++; console.log('=== ' + kw + ' @' + i + ' ===\n' + t.slice(Math.max(0, i - 250), i + 350).replace(/\s+/g, ' ') + '\n'); }
}
