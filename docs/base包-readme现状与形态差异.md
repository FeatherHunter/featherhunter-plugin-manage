# base 包：README 四块现状与形态差异

> 票 07 产物。只读快照五个插件仓共 11 个 README 文件里的四个手写区块（联系 / 星图 / 致谢 / 作者其他作品 MORE），
> 给出规范化比较口径与迁移前必须知道的形态差异。**本票不修改任何外部仓库文件**；快照生成器只做 `readFileSync`。
>
> 关联产物：[readme-blocks.json](../packages/base/test/fixtures/readme-blocks.json)（fixture）、
> [extract-readme-fixtures.mjs](../packages/base/test/fixtures/extract-readme-fixtures.mjs)（生成器）、
> [readme-compare.ts](../packages/base/src/node/readme-compare.ts)（比较器）、
> [readme-compare.test.ts](../packages/base/test/readme-compare.test.ts)（43 个测试：31 合成样例 + 12 fixture 回归）。
> 依据：`.scratch/base-package/spec.md` §6「README 四块」与 §8「验收」（等价口径 F18、D-c）；
> `docs/base包-对抗式审查.md` F18 / F21 / F22 / F27 / F29 / D-b / D-c / D-d；`docs/base包与联系弹窗-方案.md`。

## 0. 结论摘要

1. 11 个文件里四块共 **44 个位置：42 个有内容，2 个缺失**（`ilife.star-history`、`ilife.more`，F21 明确为「新增」而非「迁移」）。
2. **联系区 2 变体**：10 个文件是 `CONNECT` HTML h2 标准形态；ilife 是 `## 反馈与联系` Markdown 形态。
3. **星图区 4 形态**：`picture+外链`（deck×3）、`picture+width+角注`（im×2）、单张 Markdown 图（palette×3、prompt×2）、缺失（ilife）。
4. **MORE 标题 3 形态**（按标题文字）：`作者的其他作品` / `More from the author` / `More by the author`；**行集顺序 6 种**；ilife 缺失。
5. **致谢五仓同源**：同一套 `<!-- THANKS-TABLE-ZH/EN-START/END -->` 标记 + 三列表头；ilife 是空表（0 行）。
6. **联系图片前缀实际 5 种**：4 种相对前缀（规格/审计记为「3 种相对前缀」，第 4 种是 `../assets/readme/` 的组合变体）+ deck/package/README.md 的旧式 GitHub 绝对 URL。
7. **必须停手项**：`dsh-im-companion/README.md:262` 的 `</div>>>>>>>> origin/master`（合并冲突残留，且位于文件最后一行内容）。迁移时**人工修掉**再跑 `readme:init`；比较器把它报为 `merge-conflict-residue`，渲染/同步不得自动猜。
8. 区块顺序 3 种（deck 两文件 ×1、其余常规文件 ×2、ilife 特例）；**顺序不参与内容等价判定**（只记录）。
9. 等价判定 = 内容等价（成员集合 / 链接目标 / 表头与标题文字 / 图片宽度 / alt / 致谢表数据）+ 允许模板统一的外观微调；纯格式差异（白空格、属性顺序、引号、自闭合、标题 HTML/Markdown 变体）单独归类，不算内容差异。

## 1. 快照范围与产物

- 来源根：默认 `D:/dsh-plugin`，可用环境变量 `README_SOURCE_ROOT` 覆盖；生成器对五仓**只读**。
- 抓取时点：2026-10-31（本仓 `feat/base-package` @ `e801688` 时期）；fixture 为每个文件记录全文 `sha256`、`bytes`、`lines`，上游改动后可核对/重跑。
- 重新生成：`cd packages/base && node test/fixtures/extract-readme-fixtures.mjs`，然后 review `git diff` fixture；上游 README 未变时生成结果稳定（无时间戳字段）。

11 个目标文件与实测语言/顺序：

