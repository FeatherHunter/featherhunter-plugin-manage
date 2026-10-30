
import { openAsar, listAll, readText } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = await openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar).map(e => e.path);
const pkgs = ['dsh-client-modules','dsh-host-webserver','dsh-client-ui-settings','dsh-client-ui-slots','dsh-web-frontend','dsh-client-ui-settings-general','dsh-settings'];
for (const name of pkgs) {
  const p = 'dsh/node_modules/@deepseek-ai/' + name + '/package.json';
  if (!all.includes(p)) { console.log(name, 'MISSING'); continue; }
  const j = JSON.parse(await readText(asar, p));
  console.log(name, j.version);
}
const cm = await readText(asar, 'dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js');
console.log('client-modules features:', ['svg','nosniff','immutable','asset','encodeURIComponent','resolve'].map(k => k + '=' + (cm.split(k).length - 1)).join(' '));
