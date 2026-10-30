
import { openAsar, listAll } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = await openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar).map(e => e.path);
const d = all.filter(p => p.startsWith('dsh/node_modules/@deepseek-ai/dsh-web-frontend/'));
console.log('files', d.length);
console.log(d.map(p => p + '  ' + all.filter(x=>x===p).length).slice(0, 30).join('\n'));
