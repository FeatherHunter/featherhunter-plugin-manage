
import { openAsar, listAll, readText } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = await openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar).map(e => e.path);
const js = all.filter(p => p.startsWith('dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/') && /\.js$/.test(p));
for (const p of js) {
  const t = await readText(asar, p);
  if (/__ModuleLoader__|ModuleLoader/.test(t)) {
    console.log('HIT', p.split('/').pop(), t.length, 'asset=' + (t.split('asset').length - 1), 'plugins=' + (t.split('plugins').length - 1));
  }
}
const html = await readText(asar, 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html');
console.log('--- index.html (' + html.length + ') ---');
console.log(html.slice(0, 1500));
