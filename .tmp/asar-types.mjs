import { openAsar, listAll } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const a = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(a);
const hits = all.filter(e => e.path.includes('client-ui-settings/') && e.path.includes('types'));
console.log('typefiles', hits.length);
for (const e of hits) console.log(e.path, e.size);