| id | 仓库 | 相对路径 | 语言 | 区块顺序（实测） |
| --- | --- | --- | --- | --- |
| `deck` | dsh-mattpocock-skills-deck | `README.md` | zh | thanks → contact → star-history → more |
| `deck-pkg` | dsh-mattpocock-skills-deck | `package/README.md` | zh | thanks → contact → star-history → more |
| `deck-en` | dsh-mattpocock-skills-deck | `docs/README.en.md` | en | more → thanks → contact → star-history |
| `palette` | dsh-opencode-palette | `README.md` | zh | more → thanks → contact → star-history |
| `palette-pkg` | dsh-opencode-palette | `package/README.md` | en | more → thanks → contact → star-history |
| `palette-en` | dsh-opencode-palette | `docs/README.en.md` | en | more → thanks → contact → star-history |
| `im` | dsh-im-companion | `README.md` | zh | more → thanks → contact → star-history（末尾脏行，见 §9） |
| `im-en` | dsh-im-companion | `docs/README.en.md` | en | more → thanks → contact → star-history |
| `prompt` | dsh-prompt | `README.md` | zh | more → thanks → contact → star-history |
| `prompt-en` | dsh-prompt | `docs/README.en.md` | en | more → thanks → contact → star-history |
| `ilife` | ilife | `README.md` | zh | thanks → contact（star / more 缺失） |

fixture schema（`readme-blocks.json`）：

```text
{
  meta: { generator, comparator, sourceRoot, readOnly: true, blockKinds, fileCount: 11, missingBlocks: [...], note },
  files: [{
    id, repo, repoPath, lang: "zh"|"en", sha256, bytes, lines,
    order: ["contact"|"star-history"|"thanks"|"more", ...],   // 实测顺序，不假设
    suspicious: [{ line, text, reason }],                    // 合并冲突残留等
    blocks: {
      contact | star-history | thanks | more: {
        raw: string | null,        // 原始块文本（仅块内，前后空行已裁掉）
        parsed: object | null,     // 解析后结构，见 §10
        missing: boolean,          // true 表示该块当前不存在
        note?: string              // 已知缺失的说明（ilife 两块带 F21 备注）
      }
    }
  }]
}
```

四块变体矩阵（`variant` 由各 parser 给出）：

| 文件 | contact | star-history | thanks | more |
| --- | --- | --- | --- | --- |
| deck / deck-pkg / deck-en | html-heading | picture-link | html-heading | html-heading |
| palette / palette-pkg / palette-en | html-heading | markdown-image | html-heading | html-heading |
| im / im-en | html-heading | picture | html-heading | html-heading |
| prompt / prompt-en | html-heading | markdown-image | markdown-heading | markdown-heading |
| ilife | markdown-heading | **缺失** | markdown-heading | **缺失** |

## 2. 联系区（CONNECT）：2 变体

### 2.1 标准 HTML 变体（10 个文件）

结构（以 deck 为例，其余 zh 文件同构）：

```html
<h2 align="center"><sub>CONNECT</sub><br>反馈与联系</h2>

<div align="center">

👏欢迎提交PR、ISSUE。……可以进群交流。

<table align="center"><tr>
  <td align="center"><b>飞书群（主）</b></td><td align="center"><b>QQ群（新）</b></td><td align="center"><b>微信群（新）</b></td>
</tr><tr>
  <td><img src="assets/contact-feishu-permanent.png" width="260" alt="DSH 插件交流群 飞书群二维码" /></td>
  <td><img src="assets/contact-qq-permanent.jpg" width="260" alt="DSH 插件交流群 QQ 群二维码" /></td>
  <td><img src="assets/contact-wechat-weekly.png" width="260" alt="DSH 插件交流群微信群二维码" /></td>
</tr></table>

</div>
```

- 表头固定三列：zh `飞书群（主）/ QQ群（新）/ 微信群（新）`；en `Feishu Group (Main) / QQ Group (New) / WeChat Group (New)`。
- 三张图 `width="260"`；alt 为 zh/en 各一套；欢迎语在表格外（不参与内容等价比较）。
- 规格要求「保持现状结构」：表格结构、表头文字、260 宽、可点开大图都不变，只把图片地址换成包 CDN 的**绝对**地址（F29），不再在五仓各存副本。

### 2.2 ilife Markdown 变体（1 个文件）

```markdown
## 反馈与联系

<div align="center">

👏欢迎提交PR、ISSUE。……可以进群交流。

<table align="center">…与上面相同的表格…</table>

</div>
```

- 规格要求保留（story 46 / D-c）：ilife 继续用 Markdown 标题，不强行换 HTML h2。
- 其余内层结构（欢迎语 + 三列表格 + 260 宽图）与其他仓一致。

