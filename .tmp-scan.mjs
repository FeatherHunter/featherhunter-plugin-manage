
import { openAsar, listAll, readEntry } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar).filter(e => /\.(js|mjs|cjs|json|md|ts|d\.ts)$/i.test(e.path));
const needles = ['settings.section', 'settings.plugins.tab', 'sidebar.settings'];
const hits = new Map();
let scanned = 0;
for (const e of all) {
  if (e.size > 8_000_000) continue;
  let txt;
  try { txt = readEntry(asar, e.path).toString('utf8'); } catch { continue; }
  scanned++;
  for (const n of needles) {
    if (txt.includes(n)) {
      const key = e.path;
      if (!hits.has(key)) hits.set(key, new Set());
      hits.get(key).add(n);
    }
  }
}
console.log('scanned', scanned, 'hits', hits.size);
for (const [p, ns] of [...hits].sort()) console.log([...ns].join(','), '|', p);
