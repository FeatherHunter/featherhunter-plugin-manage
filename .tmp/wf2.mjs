
import { openAsar, listAll, readText } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = await openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar).map(e => e.path);
const js = all.filter(p => p.startsWith('dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/') && /\.js$/.test(p));
console.log('js files', js.length);
for (const p of js) {
  const t = await readText(asar, p);
  const probe = ['require.asset', 'resolveAsset', '/plugins/', 'plugins/'];
  const found = probe.map(k => k + '=' + (t.split(k).length - 1));
  console.log(p.split('/').pop(), t.length, found.join(' '));
}
