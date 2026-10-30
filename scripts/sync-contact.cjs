// sync-contact.cjs — 三群联系区块统一同步脚本（票 02）
// 源头：管理仓根目录 contact-qq-permanent.jpg / contact-wechat-weekly.png / contact-feishu-permanent.png
// 跑一次即全量覆盖全部图片与全部文案块；重复跑幂等。
// 用法：换图先跑 python scripts/normalize-contact.py 统一画布，再跑 node scripts/sync-contact.cjs
// 触发口令约定：换微信图后跑脚本即全量生效（以后在管理仓说“更新微信图并同步”即指此命令）。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MANAGE_ROOT = path.resolve(__dirname, '..');
const SOURCES = [
  'contact-feishu-permanent.png',
  'contact-qq-permanent.jpg',
  'contact-wechat-weekly.png',
];

function sha(b){ return crypto.createHash('sha256').update(b).digest('hex').slice(0,12); }

function zhBlock(prefix, styleAttr) {
  const st = styleAttr ? ' style="border:1px solid #30363d;border-radius:6px"' : '';
  return '<h2 align="center"><sub>CONNECT</sub><br>\u53cd\u9988\u4e0e\u8054\u7cfb</h2>\n\n<div align="center">\n\n'
    + '\uD83D\uDC4F\u6B22\u8FCE\u63D0\u4EA4PR\u3001ISSUE\u3002\u661F\u661F\u4E4B\u706B\u53EF\u4EE5\u71CE\u539F\uD83D\uDD25\u6709\u4EFB\u4F55\u5EFA\u8BAE\u3001\u610F\u89C1\u3001\u60F3\u6CD5\u3001\u5410\u69FD\u3001idea\u90FD\u53EF\u4EE5\u8FDB\u7FA4\u4EA4\u6D41\u3002\n\n'
    + '<table align="center"><tr><td align="center"><b>\u98DE\u4E66\u7FA4\uFF08\u4E3B\uFF09</b></td><td align="center"><b>QQ\u7FA4\uFF08\u65B0\uFF09</b></td><td align="center"><b>\u5FAE\u4FE1\u7FA4\uFF08\u65B0\uFF09</b></td></tr><tr><td><img src="' + prefix + '/contact-feishu-permanent.png" width="260" alt="DSH \u63D2\u4EF6\u4EA4\u6D41\u7FA4 \u98DE\u4E66\u7FA4\u4E8C\u7EF4\u7801"' + st + ' /></td><td><img src="' + prefix + '/contact-qq-permanent.jpg" width="260" alt="DSH \u63D2\u4EF6\u4EA4\u6D41\u7FA4 QQ \u7FA4\u4E8C\u7EF4\u7801"' + st + ' /></td><td><img src="' + prefix + '/contact-wechat-weekly.png" width="260" alt="DSH \u63D2\u4EF6\u4EA4\u6D41\u7FA4\u5FAE\u4FE1\u7FA4\u4E8C\u7EF4\u7801"' + st + ' /></td></tr></table>\n\n</div>'
}

function enBlock(prefix, styleAttr) {
  const st = styleAttr ? ' style="border:1px solid #30363d;border-radius:6px"' : '';
  return '<h2 align="center"><sub>CONNECT</sub><br>Feedback and Contact</h2>\n\n<div align="center">\n\n'
    + '\uD83D\uDC4FWelcome PRs and issues. A single spark can start a prairie fire \uD83D\uDD25. Any suggestion, opinion, idea or rant \u2014 come join the group and talk.\n\n'
    + '<table align="center"><tr><td align="center"><b>Feishu Group (Main)</b></td><td align="center"><b>QQ Group (New)</b></td><td align="center"><b>WeChat Group (New)</b></td></tr><tr><td><img src="' + prefix + '/contact-feishu-permanent.png" width="260" alt="DSH plugin community group Feishu QR code"' + st + ' /></td><td><img src="' + prefix + '/contact-qq-permanent.jpg" width="260" alt="DSH plugin community group QQ QR code"' + st + ' /></td><td><img src="' + prefix + '/contact-wechat-weekly.png" width="260" alt="DSH plugin community group WeChat QR code"' + st + ' /></td></tr></table>\n\n</div>'
}

function ilifeBlock() {
  const inner = zhBlock('assets', false).replace(/^<h2[^>]*><sub>CONNECT<\/sub><br>\u53cd\u9988\u4e0e\u8054\u7cfb<\/h2>\n\n/, '');
  return '## \u53cd\u9988\u4e0e\u8054\u7cfb\n\n' + inner;
}

