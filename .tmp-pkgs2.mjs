
import { openAsar, listAll } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar);
const pkgs = new Set();
for (const e of all) {
  const parts = e.path.split('/');
  if (parts[0] === 'dsh' && parts[1] === 'node_modules' && parts[2] === '@deepseek-ai') pkgs.add(parts[3]);
}
const names = [...pkgs].filter(n => /settings|slot|shell|runtime|layout|menu|web/i.test(n)).sort();
console.log('MATCHED ' + names.length + ' / total ' + pkgs.size);
console.log(names.join('\n'));
