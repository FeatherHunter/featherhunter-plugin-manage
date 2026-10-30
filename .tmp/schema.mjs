
import { openAsar, listAll } from 'file:///D:/dsh-plugin/dsh-prompt/.asar-tools/asar.mjs';
const asar = await openAsar('D:/DeepseekHarness/resources/app.asar');
const all = listAll(asar);
console.log('n', all.length, 'sample keys', Object.keys(all[0]));
console.log(JSON.stringify(all[0]).slice(0, 300));
const paths = all.map(e => e.path || e.filePath || e.name || String(e));
console.log('paths sample', paths.slice(0, 5));
console.log('--- html ---');
console.log(paths.filter(p => /\.html$/.test(p)).slice(0, 25).join('\n'));
console.log('--- web-ish js ---');
console.log(paths.filter(p => /\.js$/.test(p) && /(^|\/)(web|shell|client)\//.test(p) && !/node_modules/.test(p)).slice(0, 25).join('\n'));
