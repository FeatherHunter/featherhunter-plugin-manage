
import { openAsar, listAll } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = await openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar).map(String);
const js = all.filter(p => /\.js$/.test(p) && /dist|assets|static/i.test(p));
console.log('total', all.length, '| dist-ish js', js.length);
console.log(js.slice(0, 25).join('\n'));
