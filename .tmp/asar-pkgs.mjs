import { openAsar, listAll } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const a = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(a);
const set = new Set();
for (const e of all) { const m = e.path.match(/node_modules\/(@deepseek-ai\/[^/]+)\//); if (m) set.add(m[1]); }
const hits = [...set].filter(x => /slot|settings|ui-settings|client-ui/.test(x)).sort();
console.log(hits.join('\n'));