// 目标清单：repo（相对管理仓）、中文文件、英文文件、资源目录、是否保留圆角、是否 markdown 风格
const TARGETS = [
  { repo: '../dsh-mattpocock-skills-deck', zh: 'README.md', en: 'docs/README.en.md', assetDir: 'assets', zhPrefix: 'assets', enPrefix: '../assets', style: false, pkgZh: 'package/README.md', pkgZhPrefix: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/raw/main/assets' },
  { repo: '../dsh-opencode-palette', zh: 'README.md', en: 'docs/README.en.md', assetDir: 'assets', zhPrefix: 'assets', enPrefix: '../assets', style: false, pkgEn: 'package/README.md', pkgEnPrefix: '../assets' },
  { repo: '../dsh-im-companion', zh: 'README.md', en: 'docs/README.en.md', assetDir: 'assets', zhPrefix: 'assets', enPrefix: '../assets', style: false },
  { repo: '../dsh-prompt', zh: 'README.md', en: 'docs/README.en.md', assetDir: 'assets/readme', zhPrefix: 'assets/readme', enPrefix: '../assets/readme', style: true },
  { repo: '../ilife', zh: 'README.md', en: null, assetDir: 'assets', zhPrefix: 'assets', enPrefix: null, style: false, markdown: true },
];

function replaceConnectHtml(content, expected) {
  // 替换从 CONNECT h2 到其后第一个 </div> 的整段；若找不到则返回 null
  // 注意：CONNECT 块之后如有 Star History 独立 div，必须保留，非贪婪到第一个 </div> 就停，绝不许跨块（2026-10-23 误删 8 处已恢复）
  const re = /<h2 align="center"><sub>CONNECT<\/sub><br>[\s\S]*?<\/div>/;
  if (!re.test(content)) return null;
  if (content.includes('contact-qq-permanent.jpg') && content.includes(expected.slice(0, 60))) {
    // 已是新块但需确保逐字一致：若已完全一致则不动，否则整体替换保证幂等收敛
    if (content.includes(expected)) return { text: content, changed: false };
  }
  const next = content.replace(re, expected);
  return { text: next, changed: next !== content };
}

function replacePromptZh(content, expected) {
  const re = /<div align="center">\s*\*\*\uD83D\uDC47[^]*?<\/div>/;
  // 只锚定含“飞书扫码，加入”的单个 div（ tempered：段内不许再出现 <div，避免跨段贪到尾）
  const re2 = /<div align="center">(?:(?!<div)[\s\S])*?\u98DE\u4E66\u626B\u7801\uFF0C\u52A0\u5165(?:(?!<div)[\s\S])*?<\/div>/;
  let m = content.match(re2);
  if (!m) {
    // 也可能是已替换后的 CONNECT 块
    return replaceConnectHtml(content, expected);
  }
  const next = content.replace(re2, expected);
  return { text: next, changed: next !== content };
}

function replacePromptEn(content, expected) {
  // 同上：只锚定含“Scan with Feishu to join”的单个 div
  const re2 = /<div align="center">(?:(?!<div)[\s\S])*?Scan with Feishu to join(?:(?!<div)[\s\S])*?<\/div>/;
  let m = content.match(re2);
  if (!m) return replaceConnectHtml(content, expected);
  const next = content.replace(re2, expected);
  return { text: next, changed: next !== content };
}

function replaceIlife(content, expected) {
  const re = /## \u4EA4\u6D41\u7FA4[\s\S]*?<\/div>/;
  if (content.includes('## \u53cd\u9988\u4e0e\u8054\u7cfb') && content.includes('contact-qq-permanent.jpg')) {
    if (content.includes(expected)) return { text: content, changed: false };
    // 旧新混杂：把已有的反馈块整体替换为期望，保证收敛
    const reNew = /## \u53cd\u9988\u4e0e\u8054\u7cfb[\s\S]*?<\/div>/;
    const next = content.replace(reNew, expected);
    return { text: next, changed: next !== content };
  }
  if (!re.test(content)) return null;
  const next = content.replace(re, expected);
  return { text: next, changed: next !== content };
}

async function main(){
  let imgCopied = 0, imgSame = 0, docChanged = [], docSame = [], missing = [];
  for (const t of TARGETS) {
    const repoAbs = path.resolve(MANAGE_ROOT, t.repo);
    if (!fs.existsSync(repoAbs)) { missing.push(t.repo + ' (repo missing)'); continue; }
    const assetAbs = path.join(repoAbs, t.assetDir);
    if (!fs.existsSync(assetAbs)) fs.mkdirSync(assetAbs, { recursive: true });
    for (const f of SOURCES) {
      const src = path.join(MANAGE_ROOT, f);
      const dst = path.join(assetAbs, f);
      const sb = fs.readFileSync(src);
      let need = true;
      if (fs.existsSync(dst)) {
        const db = fs.readFileSync(dst);
        if (sha(sb) === sha(db) && sb.length === db.length && Buffer.compare(sb, db) === 0) { need = false; imgSame++; }
      }
      if (need) { fs.copyFileSync(src, dst); imgCopied++; }
    }
    // 中文
    const zhAbs = path.join(repoAbs, t.zh);
    if (fs.existsSync(zhAbs)) {
      let content = fs.readFileSync(zhAbs, 'utf8');
      const expected = t.markdown ? ilifeBlock() : zhBlock(t.zhPrefix, t.style);
      let res = null;
      if (t.markdown) res = replaceIlife(content, expected);
      else if (t.repo.includes('dsh-prompt')) res = replacePromptZh(content, expected);
      else res = replaceConnectHtml(content, expected);
      if (!res) missing.push(t.repo + '/' + t.zh + ' (pattern not found)');
      else if (res.changed) { fs.writeFileSync(zhAbs, res.text.replace(/\r\n/g, '\n')); docChanged.push(t.repo + '/' + t.zh); }
      else docSame.push(t.repo + '/' + t.zh);
    } else missing.push(t.repo + '/' + t.zh + ' (file missing)');
    // 英文
    if (t.en) {
      const enAbs = path.join(repoAbs, t.en);
      if (fs.existsSync(enAbs)) {
        let content = fs.readFileSync(enAbs, 'utf8');
        const expected = enBlock(t.enPrefix, t.style);
        let res = null;
        if (t.repo.includes('dsh-prompt')) res = replacePromptEn(content, expected);
        else res = replaceConnectHtml(content, expected);
        if (!res) missing.push(t.repo + '/' + t.en + ' (pattern not found)');
        else if (res.changed) { fs.writeFileSync(enAbs, res.text.replace(/\r\n/g, '\n')); docChanged.push(t.repo + '/' + t.en); }
        else docSame.push(t.repo + '/' + t.en);
      } else missing.push(t.repo + '/' + t.en + ' (file missing)');
    }
    // 包内副本
    if (t.pkgZh) {
      const pAbs = path.join(repoAbs, t.pkgZh);
      if (fs.existsSync(pAbs)) {
        let content = fs.readFileSync(pAbs, 'utf8');
        const expected = zhBlock(t.pkgZhPrefix, t.style);
        const res = replaceConnectHtml(content, expected);
        if (res && res.changed) { fs.writeFileSync(pAbs, res.text.replace(/\r\n/g, '\n')); docChanged.push(t.repo + '/' + t.pkgZh + ' (pkg)'); }
        else if (res) docSame.push(t.repo + '/' + t.pkgZh + ' (pkg)');
      }
    }
    if (t.pkgEn) {
      const pAbs = path.join(repoAbs, t.pkgEn);
      if (fs.existsSync(pAbs)) {
        let content = fs.readFileSync(pAbs, 'utf8');
        // 包内副本 = 英文页去 showcase：此处只同步 CONNECT 段，前提是调用方已保证其余一致
        const expected = enBlock(t.pkgEnPrefix, t.style);
        const res = replaceConnectHtml(content, expected);
        if (res && res.changed) { fs.writeFileSync(pAbs, res.text.replace(/\r\n/g, '\n')); docChanged.push(t.repo + '/' + t.pkgEn + ' (pkg)'); }
        else if (res) docSame.push(t.repo + '/' + t.pkgEn + ' (pkg)');
      }
    }
  }
  // palette 包内副本一致性：package/README.md 应等于 docs/README.en.md 去 showcase
  try {
    const palRoot = path.resolve(MANAGE_ROOT, '../dsh-opencode-palette');
    const enAbs = path.join(palRoot, 'docs/README.en.md');
    const pkgAbs = path.join(palRoot, 'package/README.md');
    if (fs.existsSync(enAbs) && fs.existsSync(pkgAbs)) {
      const en = fs.readFileSync(enAbs, 'utf8').replace(/\r\n/g, '\n');
      const pkg = fs.readFileSync(pkgAbs, 'utf8').replace(/\r\n/g, '\n');
      const showRe = /<!-- showcase:start -->[\s\S]*?<!-- showcase:end -->\r?\n?/;
      const expectPkg = en.replace(showRe, '');
      if (pkg !== expectPkg) {
        // 仅当 CONNECT 已同步但包副本仍含旧 showcase 残留/行尾差时才重写；否则保持最小改动
        // 此处 CONNECT 已在上一步同步，若仍不一致则以英文页为准重写包副本
        if (pkg.includes('contact-qq-permanent.jpg') || expectPkg.includes('contact-qq-permanent.jpg')) {
          fs.writeFileSync(pkgAbs, expectPkg);
          if (!docChanged.includes('../dsh-opencode-palette/package/README.md (pkg)')) docChanged.push('../dsh-opencode-palette/package/README.md (regen)');
        }
      }
    }
  } catch(e){ console.error('palette pkg regen warn:', e.message); }
  console.log(JSON.stringify({ imgCopied, imgSame, docChanged, docSame, missing }, null, 2));
}
main().catch(e=>{ console.error(e); process.exit(1); });