### 2.3 图片相对前缀：实际 5 种

| 前缀 | 出现文件 | 备注 |
| --- | --- | --- |
| `assets/` | deck、palette、im、ilife 的 `README.md` | 仓库根 README |
| `../assets/` | deck/palette 的 `package/README.md`、deck/palette/im 的 `docs/README.en.md` | 深一层目录 |
| `assets/readme/` | prompt `README.md` | prompt 的图在子目录 |
| `../assets/readme/` | prompt `docs/README.en.md` | 上一条 + 深一层目录的组合变体 |
| `https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/raw/main/assets/…` | deck `package/README.md` | 旧式 GitHub 绝对 URL，**不是** CDN |

> 口径差异说明：规格与对抗式审查（F29）记作「三种相对前缀」。提取实测是 **4 个相对前缀字符串**，其中
> `../assets/readme/` 是 `assets/readme/` 的 `../` 组合；另有 1 种绝对 URL。迁移统一为 CDN 绝对 URL（形如
> `https://cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base@<version>/data/img/card-feishu.png`）后歧义自然消失。
> F29 结论不变：统一成绝对地址反而消掉路径歧义。

### 2.4 内容差异（不是格式差异，迁移时要拍板/记录）

- **QQ 群图扩展名不一致**：palette 三文件用 `contact-qq-permanent.png`；其余 7 个有联系区的文件用 `contact-qq-permanent.jpg`。
  比较器按默认 `imageSrc: "basename"` 会把它判为内容差异（`image` 维度），**不会**当作纯格式差异放过。
  迁移后统一引用 CDN 图时，源文件名取哪个（或统一 `card-qq.png`）必须在迁移报告中记为有意差异。
- 欢迎语、alt 文案 zh/en 两套，属模板内容；迁移统一文案同样记有意差异。

## 3. 星图区：4 形态

| 形态 | 文件 | 结构要点 |
| --- | --- | --- |
| A. `<picture>` 双图 + 外链 | deck×3（README / package / docs/en） | `<div align="center"><a href="https://featherhunter.github.io/dsh-mattpocock-skills-deck/star-history.html"><picture>dark+light</picture></a></div>`；图片在 `raw.githubusercontent.com/.../main/docs/`，`?v=20261030`；无 `width`、无角注 |
| B. `<picture>` 双图 + width + 角注 | im×2 | `<picture>` 无外链；`<img width="720">`；后接 `<sub>左轴读总星标（Total Stars），右轴读每日新增（Daily New），每天自动更新。</sub>`（en 版对应英文）；`master` 分支、`?v=20261024` |
| C. 单张 Markdown 图 | palette×3、prompt×2 | `<div align="center">![长句 alt](https://raw.githubusercontent.com/.../star-history.svg?v=...)</div>`；无深浅双图；palette `?v=202610232036`、prompt `?v=20261029`；alt 是长句（zh/en 不同） |
| D. 缺失 | ilife | 没有星图区；F21/D-d：迁移后**新增**，不是迁移 |

- 星图标记（用于定位块）兼容：`star-history-*.svg` / `star-history.svg` / `star-history.html` / 「星标增长曲线」/「Star history chart」。
- 迁移口径（规格 §6）：统一 `<picture>` 深浅双图 + `?v=YYYYMMDDHHmm`；**保留** deck 的外链、im 的 `width` 与角注（D-c：既有功能元素不能被「统一」静默删掉）；palette/prompt 升双图；ilife 补上。
- F27：各仓 star-history workflow 仍在生成双色 SVG，**只接管 README 内联引用，不删生成器**。
- 比较器默认 `imageSrc: "basename"` 时，sources 只比 `asset` 名（忽略分支/目录/`?v=` 缓存戳），只有 `imageSrc: "exact"` 才逐字比 `src`。双图升级（单图→双图）会被判为 `members`（sources 数量）内容差异，属于**有意差异**，迁移报告要列。

## 4. 致谢区：五仓同源

