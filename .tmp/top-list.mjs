
import { openAsar, listAll } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = await openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar).map(String);
const top = new Map();
for (const p of all) { const seg = p.split('/').slice(0, 3).join('/'); top.set(seg, (top.get(seg) || 0) + 1); }
console.log([...top.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([k,v])=>k+' ('+v+')').join('\n'));
console.log('--- html files ---');
console.log(all.filter(p => /\.html$/.test(p)).slice(0, 20).join('\n'));
