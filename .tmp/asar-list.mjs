import { openAsar, listAll } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const a = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(a);
console.log('TOTAL', all.length);
const md = all.filter(e => e.path.endsWith('.md') && !e.path.includes('node_modules'));
console.log('MD(non-node_modules)', md.length);
for (const e of md.slice(0, 80)) console.log(e.path, e.size);