| 文件 | 标题形态 | 标题文字（`<sub>`） | 语言标记 | 表头 | 数据行数 |
| --- | --- | --- | --- | --- | --- |
| deck / deck-pkg | HTML h2 | 致谢（`THANKS`） | ZH | 贡献者 / 致敬 / 贡献 | 47 |
| deck-en | HTML h2 | Thanks（`THANKS`） | EN | Contributor / Tribute / Contributions | 47 |
| palette | HTML h2 | 致谢（`THANKS`） | ZH | 贡献者 / 致敬 / 贡献 | 9 |
| palette-pkg / palette-en | HTML h2 | Contributors（`THANKS`） | EN | Contributor / Tribute / Contributions | 9 |
| im | HTML h2 | 致谢（`THANKS`） | ZH | 贡献者 / 致敬 / 贡献 | 3 |
| im-en | HTML h2 | Thanks（`THANKS`） | EN | Contributor / Tribute / Contributions | 3 |
| prompt | Markdown `## 致谢 <sub>THANKS</sub>` | 致谢（`THANKS`） | ZH | 贡献者 / 致敬 / 贡献 | 5 |
| prompt-en | Markdown `## Thanks <sub>THANKS</sub>` | Thanks（`THANKS`） | EN | Contributor / Tribute / Contributions | 5 |
| ilife | Markdown `## 致谢` | 致谢 | ZH | 贡献者 / 致敬 / 贡献 | **0（空表）** |

同源结论：

- 所有文件都用 `<!-- THANKS-TABLE-ZH-START -->` / `<!-- THANKS-TABLE-ZH-END -->` 包表；英文文件用 `THANKS-TABLE-EN-*`。ilife 只有 ZH 标记（fixture 内有注释说明英文表待 docs 建页后启用）。
- 表头三列固定（zh/en 各一套），表格数据为「贡献者链接 / 致敬 emoji / 贡献（issue/PR 链接列表）」。
- 五仓各自有一套 325~376 行生成器，逻辑同源；本包 `renderThanksBlock` 纯函数**沿用现有标记与表结构**，数据仍由各仓现有脚本抓取（本包不抓远端）。
- ilife 当前是空表（仅表头+分隔行），迁移时保留标记与空表形态，不能因为 0 行就删块。
- 比较器按 `headers` 数组、逐行 `cells` 文本、`links` 数组比较；标题文字比较但 HTML/Markdown 标题形态只记 `heading-variant` 格式差异。

## 5. 作者其他作品区（MORE）：标题 3 形态、行集 6 种顺序

### 5.1 标题形态（按标题文字，3 种）

| 标题文字 | 外层形态 | 出现文件 |
| --- | --- | --- |
| `作者的其他作品` | HTML `<h2 align="center"><sub>MORE</sub><br>作者的其他作品</h2>` | deck、deck-pkg、palette、im |
| `作者的其他作品` | Markdown `<div align="center">## 作者的其他作品 <sub>MORE</sub></div>` | prompt |
| `More from the author` | HTML `<h2 align="center"><sub>MORE</sub><br>More from the author</h2>` | deck-en、palette-pkg、palette-en |
| `More from the author` | Markdown `## More from the author <sub>MORE</sub>` | prompt-en |
| `More by the author` | HTML `<h2 align="center"><sub>MORE</sub><br>More by the author</h2>` | im-en |

按**标题文字**去重后正好 3 种：`作者的其他作品` / `More from the author` / `More by the author`；
HTML h2 与 Markdown 标题是两种**外层形态**（比较器把 HTML vs Markdown 记为 `heading-variant` 纯格式差异，不要求统一；标题文字本身必须一致）。

### 5.2 行集顺序（6 种，含 ilife 空）

| # | 文件 | 行顺序 |
| --- | --- | --- |
| 1 | deck、deck-pkg | dsh-opencode-palette → dsh-prompt → dsh-im-companion → ilife |
| 2 | deck-en | dsh-opencode-palette → dsh-prompt → dsh-chinese-skill-patch（**3 行**，D-b 决定迁移时移除末行） |
| 3 | palette、palette-pkg、palette-en | dsh-prompt → dsh-mattpocock-skills-deck → dsh-im-companion → ilife |
| 4 | im、im-en | dsh-opencode-palette → dsh-mattpocock-skills-deck → dsh-prompt → ilife |
| 5 | prompt、prompt-en | dsh-mattpocock-skills-deck → dsh-opencode-palette → dsh-im-companion → ilife |
| 6 | ilife | **缺失**（F21/D-d：迁移后新增） |

