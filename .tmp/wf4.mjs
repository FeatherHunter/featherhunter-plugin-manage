
import { openAsar, readText } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = await openAsar('D:/DeepseekHarness/resources/app.asar');
const t = await readText(asar, 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index-CN7NIWNw.js');
for (const kw of ['asset', 'plugins']) {
  let i = -1, n = 0;
  while ((i = t.indexOf(kw, i + 1)) !== -1 && n < 8) { n++; console.log('=== ' + kw + ' @' + i + ' ===\n' + t.slice(Math.max(0, i - 260), i + 260).replace(/\n/g, ' ') + '\n'); }
}
