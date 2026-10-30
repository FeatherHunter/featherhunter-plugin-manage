import { openAsar, listAll } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const a = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(a);
const names = new Set();
for (const e of all) { const m = e.path.match(/node_modules\/(@deepseek-ai\/[^/]+)\//); if (m) names.add(m[1]); }
const arr = [...names].sort();
console.log('TOTAL PKGS', arr.length);
console.log(arr.filter(n => /web|front|bundle|ui-/.test(n)).join('\n'));