共性：每个 README 都**排除自己**、都含 ilife（ilife 自己除外，因为它没有该块）。

### 5.3 文案与分隔符漂移

- 行格式统一为 `**[repo](url)** <分隔符> 一句话`，但分隔符混用：zh 文件与 `im-en` 用 `——`；`deck-en` / `palette-pkg` / `palette-en` / `prompt-en` 用 `—`。
- 引导句/intro 各仓不同（如「喜欢这个插件的话，这些可能你也用得上：」「这几个你可能也用得上：」等）；im 还把引导句放在 `<div align="center"><div align="left">` 双层 div 里。
- 同一插件的一句话文案在不同仓也不同（尤其 ilife 的「建设中」标识位置/措辞：有的前置 `⚠️建设中⚠️`，有的后置 `⚠️建设中⚠️待正式发布`）。
- 迁移口径（规格 §6）：统一标准 HTML 标题 + 引导句 + **4 行** `**[repo](url)** —— 一句话`；展示顺序统一为 `deck → prompt → palette → im → ilife`（2026-10-30 仓主给定，spec 规则 8）；prompt 两个文件保留 `## … <sub>MORE</sub>` Markdown 变体；英文标题沿用现有 `More from the author` / `More by the author`；每仓排除自己；ilife 新增该块（带建设中标识）；**deck-en 的 `dsh-chinese-skill-patch` 行移除（D-b，待确认）**。
- 因此对 10 个现有 MORE 块，「行数/顺序/文案/分隔符」的差异都是**有意差异**，逐条写进迁移报告；比较器会报 `members` / `text` 内容差异。

## 6. 区块顺序与插入位置

| 顺序 | 文件 |
| --- | --- |
| `thanks → contact → star-history → more` | deck、deck-pkg |
| `more → thanks → contact → star-history` | deck-en、palette、palette-pkg、palette-en、im、im-en、prompt、prompt-en |
| `thanks → contact` | ilife（star / more 待新增） |

- 顺序只记录、**不参与内容等价判定**（`compareReadmeBlocks().order.same` 仅供报告）；`readme:init` 要按各文件现状位置插入标记，不统一重排。
- 位置差异不影响 `readme:sync`：同步只替换 `<!-- XXX-START -->` / `<!-- XXX-END -->` 之间内容。

## 7. 脏行与「必须停手」规则

**已知唯一一处**：`dsh-im-companion/README.md` 第 262 行（文件共 263 行，且是最后一行内容）：

```text
</div>>>>>>>> origin/master
```

- 它原本应是星图区外层包裹 div 的闭合标签 `</div>`，后面被合并冲突残留污染；im 的星图块 raw 因此以该行结尾。
- 比较器 `findSuspiciousLines` 返回 `{ line: 262, text: "</div>>>>>>>> origin/master", reason: "merge-conflict-residue" }`；`compareReadmeBlocks` 会把它透传到 `suspicious`。fixture 里只有 `im` 有 1 条 suspicious，其余 10 个文件为 0。
- 检测规则：`<<<<<<<`（conflict-start）、`=======`（conflict-separator）、`>>>>>>>`（conflict-end）、`<<<<<<< xxx` / `>>>>>>> branch` 同行残留（merge-conflict-residue）。
- 规格 §6（F22）要求：`readme:init` 遇到可疑结构**必须停手报错、不猜**；`--check` 把它列为待人工处理；比较器/渲染器**不得自动修复**。
- 迁移执行顺序：**人工先修掉这一行**（把 `</div>>>>>>>> origin/master` 改回 `</div>`），再跑 `readme:init`。本票只识别、不修改外部仓。

## 8. 等价口径（F18 / D-c）

README 验收从「语义等价 / 外观基本一致」改为：

- **内容等价**（硬条件）：成员集合、链接目标、表头与标题文字、图片宽度、alt 文本、致谢表数据一致。
- **允许模板统一带来的外观微调**：保留各仓既有功能元素（deck 星图外链、im 的 `width` 与角注、ilife 的 Markdown 标题），不保留逐字节形态。
- 判定用 fixture 做**规范化比较**：白空格、行尾、属性顺序、单双引号、自闭合写法、HTML h2 与 Markdown 标题形态差异都归为**纯格式差异**，不计入内容差异。
- **所有有意差异必须逐条写进迁移报告**（规格 §8）。

