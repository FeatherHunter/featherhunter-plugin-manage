import { openAsar, listAll } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar);
const pkgs = new Set();
for (const e of all) {
  const m = e.path.match(/^dsh/node_modules/@deepseek-ai/([^/]+)//);
  if (m) pkgs.add(m[1]);
}
const names = [...pkgs].filter(n => /settings|slot|shell|runtime|layout|menu/i.test(n)).sort();
console.log('PACKAGES matching:', names.length);
console.log(names.join('
'));
console.log('---ALL PKG COUNT', pkgs.size);
