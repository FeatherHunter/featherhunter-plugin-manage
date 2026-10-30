import { openAsar, listAll } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar);
console.log('TOTAL', all.length);
const want = all.filter(e => /ui-settings|client-slots|dsh-client|slot/i.test(e.path));
console.log('MATCH', want.length);
for (const e of want.slice(0, 200)) console.log(e.size, e.path);