### 8.1 比较器公共 API（`src/node/readme-compare.ts`）

```ts
import {
  locateReadmeBlocks, findSuspiciousLines,
  parseContactBlock, parseStarHistoryBlock, parseThanksBlock, parseMoreBlock,
  canonicalizeMarkup, compareBlocks, compareReadmeBlocks,
  type ReadmeBlockKind, type BlockComparison, type ReadmeComparison, type Difference,
} from "./src/node/readme-compare";

// 1) 定位四块（raw 文本 + 顺序 + 可疑行）
const located = locateReadmeBlocks(markdown);

// 2) 单块比较（expected 为迁移前基线，actual 为迁移后/新渲染结果）
const contact = compareBlocks("contact", expectedRaw, actualRaw);
// contact.equivalent        // 内容等价即 true（纯格式差异不影响）
// contact.identical         // 原始文本严格相等
// contact.contentDifferences // [{ dimension, path, expected, actual }]
// contact.formatDifferences  // [{ kind, block? }]，kind: line-endings | whitespace | quotes | attribute-order | self-closing | heading-variant | markup

// 3) 整篇比较（字符串或 LocatedBlocks 均可）；图片 URL 比较粒度可调
const comparison = compareReadmeBlocks(expectedDoc, actualDoc, { imageSrc: "basename" }); // 默认
// comparison.equivalent / blocks / contentDifferences / formatDifferences
// comparison.order = { expected, actual, same }   // 顺序差异不判失败
// comparison.suspicious                            // 透传 actual 的可疑行，调用方应停手
```

- `Difference.dimension`：`presence`（块有无）、`members`（成员/数量/行集）、`links`（链接目标）、`text`（标题/表头/alt/正文文字）、`width`（图片宽度）、`table`（致谢表结构与单元格）、`image`（图片文件名/地址）。
- `imageSrc: "basename"`（默认）：只比文件名 `asset`，忽略目录前缀、分支、`?v=` 缓存戳 → 适配 F29 统一 CDN 地址。
  `imageSrc: "exact"`：逐字比 `src`，用于需要严格核对 URL 的场景。
- 缺块：`presence` 差异，`path` 为块名，`expected: null / actual: "present"`（反之亦然）。
- 有内容差异时 `formatDifferences` 返回空数组（避免噪音）；只有内容等价时才报告纯格式差异。

### 8.2 与迁移验收的关系（需要注意的口径张力）

旧 fixture 是「迁移前」基线。星图升级双图、MORE 行集/顺序统一、QQ 图换名等**有意差异**，严格拿「新 README vs 旧 fixture」跑比较器一定报内容差异。建议迁移票（09/10）二选一，由 Lead 确认：

1. **推荐**：`expected` 用 manifest 数据经四个渲染器生成的新块（内容等价硬校验），旧 fixture 只作为「现状清单 + 迁移前差异报告」基线；
2. 或：新 README vs 旧 fixture 比较 + 逐文件「有意差异」allowlist，逐条核对 `Difference.path`。

无论哪种，`suspicious` 非空即停手、`order` 只报告不失败。

## 9. 复现与维护

```powershell
cd packages/base
node test/fixtures/extract-readme-fixtures.mjs     # 重新抓取（默认 D:/dsh-plugin，只读）
npx vitest run test/readme-compare.test.ts         # 31 合成样例 + 12 fixture 回归 = 43 测试
npm run typecheck; npm test; npm run build         # 本包收尾门禁
```

- fixture 有 42 个非空块 + 2 个已知缺失；测试断言：fixture 自洽（重解析 == 存档结构）、真实块自比 identical/equivalent、CRLF/行尾空白重排仍等价、变体/顺序/语言分布、QQ 图扩展名内容差异、im:262 脏行。
- 上游 README 变更后重跑生成器：先 `git diff` fixture 确认变化符合预期，再更新测试里的分布断言（若形态真有变化）。
- 五仓只读：生成器对 `D:/dsh-plugin` 下 11 个文件仅 `readFileSync`，无任何写入；fixture 的 `meta.readOnly = true` 与测试断言共同守住该约束。
