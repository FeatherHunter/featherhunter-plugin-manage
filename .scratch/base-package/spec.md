<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: base 包：设置面板通用件（联系弹窗 + 作者插件卡）+ README 四块统一渲染 -->
<!-- DSH-STATUS: closed -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-ef1311ba-5977899 -->
<!-- DSH-CREATED: 2026-10-30T14:15:27.619Z -->
# base 包：设置面板通用件（联系弹窗 + 作者插件卡）+ README 四块统一渲染


## 维护者原话
出处：本会话（2026-10-30，首轮需求）
> 本地某个src目录开发TS源码形式的 UI控件 效果是 我的其他所有插件会参考你这边写的源码，原样地 copy 过去。实现的效果是：在它们的设置面板页面里增加一个按钮入口，点击该按钮后会跳出弹窗。弹窗的内容就是我们在 README 里面写的关于不同联系方式的二维码，甚至整体的 UI 呈现形式都差不多。
>
> 我需要你提供一个弹窗控件，调用之后会在上层显示出来，上面显示各种二维码，并带有类似“扫描二维码加入我们”的提示文字。
出处：本会话（2026-10-30，对抗式审查后的拍板）
> npm CDN / 联系块，星图/致谢，作者其他插件 都做。 / 如图 作者插件推荐，也分为 插件内 设置面板展示的控件 和 readme中的2个版本 / 4 列 / D1 总管页 1 处
## Problem Statement
**问题一：联系区被复制成五份，微码还要每周改五处。** 联系区（CONNECT 标题 + 欢迎语 + 三张群卡）现在以五份手工维护的 README 片段存在：管理仓的 scripts/sync-contact.cjs 反复运行正则在五个插件仓库里注入替换，三张群码图片也在五个仓库各存一份、合计约 4.3MB 冗余。微码（微信群码）7 天过期、每周都要换，每次换图都要跑一次同步、提交五个仓库。
**问题二：插件设置面板里没有联系入口。** 使用者想进群，必须翻到 README 底部；插件面板里没有「联系我们」这类入口。而五个插件未来都要加这个入口——如果各写一份，就会是五份弹窗、五种排版、五份二维码副本，每周再同步五处，维护成本随插件数量线性增长。
**问题三：作者其他插件推荐在 5 个设置面板 + 10 份 README 里各写各的，已经漂移。** 同一份推荐数据的成员集合有 5 种（deck 面板 4 行含自己、palette 3 行不含自己、prompt 4 行含自己、im 只有 2 行、ilife 4 行不含自己；README 一律排除自己且都含 ilife），文案与数字互相矛盾（deck 面板写 27 个技能 / 34 款配色 / 24 条模板 / 9 路聊天，palette 面板说 deck 25，prompt 注释说 25/38，README 又说 palette 38 款、deck 27 个技能、mattpocock 近 30 万 star；ilife 已在 2026-09-18 拍板「文案不写数字」）。ilife 的 README 甚至还没有这块，设置面板里普遍缺 ilife。
**问题四：星图区、致谢区同样五套实现。** 星图有深浅双图 / 单图 / 缺失三种形态（ilife 没有）；致谢有五份几乎同源的生成器（.ts / .mts / .mjs，325~376 行）与五套门禁，改一处要动五处。
综上所述：需要把「设置面板里的联系入口 + 弹窗」「作者插件推荐卡」「README 联系 / 星图 / 致谢 / 作者其他插件四块」从 N 份复制品收敛成：**一份数据 + 一组通用渲染件 + 一条发布通道**，并保证五个插件仓库不需要改代码就能接入（本次不修改它们，只交付交接文档）。
## Solution
一个可复用的 npm 包 `dsh-featherhunter-plugin-base`，五仓编译期引入，提供两组能力：
1. **设置面板通用件（./client）**：`ContactButton`（SVG 图标按钮，点击打开联系弹窗）、`ContactRow`（整行动作，给放不下图标按钮的面板）、`AuthorPlugins`（作者其他插件推荐卡）、`openContactModal()`（代码主动打开）。
2. **README 渲染器（./node）**：`renderContactBlock` / `renderStarHistoryBlock` / `renderThanksBlock` / `renderMoreBlock` 四个纯字符串渲染器 + `verify`，把五仓 README 的四个块统一成同一份产物。
底下的底座只有三样东西：
- **一份数据**：base 仓的 `contact/` 是唯一真源（群组清单 + 作者插件清单 + 源图），构建后随 npm 包发布为 `data/manifest.json` + `data/img/`；
- **一个分发通道**：npm CDN（unpkg 取清单、jsDelivr 取精确版本图片，npmmirror 兜底）；弹窗打开即拉清单，加群 / 删群 / 换微码只发数据版本，不发代码变化；
- **一套兜底**：包内内置两码基线（飞书 / QQ，共约 49KB base64），远程不可用时弹窗照常可用；微码过期或取不到时只降级那一张卡为可点链接，绝不展示过期码。
五个插件仓库的落地改动（加依赖、放控件、改 README、加 CI 步骤）不在本次实现内执行；本次交付包本身 + 三份交接文档 + 本仓 demo 页，由仓主照文档执行。
## User Stories
1. 作为插件使用者，我想在设置面板里看到一个联系图标按钮，以便不用翻 README 就能找到进群入口。
2. 作为插件使用者，我点击按钮后想在当前面板上层看到联系弹窗，而不是跳转离开设置页。
3. 作为插件使用者，我想在弹窗里直接看到飞码、Q码、微码，扫码即可进群。
4. 作为插件使用者，我想在弹窗里看到「扫描二维码加入我们」这类提示与欢迎语，知道进群能干什么。
5. 作为插件使用者，我想用 Esc 或点击遮罩关闭弹窗，关闭后焦点回到原来的按钮。
6. 作为插件使用者，我希望弹窗颜色跟随插件深浅主题，不刺眼、不违和。
7. 作为插件使用者，我希望窗口变窄时群卡自动降列，二维码不被裁掉。
8. 作为插件使用者，我希望二维码在 4 列布局下仍然够大、能直接扫（每张卡约 150~165px 码面）。
9. 作为插件使用者，我希望离线打开弹窗时至少能看到飞书与 QQ 码，微码处给出可点链接。
10. 作为插件使用者，我不希望看到已经过期或已经失效的群码。
11. 作为手机用户，我希望把群号做成可点击复制，因为我没法扫自己手机屏幕上的码。
12. 作为插件使用者，我想在设置面板里看到「作者其他插件」推荐卡，发现同作者的其他插件。
13. 作为插件使用者，我希望推荐卡的每一行都能整行点开新标签页，而不是只能点小图标。
14. 作为插件维护者，我不想为五个插件分别写一套弹窗与一张推荐卡，只想引入同一个通用件。
15. 作为插件维护者，我希望入口是一个不占一行文案的图标按钮，同时也有整行版本可选。
16. 作为插件维护者，我希望三行代码就能接入（建 UI、放控件、可选主动打开）。
17. 作为插件维护者，我希望控件不 import React，由我注入运行时，从而兼容我的 React 18 或 React 19。
18. 作为插件维护者，我希望控件产物是零 import 的单文件，能塞进我们各自的自研构建链（esbuild / tsdown / mini-bundler / tsc -b）。
19. 作为插件维护者，我希望弹窗文案内置中英文并跟随宿主界面语言，同时允许我覆盖。
20. 作为插件维护者，我希望某个插件可以传自己的群组数据或插件清单，盖掉默认值且不影响其他插件。
21. 作为插件维护者，我希望推荐卡自动排除「我自己」这一行，不用每次手写排除逻辑。
22. 作为仓库管理者，我希望新增第 4 个、第 5 个群只需要改数据，不需要发版代码。
23. 作为仓库管理者，我希望删群、换序、改文案也只改数据。
24. 作为仓库管理者，我希望每周换微码只需要放入新图并跑一条命令，不必改五个仓库。
25. 作为仓库管理者，我希望那条命令会做结构与尺寸检查，并提醒我真机扫一次，避免产出扫不动的图。
26. 作为仓库管理者，我希望清单写坏或请求失败时弹窗退回内置基线，而不是白屏。
27. 作为仓库管理者，我希望清单里的群变空属于非法数据（避免一次误操作把弹窗清空），自动回退基线。
28. 作为仓库管理者，我希望作者插件清单只有一份，改一次五个设置面板与十个 README 一起变。
29. 作为仓库管理者，我希望推荐文案的每个数字都带核对日期（`verifiedAt`），超过 90 天未核对时 `doctor` 提醒我，而不是让文案悄悄变成假话。
30. 作为仓库管理者，我希望联系区、星图区、致谢区、作者其他插件区由同一处渲染，五仓 README 长得一样。
31. 作为仓库管理者，我希望 README 四块用标记注释隔离，替换只发生在块内，不碰其他章节。
32. 作为仓库管理者，我希望 README 里的群卡图片不再拷进五个仓库，而是引用同一个公开地址。
33. 作为仓库管理者，我希望 README 里的图片地址带精确版本号，永远不会被 CDN 缓存换成别的图。
34. 作为仓库管理者，我希望星图区统一成深浅双图并带分钟级时间戳，避免看到旧图。
35. 作为仓库管理者，我希望致谢区按现有贡献数据生成，风格一致、格式不倒退。
36. 作为仓库管理者，我希望一条命令就能告诉我哪个仓库的 README 块或依赖版本已过期（doctor）。
37. 作为仓库管理者，我希望 README 同步不新增定时 workflow（避免与现有任务抢提交、也避开 GitHub 60 天不活动自动禁用），而是挂在现有 workflow 里或本地一键跑。
38. 作为仓库管理者，我希望五仓接入步骤写成可独立执行的交接文档，维护者照做即可，不用读实现代码。
39. 作为仓库管理者，我希望本次实现完全不触碰另外五个仓库的代码与 README，责任边界清晰。
40. 作为访客，我希望 GitHub 上 README 四块的外观与现在基本一致，不因重构变形。
41. 作为访客，我希望 README 联系区的图在新标签页可以点开看大图。
42. 作为插件作者，我希望通用件兼容 React 18 与 React 19 两种宿主。
43. 作为插件作者，我希望通用件不在宿主里注册 settings.section、不读写宿主数据，只输出元素与 DOM。
44. 作为插件作者，我希望在 ilife 这种「一个总管页 + 六个子品页」的结构里，只在总管页放 1 处入口，子品页不改。
45. 作为访客，我希望 README 联系区的表格结构、表头文字与图片宽度（260）和现在完全一致，只是图片换成了同一个公开地址。
46. 作为 ilife 的读者，我希望 ilife 的 README 继续用「## 反馈与联系」这种 Markdown 标题，而不是 HTML h2，保持它现有风格。
47. 作为插件使用者，我希望弹窗里的每张群卡都有群名、群号或组织名、以及有效期说明，这样我知道扫的是哪个群、码还能不能用。
48. 作为仓库管理者，我希望群组的「README 表头文字」与「弹窗卡片文字」分开存在数据里，因为两个出口的说法本来就不一样。
49. 作为访客，我希望 README 四块的图片都来自同一个公开地址，而不是每个仓库各存一份副本。
50. 作为仓库管理者，我希望旧的联系区同步脚本在新链路上线后退役，不会和新的同步机制抢着改 README。
51. 作为 ilife 的读者，我希望 ilife README 也有星图区和作者其他作品区，和其他四个仓库一致。
52. 作为插件维护者，我希望 base 包钉死版本后不会自动升级，避免五个仓库被一次坏版本牵连。
## Implementation Decisions
### 0. 已拍板的产品决策（本次实现必须遵守）
| 编号 | 决策 | 结果 |
| --- | --- | --- |
| P-A | 数据分发通道 | **npm CDN**（不再用 GitHub raw / jsDelivr gh）；清单走 unpkg @latest，图片走精确版本路径 |
| P-B | v1 范围 | **四块全做**：联系块、星图、致谢、作者其他插件 |
| P-C | 弹窗列数 | **每行最多 4 列**（群组数不足时取群组数、不留空列），窄屏降列 |
| P-D | ilife 入口 | **只在 dsh-life-pack 总管页 1 处**，六个子品页不改 |
| P-E | 推荐位形态 | 作者插件推荐是「一物两版」：设置面板里的控件 + README 的两个语言版本（README.md 中文 / docs/README.en.md 英文） |
| P-F | 硬约束 | **不修改另外五个仓库的任何代码与 README**；它们要做的改动只写进交接文档 |
### 1. 包形态与产物约束
- 包名 `dsh-featherhunter-plugin-base`，单包三入口：`./core`（纯数据与纯函数：清单校验/合并/排序/有效期/文案，零依赖零 DOM 零网络）、`./client`（浏览器 UI）、`./node`（README 渲染与校验 + CLI）。纯 ESM，零运行时依赖。
- `./client` **不 import React**：调用方注入运行时，工厂返回一组组件与命令式 API：
```ts
import { createBaseUI } from 'dsh-featherhunter-plugin-base/client'
const base = createBaseUI(React, { lang: "zh", selfId: "deck" })
base.ContactButton              // 图标按钮，点击打开联系弹窗
base.ContactRow                 // 整行动作版本（放不下图标按钮时用）
base.AuthorPlugins              // 作者其他插件推荐卡
base.openContactModal(opts?)    // 代码主动打开，返回关闭函数
base.closeContactModal()
base.preloadContent()           // 可选：提前拉清单
```
- 产物按入口分级约束（对抗式审查 F25）：`./client` 是**单文件 ESM、零 import、无动态 import、无 top-level await**（五个仓库构建链完全不同：deck 自研 esbuild 拼接 + `require("react")` shim、palette 自研 mini-bundler 需逐文件登记依赖、im/prompt 走 tsdown、ilife 走 tsc -b，只有零依赖单文件才能五处直接吃下）；`./core` 与 `./node` 允许 `node:` 内建（`node:fs` / `node:path`）与 CLI 依赖树，但不得引入运行时第三方依赖。dist 契约测试直接断言：client 产物无 `import` / `require` / 动态 import / TLA；node 入口可在 Node 直接运行。
- 各仓 `package.json` 对本包**钉死精确版本**（不用 `^` / `~`）：一次坏版本不能一夜之间影响五个仓库；升级由仓主按交接文档手动改。数据新鲜度与代码版本解耦（见 §7）。
- TypeScript 源码 + 预构建 dist 一起发布；peer 依赖 `react` 为 `^18 || ^19`（现有五仓正好横跨 18.3 与 19.x）。
- 定位：base 不是 DSH 插件，不注册 settings.section、不读写宿主存储、不发 RPC；只输出 React 元素与 DOM 弹层。主题颜色只读宿主 CSS 变量，取不到就用内置回退值。
- 样式策略：一次性注入一段带固定 id 的 `<style>`（`dsh-base-ui-style`），类名前缀 `dsh-base-`，使用宿主主题令牌 + 内置回退；不注入全局字体、不改宿主任何既有元素样式。
### 2. 数据与内容：唯一真源 + 发布物
仓库布局（manage 仓）：
```
contact/                        # 人维护的唯一真源
  groups.json                   # 群组清单（顺序即展示顺序，可增删）
  plugins.json                  # 作者插件清单（每仓一行推荐）
  src/card-feishu.png           # 整卡截图（README 用；模板固定 900x1600）
  src/card-qq.jpg
  src/card-wechat-YYYY-MM-DD.png
  src/qr-feishu.png             # 二维码原图（生成裁图用）
  src/qr-qq.jpg
  src/qr-wechat-YYYY-MM-DD.png
  crops.json                    # 归一化裁图框（固定模板一次标定；周更只换图不重标）
packages/base/                  # npm 包本身
  src/core/ src/client/ src/node/
  data/manifest.json            # 发布物：groups + plugins + version + revision
  data/img/card-*.png           # 发布物：整卡缩到 260 宽（README 用，日期文件名）
  data/img/qr-*.png             # 发布物：裁图 320px（仅内置基线做 16 色量化；远端码用常规 PNG）
  scripts/contact-update.ts     # contact:update 的实现
  demo/                         # 本地演示页（真实弹窗 + 推荐卡）
  test/
```
- **图像处理只在构建/维护脚本里用 devDependency**（pngjs / jpeg-js 之类），不把 OpenCV / sharp 塞进运行时依赖：`crops.json` 一旦按模板标定，周更只是把新图按同一裁图框裁一次；2026-10-30 取证用的 OpenCV 检测只服务于标定（见审查文档 F24）。
发布物 `data/manifest.json` 结构（客户端一次请求同时拿到联系与推荐数据）：
```json
{
  "schema": 1,
  "version": "1.0.7",
  "revision": 42,
  "updatedAt": "2026-11-06T10:00:00+08:00",
  "fallbackUrl": "https://github.com/FeatherHunter/featherhunter-plugin-manage",
  "groups": [
    { "id": "feishu", "platform": "feishu", "order": 10,
      "readmeTitle": { "zh": "飞书群（主）", "en": "Feishu Group (Main)" },
      "alt": { "zh": "DSH 插件交流群 飞书群二维码", "en": "DSH plugin community group Feishu QR code" },
      "card": "card-feishu.png",
      "qr": { "kind": "bundled", "key": "qr-feishu" },
      "title": { "zh": "DSH 插件交流群", "en": "DSH Plugin Community" },
      "subtitle": { "zh": "用户418832的组织", "en": "User 418832's organization" },
      "note": { "zh": "该二维码永久有效", "en": "This QR code never expires" } },
    { "id": "qq", "platform": "qq", "order": 20,
      "readmeTitle": { "zh": "QQ群（新）", "en": "QQ Group (New)" },
      "alt": { "zh": "DSH 插件交流群 QQ 群二维码", "en": "DSH plugin community group QQ QR code" },
      "card": "card-qq.jpg",
      "qr": { "kind": "remote", "path": "qr-qq.jpg" },
      "title": { "zh": "DSH 插件交流群", "en": "DSH Plugin Community" },
      "subtitle": { "zh": "群号：1020866453", "en": "Group ID: 1020866453" },
      "note": { "zh": "扫一扫二维码，加入群聊", "en": "Scan the QR code to join the group chat" } },
    { "id": "wechat", "platform": "wechat", "order": 30,
      "readmeTitle": { "zh": "微信群（新）", "en": "WeChat Group (New)" },
      "alt": { "zh": "DSH 插件交流群微信群二维码", "en": "DSH plugin community group WeChat QR code" },
      "card": "card-wechat-2026-11-06.png",
      "qr": { "kind": "remote", "path": "qr-wechat-2026-11-06.png" },
      "title": { "zh": "DSH 插件交流群", "en": "DSH Plugin Community" },
      "subtitle": { "zh": "群聊：DSH 插件交流群", "en": "Group chat: DSH Plugin Community" },
      "validUntil": "2026-11-13" }
  ],
  "plugins": [
    { "id": "deck", "order": 10, "verifiedAt": "2026-10-30",
      "name": "dsh-mattpocock-skills-deck",
      "repo": "FeatherHunter/dsh-mattpocock-skills-deck",
      "desc": { "zh": "近 30 万 star 的 mattpocock/skills 整套预置好（27 个技能），装好即用。",
                "en": "The whole mattpocock/skills set (nearly 300k stars) preinstalled — 27 skills, ready as soon as it is installed." } },
    { "id": "prompt", "order": 20, "verifiedAt": "2026-10-30",
      "name": "dsh-prompt", "repo": "FeatherHunter/dsh-prompt",
      "desc": { "zh": "经常反复重复的模板化提示词，存成自定义模板，选中后直接注入，不再需要耗费精力。",
                "en": "The boilerplate prompts you keep retyping, saved as custom templates and injected on selection — no more wasted effort." } },
    { "id": "palette", "order": 30, "verifiedAt": "2026-10-30",
      "name": "dsh-opencode-palette", "repo": "FeatherHunter/dsh-opencode-palette",
      "desc": { "zh": "38 款 opencode 经典配色 + 20+自定义主题 一键换装 DSH。",
                "en": "38 classic opencode themes + 20+ custom themes — reskin DSH in one click." } },
    { "id": "im", "order": 40, "verifiedAt": "2026-10-30",
      "name": "dsh-im-companion", "repo": "FeatherHunter/dsh-im-companion",
      "desc": { "zh": "给 dsh-im 加了「助理」和「家」的概念。",
                "en": "Adds the ideas of an “assistant” and a “home” to dsh-im." } },
    { "id": "ilife", "order": 50, "verifiedAt": "2026-10-30",
      "name": "ilife", "repo": "FeatherHunter/ilife",
      "desc": { "zh": "⚠️建设中⚠️爱生活：居家生活套件，记账、运动、饮食、体重、食谱、物品管理、作息规划、备忘录等。",
                "en": "⚠️Work in progress⚠️ iLife, the home-life suite: bookkeeping, exercise, diet, weight, recipes, item management, schedule planning, memos and more." } }
  ]
}
```
规则：
1. **清单是全量，不是补丁**：加群 / 删群 / 换序 / 换图 / 改文案全部改 JSON；代码里没有「三个群」这种写死的东西。
2. **空数组 = 非法**：`groups` 或 `plugins` 为空时视为坏清单，整体回退内置基线（防一次误操作把弹窗与推荐卡清空）。
3. **清单不可用 → 回退内置基线**（包内飞书 / QQ 两码 + 五条插件），保证任何网络情况下都有内容可看。
4. **有效期按群独立**：单群 `validUntil` 过期只把那张卡降级为 `fallbackUrl` 链接，不影响其他卡。
5. **有效期文案不进数据**：由 core 用 `validUntil` 现场拼中英文（「该二维码 N 天内（M 月 D 日前）有效，重新进入将更新」/「Valid until ...」），避免数据与界面两处不一致。
6. **推荐文案由仓主定稿，允许写数字，但每个数字必须可追溯**：五条文案由仓主于 2026-10-30 逐字拍板（此前「禁写数字」的建议被推翻），`contact/plugins.json` 是唯一真源；每条带 `verifiedAt`（最后一次核对数字的日期），`doctor` 对超过 90 天未核对的条目提示「数字可能已过期」。改文案 = 改数据 + 发补丁版本，五仓无需发版。ilife 的「⚠️建设中⚠️」直接写在文案里，因此设置面板卡与 README 两个语言版本显示完全一致（不另设 badge 字段）。
7. **图片地址规则（按出口分两类）**：客户端从清单 `version` 拼精确版本 CDN 地址（`.../@<version>/data/img/<path>`）。**常驻码**（飞书 / QQ）图片内容永不变化，可钉任意已发布版本；**限时码**（微信，每周更新）必须同时满足三条——文件名带日期、URL 指向精确版本、查询串带 `?v=YYYYMMDD`——因为 GitHub 的 camo 图片代理按 URL 缓存，换图不换 URL 会继续显示旧图（各仓星图 SVG 已在用 `?v=`，已验证可行）。README 联系区的图片 URL 由 `readme:sync` 按清单重写（见 §7），所以限时码在 README 里最多滞后一个日更周期，且 `validUntil` 过期时该卡降级为链接，绝不展示过期码。README 图片经 `camo.githubusercontent.com` 代理、由 GitHub 服务端抓取，**弹窗的客户端可达性风险不传导到 README 图片**。
8. **作者插件清单固定 5 项**，展示顺序以 `contact/plugins.json` 的 `order` 为准：deck → prompt → palette → im → ilife（2026-10-30 仓主给定顺序；与此前各仓 README 的旧顺序 deck → palette → prompt 不同，README 迁移时统一按新顺序）。每个渲染面自动排除「自己」，`showSelf` 可关。（注：deck `docs/README.en.md` 现存 3 行里含 `dsh-chinese-skill-patch`，不在 5 条定稿清单内，迁移会移除该行；2026-10-30 待仓主确认，见审查文档 §8.6 D-b。）
9. **README 联系区与弹窗共用一份数据，但出口不同、字段分工明确**：README 版只用 `readmeTitle`（表头文字）、`alt`、`card`（260 宽整卡），**渲染结果保持现状的表格结构**（`<table align="center">` 一行表头 + 一行三张 260 宽图），不显示副行与角注；ilife 用 markdown 变体（`## 反馈与联系` 代替 CONNECT h2）。弹窗版才用 `title` / `subtitle` / `note` / `qr`（裁图）与由 `validUntil` 生成的有效期角注。两类字段都只在数据里出现，渲染器不做特例判断。**保留各仓既有功能元素**：星图区 deck 的外链（`<a>` 指向 star-history.html）、im 的 `width="720"` 与角注 `<sub>`、联系区 ilife 的 Markdown `##` 标题、作者其他作品区 prompt 的 `## 作者的其他作品 <sub>MORE</sub>` 标题变体，都必须保留，由渲染器的可选字段决定，不写死；**区块顺序也不假设**，初始化与同步一律按标记定位替换。
10. **群组的平台顺序沿用现状**：飞书（主）→ QQ（新）→ 微信（新，限时且每周更新）；新增平台只需加一条数据并给 `order`。
11. **渲染器版本与数据版本解耦**：五仓钉死渲染器精确版本；数据随 `@latest` 清单更新，周更换码只发数据版本，五仓无需改依赖。
### 3. 发布通道与新鲜度（P-A 落地）
- 发版即数据发布：`npm publish` 把 `data/` 一起带上；构建时把 `package.json` 的版本写进 manifest 的 `version` 字段。
- 客户端取清单（只取清单，不取代码）：
  1. 主通道 `https://unpkg.com/dsh-featherhunter-plugin-base@latest/data/manifest.json`（缓存 60 秒）；
  2. 备通道 `https://registry.npmmirror.com/dsh-featherhunter-plugin-base/latest` 拿版本号 → 再取 `/files/data/manifest.json`；
  3. 末位 `https://cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base@latest/data/manifest.json`。
- 客户端取图片：`https://cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base@<version>/data/img/<path>`，失败换 npmmirror 同路径；只允许 https 与上述白名单域名。
- 打开弹窗流程：先同步渲染内置基线（第一帧就有码）→ 并行 fetch 清单（AbortController，1500ms 超时，不重试）→ 校验通过整体替换 → 关掉即销毁；清单在模块内缓存 30 分钟，`preloadContent()` 可预热。
- 正确性不靠缓存新鲜度：即使拿到旧清单，`validUntil < 今天` 一律降级成链接，**绝不展示过期码**。
- 微码周更三步（1~10 分钟生效）：取新图 → `npm run contact:update -- <图片路径>`（结构校验、按日期落盘、更新 groups.json、清理 8 周前旧图、打印 diff）→ `npm version patch && npm publish`。
- 不做运行时远程加载代码、不做远程 theme / 远程 HTML。
### 4. 设置面板通用件（一物两版的第一版）
- `ContactButton`：16px SVG 线框图标（二维码/对话气泡，`currentColor`），`aria-label="联系我们"`、`title` 中文悬停提示，透明底、`border-radius: 6px`、hover 用 `--dsw-alias-bg-layer-2` 提升；点击 `openContactModal()`。尺寸 `size`（14/16/18，默认 16）与 `className` 可传。
- `ContactRow`：整行动作版本 = 图标 + 「联系我们」文字 + 右侧外链式箭头，样式与推荐行一致（同一套行样式函数），供只能放整行的面板使用。
- `AuthorPlugins`：卡片组件（一物两版里「设置面板版」），沿用现有观感：
  - 卡片：1px `--dsw-alias-border-l1`、圆角 10px、内边距 12px 14px、背景比面板亮一层（`--dsw-alias-bg-layer-2`）、无分隔线；
  - 标题行：2x2 宫格 SVG 图标 14px + 「作者其他插件」13px 600；
  - 行：同一行内 包名（monospace 12px 650，`--ds-font-family-code` 回退 Consolas）+ 描述（12px `--dsw-alias-label-secondary`，flex 1，省略号）+ 右侧外链图标（方框 + 右上斜箭头，14px，tertiary 色）；整行 `<a target="_blank" rel="noopener noreferrer">`，行内边距 7px 4px、圆角 6px、hover 提亮；
  - 行数与内容来自 manifest.plugins（排除 selfId），props 可覆盖 `title` / `plugins` / `lang` / `selfId` / `maxRows`；
  - 纯展示：不发请求、不写宿主存储；清单没到时先渲染内置 5 条基线，到货后静默替换。
- 三个控件都由 `createBaseUI(React, {lang, selfId})` 产出，调用方决定放哪一行；不注册 settings.section、不改宿主布局。
### 5. 联系弹窗
- 弹层用原生 `<dialog>.showModal()`（top layer）；不用 portal、不自绘遮罩、不靠 z-index 硬压——设置页内容列本身是滚动容器，absolute 定位会被裁掉。
- 结构：标题区（居中 `<sub>CONNECT</sub>` + 「反馈与联系 / Feedback and Contact」+ 右上关闭 x）→ 欢迎语 → 群卡网格 → 底部一行小字提示「扫描二维码加入我们 / Scan the QR code to join us」；文案内置 zh/en，`texts` 可覆盖。
- 布局：CSS grid，**列数 = min(群组数, 4)**（P-C 的「4 列」按上限解释：3 个群时三等分、不留空列；加到第 4 个群才出现第 4 列），面板 800 宽时每卡约 165px；`<720px` 最多 2 列、`<480px` 1 列；`columns` 参数可覆盖。
- 群卡：标题（13px 600）/ 副行（11px secondary，如群号、群名）/ 二维码（100% 宽、白底、6px 内边距、`image-rendering: pixelated`）/ 角注（10.5px tertiary，如「该二维码永久有效」或动态有效期）。码面目标 ≥150px。
- 交互：Esc 关闭、点遮罩（event.target === dialog）关闭、关闭即销毁节点并把焦点还给触发按钮；打开时锁 body 滚动、恢复时还原。
- 移动端兜底：卡片副行里的群号可点击复制（`navigator.clipboard`，失败回退选中文本），并提示「请在手机上扫码，或复制群号搜索」。
- 降级：某群过期 → 该卡换成「点此获取最新群二维码」（指向 `fallbackUrl`）；清单非法 / 超时 / 离线 → 保留内置基线两码，微码卡显示兜底链接；任何失败不弹错误、不写告警。
- 安全：JSON 结构校验（schema、字段类型、长度、`https` 图片地址、体积上限 512KB）、不使用 innerHTML / eval / 清单里的 HTML 文本、图片不在白名单域名不加载。
- 无障碍：`role=dialog`、`aria-modal`、`aria-labelledby` 指向标题、初始焦点在关闭按钮、Tab 焦点约束在弹窗内。
### 6. README 四块（同一份数据的第二个出口）
| 块 | 现状 | 目标 |
| --- | --- | --- |
| 联系区 | 四仓手写 CONNECT h2 + ilife 的 Markdown 变体，由 sync-contact.cjs 正则注入；图片五份副本 | `renderContactBlock` 输出，**保持现状结构**：标准变体 CONNECT h2 + 居中 div（欢迎语 + 三列表格 + 260 宽整卡），ilife 变体为 `## 反馈与联系` + 同一内层；新增 `<!-- CONTACT-START -->` / `<!-- CONTACT-END -->` 标记；图片引用 npm CDN 精确版本地址，不再拷进五仓；副行与角注只出现在弹窗，不进 README |
| 星图 | deck/im 深浅双图（deck 另有 star-history.html 外链、im 有 width 与角注）、palette/prompt 单图、ilife 缺失 | `renderStarHistoryBlock` 统一 `<picture>` 深浅双图 + `?v=YYYYMMDDHHmm`；保留 deck 外链、im 的 width 与角注（可选字段）；palette/prompt 升为双图；ilife 补上 |
| 致谢 | 五套生成器 325~376 行 | `renderThanksBlock` 纯函数，沿用现有 `<!-- THANKS-TABLE-*-START/END -->` 标记与表结构 |
| 作者其他插件 | 10 份 README 各写一遍、成员/顺序/文案/标题多形态漂移；ilife 缺失 | `renderMoreBlock` 输出标准 HTML 标题 `<h2 align="center"><sub>MORE</sub><br>作者的其他作品</h2>` + 引导句 + 4 行 `**[repo](url)** —— 一句话`；prompt 两个文件保留 `## … <sub>MORE</sub>` Markdown 变体；英文标题沿用各仓现有 `More from the author` / `More by the author`；新增 `<!-- MORE-START -->` / `<!-- MORE-END -->`；每仓排除自己；含 ilife（带建设中标识）；ilife 新增该块；deck en 的 `dsh-chinese-skill-patch` 行随统一移除（D-b 已确认，2026-10-30 拍板） |
- 目标文件清单：五仓共 11 个 README 文件（deck 的 README.md / package/README.md / docs/README.en.md、palette 的 README.md / package/README.md / docs/README.en.md、im 的 README.md / docs/README.en.md、prompt 的 README.md / docs/README.en.md、ilife 的 README.md）；精确路径写进交接文档。
- 渲染器签名统一为「数据 + 语言 + 图片基址 → 字符串」，纯函数、无 IO；`verifyBlock` 比对返回差异数组。
- 图片：README 联系区用 260 宽整卡（平台原生观感、可点开大图），不用裁图；地址形如 `https://cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base@1.0.7/data/img/card-feishu.png`。
- **等价口径（对抗式审查 F18 修正）**：README 验收从「语义等价」改为**内容等价**（成员集合、链接目标、表头与标题文字、图片宽度、alt 文本、致谢表数据一致）＋**允许模板统一带来的外观微调**；story 40「外观基本一致」按此解释——保留功能元素，不保留逐字节形态。判定用 fixture 规范化比较（白空格、属性顺序、引号不敏感），所有有意差异必须逐条写进迁移报告。
- **只替换标记块**：`readme:init` 遇到可疑结构（如 im README 现有的 `</div>>>>>>>> origin/master` 脏行）必须停手报错，不猜；`--check` 要把它列为待人工处理。
### 7. README 同步与发布（不新增 workflow 文件）
- 主路径：维护者本地跑 `npx dsh-featherhunter-plugin-base@1 readme:sync --all --repos <目录>`，一次改完五个仓库并打印每个文件的 diff 摘要；`--check` 只校验、非零退出，可作 CI 门禁。
- 次路径：在各仓**已有的** thanks / star workflow 里加一步 `npx ... readme:sync`（不新增 workflow 文件、不新增 schedule 文件），沿用仓库自带 GITHUB_TOKEN；README 无 diff 则无提交。**这一步是限时码新鲜度的唯一闭环**：清单来自 unpkg `@latest`，微码周更换版本后，下一个日更周期内五仓 README 的微信图 URL 自动改写；同一 workflow 里跑 `--check` 当门禁。
- **ilife 特例**：ilife 目前只有 push 触发的 `ci.yml`、没有定时任务。交接文档要求仓主在现有 `ci.yml` 里加 `schedule`（不新增 workflow 文件，最小改动）；不接受则退化为「随发版更新」，必须把滞后写进 README 说明。
- **版本解耦**：渲染器在五仓钉死精确版本；数据随 `@latest` 走。渲染器升级是独立动作（按交接文档改 package.json），不随周更发生。
- **旧链路退役**：新链路验收通过后，本仓 `scripts/sync-contact.cjs` 必须删除或改名归档（否则两套机制都会写 README）。该动作放进周更发布流水线票的验收。
- 不新增定时 workflow 的理由（写进交接文档）：五仓已有 star-history / thanks 两个每天定时任务，再挂一个会与它们在 README 上竞争提交产生非快进冲突；且 GitHub 官方文档明确「公开仓库 60 天无活动，scheduled workflow 会被自动禁用」。
- 标记初始化：`readme:init` 在四个块的正确位置插入标记与首版内容（幂等）；`readme:sync` 只替换标记之间。
- `doctor`：给一个仓库目录，输出「依赖声明版本 / 内联产物版本 / 四块是否与清单一致 / 图片地址是否指向当前版本」，供各仓 CI 一行接入。
### 8. 五仓接入方式（本次不改它们，只出文档）
- 三个通用件都是零 import 单文件，接入面只有：加一条依赖 → 在 client 入口 `createBaseUI(React, {lang, selfId})` → 在设置面板合适位置放 `ContactButton` / `AuthorPlugins`；ilife 只在 dsh-life-pack 总管 section 放 1 处。
- 各仓托管方式不同，交接文档逐仓写清：deck 走内联拼接（需把 base 产物当本地文件内联）、palette 走 INLINE_PACKAGES 逐文件登记、im/prompt 走 tsdown 依赖打包、ilife 走 tsc -b + build:client。
- 旧实现清理写进文档：im-companion 自绘二维码弹窗（connect-flow.ts）改调 base，palette/deck/prompt 的推荐卡与文案表删除，五仓 README 四块交给 `readme:sync`。
- 硬约束：本次提交不包含任何五仓文件的改动；如果发现必须改（例如某仓构建链吃不下单文件产物），先停下来在交接文档里给替代方案，不擅自改。
### 9. 交接文档（三份，每份可独立执行）
1. `docs/handover/01-接入联系弹窗与推荐卡.md`：装包、三行接入、按钮位置、推荐卡位置、ilife 总管页特例、删除旧实现、验收清单（深色/浅色、窄屏、Esc、焦点回归、断网）。
2. `docs/handover/02-README四块迁移.md`：`readme:init` 插入标记、联系区切换、星图改双图、ilife 补星图、致谢生成器替换、`--check` 门禁、11 个文件清单与逐文件 diff 预期。
3. `docs/handover/03-CI与发布.md`：现有 workflow 加一步的 YAML、首次写权限设置（Settings → Actions → General → Read and write）、`doctor` 门禁、base 版本升级流程、每周微码发布流程（contact:update → version patch → publish）。
### 10. 测试与验收
- 测试接缝见下一节；交付前必须全绿。
- 验收（自动部分）：包能构建、三入口可 import；demo 页能打开弹窗并看到群卡与推荐卡；断网时弹窗仍有飞书 / QQ 两码；把某群 `validUntil` 改成昨天后只剩兜底链接；把清单 `groups` 改成空数组时回退基线；client 产物 dist 契约通过；README 四块对 11 个 fixture 的内容等价比较通过；11 个文件逐个用 `readme:sync --check` 验证。
- 验收（必须真做、不可 mock）：`npm publish 0.0.1` 后 unpkg / jsDelivr / npmmirror 三通道实际拉到清单，jsDelivr 精确版本图片 200，记录生效耗时；随后「发布含真实清单版本 → 换一张微码图 → 再发 patch」演练，同一份客户端代码拉到新清单与新日期图片，README 同步把 URL 改写成新日期。
- 验收（HUMAN-GATE，代理不得自判通过，须仓主确认）：真机扫飞书 / QQ / 微信各一次；真实浏览器验证 dialog top layer、遮罩、焦点回归；GitHub 上四块实际观感；任一仓真实构建链吃下产物（palette mini-bundler 最高风险）；中国大陆网络下三通道全失败时的降级表现。
- 验收（交接）：三份交接文档按步骤在任一仓可独立完成接入。
## Testing Decisions
好的测试只断言外部行为（输入 → 可见输出），不绑定内部实现，也不依赖真实网络。
1. **core 纯函数接缝**（最高、最稳）：清单校验（缺字段 / 类型错 / 空数组 / 非法版本号）、合并与排序、有效期判定与中英文文案拼接、语言回退链（显式 > html[lang] > navigator.languages > zh）。
2. **node 渲染接缝 + fixture 基准**：四个渲染器是纯字符串函数；基准来自**先提取的 11 个真实 README 文件里的四块**（只读提取，存进 `test/fixtures/`），比较器做规范化（白空格、属性顺序、单双引号不敏感）后判**内容等价**（成员集合、链接目标、表头/标题/alt 文字、图片宽度、致谢表数据一致）；允许模板统一产生的差异，但必须逐条列进迁移报告。联系区两个变体各留基准，并断言 README 输出不出现弹窗专用的副行/角注字段；`verifyBlock` 用同一套比较器。
3. **client UI 接缝**：jsdom 里注入假 React 运行时挂载，断言：点击按钮打开 dialog、Esc/遮罩关闭、焦点回归、4 列 → 2 列 → 1 列降级、清单到达后群卡数量变化、群卡显示 title/subtitle/note（含由 `validUntil` 生成的角注）、过期群只剩链接、断网保留基线、推荐卡排除 selfId 且顺序按 `order`。网络层用假实现（不起真实请求）；jsdom 没有 `showModal`，测试 setup 里打桩。
4. **CLI 端到端接缝**：临时目录跑 `contact:update`（断言按日期命名、清理 8 周前旧图、非法图片被拒、打印 diff）；`readme:init` / `sync` / `--check` / `sync --all` 用两个假仓库目录断言幂等与标记边界；`doctor` 用假仓库断言结论字符串。
5. **发布与 CDN 冒烟接缝（非 hermetic，手动触发）**：真实 `npm publish` 后对 unpkg / jsDelivr / npmmirror 断言 200、版本推进、图片可下载；默认 skip（`test:network`），CI 不跑。
6. **dist 契约接缝**：构建产物断言 client 单文件无 `import` / `require` / 动态 import / TLA；node 入口可直接 `node` 运行；`npm pack --dry-run` 文件清单含 dist / data / README 且 exports 三入口可解析。
**裁图门禁的诚实说明（对抗式审查 F2 结论）**：不能用「解码成功」当门禁——实测 OpenCV 与 jsQR 对 QQ（蓝紫渐变圆点）与微信（圆点 + 中心 logo）码全部解不出，只有飞书可解；因此门禁改为：
- 自动部分：OpenCV `detect` 定位二维码包围盒 → 裁图 → 再检测一次覆盖面积比 ≥0.9 → 白边外扩到 ≥4 个模块 → 输出尺寸 ≥320px、方形、灰度可用；
- 人工部分：每张新码发布前用真机扫一次（写进交接文档与每周发布清单）；`contact:update` 打印「请真机确认」提醒并以非零退出码标记待确认，确认后再发布。
## Out of Scope
- 不修改另外五个插件仓库的代码与 README（由仓主按交接文档执行）。
- 不做安装检测、一键安装、已安装推荐位排序。
- 不做运行时动态 README（GitHub 渲染静态 Markdown；动态 SVG 图床会被 camo 缓存卡住，SVG 内引用的二维码会被拦）。
- 不在线生成二维码、不做二维码失效的远端探测。
- 不做点击放大整卡（v1.1）、分组标题（超过 8 个群再议）、横向轮播。
- 不做星图 / 致谢 / 作者的远端数据抓取：渲染器只画调用方传入的数据；贡献者数据仍由各仓现有脚本取。
- 不新增定时 workflow、不使用 PAT / secret、不做运行时远程加载代码与自动更新。
- 不做推荐文案数字的自动抓取核对：改用 `verifiedAt` + 仓主人工核对 + `doctor` 90 天提醒，避免为五个插件写五个抓数器。
## Further Notes
- 拍板记录（2026-10-30）：P-A npm CDN、P-B 四块全做、P-C 4 列、P-D ilife 总管页 1 处、P-E 推荐位两版、P-F 五仓零改动。
- 推荐文案定稿（2026-10-30，仓主逐字给定，`contact/plugins.json` 已落库校验通过）：deck「近 30 万 star 的 mattpocock/skills 整套预置好（27 个技能），装好即用。」prompt「经常反复重复的模板化提示词，存成自定义模板，选中后直接注入，不再需要耗费精力。」palette「38 款 opencode 经典配色 + 20+自定义主题 一键换装 DSH。」im「给 dsh-im 加了「助理」和「家」的概念。」ilife「⚠️建设中⚠️爱生活：居家生活套件，记账、运动、饮食、体重、食谱、物品管理、作息规划、备忘录等。」顺序 deck → prompt → palette → im → ilife。英文暂用五仓现有英文合并稿，仓主可随时改数据。
- 发布凭据：仓主已提供 npm token（npm 用户 `feather_wch`，token 可发布 `dsh-featherhunter-plugin-base`），只存本机 `.local/npm-token.txt`（已进 `.gitignore`，不入库、不写文档）；首次发布前用 `npm whoami` 验证，发布在 CI/本机从该文件读。
- 已核实前提：base 仓库公开（可用 npm CDN 与 raw 地址）；npm 包名 `dsh-featherhunter-plugin-base` 在 npmjs / npmmirror / unpkg 均未被占用（404）。
- 体积实测（决定内置基线规模）：三张二维码裁图 320px / 16 色量化后为 feishu 13.4KB、QQ 23.1KB、wechat 16.9KB（原始合计 53.4KB，base64 约 71KB）；只内置飞书 + QQ 两码约 49KB base64。4 色量化会让 QQ 渐变码明显发白，禁止使用；WebP 在旧 WebView 兼容性不如 PNG，暂不用。
- 传输通道实测（本机 2026-10-30）：unpkg 清单 max-age 60s、jsDelivr 精确版本 immutable、npmmirror `/files/` 需精确版本；三者本机均可达。中国大陆可达性仍需五仓实测（交接文档验收项含断网/超时表现）。
- 风险与回退：若 unpkg 在某用户网络不可达，客户端按备通道降级；若三通道全不可达，弹窗退回内置基线（两码 + 推荐五条），功能不中断。
- 实施顺序（2026-10-30 对抗式审查后改按风险排序，见审查文档 §8.4）：包骨架与产物契约 → 首次发布冒烟 → 群组数据链与内置基线 → 联系弹窗 → 远程清单与换码演练 → 作者插件卡 → README fixture 与四个渲染器（垂直切片）→ 同步门禁与 doctor → 周更发布流水线 → 三份交接文档。
- 本规格由 /grill-with-docs 讨论与对抗式审查（docs/base包-对抗式审查.md）沉淀而来；方案细节见 docs/base包与联系弹窗-方案.md。
## Comments
### local — 2026-10-30T14:50:19.881Z
对抗式审查完成（2026-10-30）：结论见 docs/base包-对抗式审查.md。三处硬伤 —— F1 传输通道应改 npm CDN（GitHub CDN 终端可达性不可证）、F2 jsQR 解码门禁不可行（QQ/微信码开源解码器解不出）、F3「三行接入」不成立（五仓构建链各异）。另：包体积实测约 71KB base64（三码）/ 49KB（两码）；README 迁移实际 9~10 个文件，且不宜新增定时 workflow。待用户拍板 P-A 传输通道 / P-B v1 范围（是否含星图致谢）/ P-C 列数 / P-D ilife 入口后更新本规格正文。
### local — 2026-10-30T15:12:23.087Z
拍板落实（2026-10-30）：P-A npm CDN / P-B 四块全做 / P-C 4 列 / P-D ilife 总管页 1 处，另加「作者插件推荐 = 设置面板控件 + README 中英两版」。规格正文已按此重写（标题改为「base 包：设置面板通用件（联系弹窗 + 作者插件卡）+ README 四块统一渲染」），新增 §0 已拍板决策、§4 设置面板通用件、manifest 增 plugins 数组、README 由三块扩为四块、同步机制改为「不新增定时 workflow」。审查新增 F16：作者插件区在 5 面板 + 10 处 README 已漂移（成员集合 5 种、数字互相矛盾、ilife README 缺失），已纳入 v1 并用单一 plugins.json 收敛。
### local — 2026-10-30T15:29:27.387Z
文案与凭据落实（2026-10-30 晚）：
① 五条推荐文案已按仓主逐字定稿落库 `contact/plugins.json`（顺序 deck → prompt → palette → im → ilife，每条 order + verifiedAt），规格 §2 规则 6 由「禁写数字」改为「允许写数字 + verifiedAt + doctor 90 天提醒」，manifest 示例与 user story 29 同步改；
② ilife 的「⚠️建设中⚠️」写进文案本身，设置面板卡与 README 中英版共用同一条文案，不设 badge 字段；
③ npm 发布凭据已由仓主提供并验证（whoami=feather_wch；包名 dsh-featherhunter-plugin-base 仍 404 可用），token 仅存本机 .local/npm-token.txt 且已进 .gitignore，不入库、不写进任何文档；
④ 待确认：顺序按仓主列出顺序落库；若那只是枚举顺序、希望沿用 README 旧序（deck → palette → prompt），改数据即可，不影响代码。
### local — 2026-10-30T15:42:16.090Z
/to-spec 收口（2026-10-30 晚）：规格按模板复核完成，票 00（ready-for-agent）即最终规格。
本轮补强四处：① §2 新增规则 9/10：群组数据一份、两个出口字段分工——README 版 `readmeTitle`+`alt`+`card` 保持现状表格结构（含 ilife 的 `## 反馈与联系` 变体），弹窗版 `title`+`subtitle`+`note`+裁图+`validUntil` 角注；② manifest 的 groups 示例补齐中英表头、alt、弹窗标题/副行/角注；③ 新增 user stories 45-48（README 结构保真、ilife Markdown 变体、弹窗卡片三类文字、两出口字段分开）；④ Testing Decisions 增补：联系区两变体各留快照、断言 README 输出不含弹窗专用字段、弹窗卡显示 title/subtitle/note。
测试接缝仍为 4 条（全部是新建包内的最高接缝）：core 纯函数 / node 渲染器（纯字符串）/ client jsdom / CLI 端到端；等仓主确认接缝后即可 /to-tickets。
### local — 2026-10-30T15:58:03.240Z
拆票已按批准方案落库：`.scratch/base-package/issues/01..13`，共 13 张实施票，依赖边与规格 §0/§10 一致；拍板 D-a（4 列为上限）、D-b（deck en 移除 chinese-skill-patch）、D-c（内容等价口径）、D-d（ilife 现有 CI 加定时）已写入计划 §16 与规格。
### local — 2026-10-30T20:08:28.498Z
规格：`.scratch/base-package/spec.md`（票 00）。
交付：仓库 `FeatherHunter/featherhunter-plugin-manage`，长期分支 `main`，提交 `7f1d39f5ee584a83db0195b2a1b2f726a4ffe45b`，已推送 `origin/main`（远端 tip 与本地相同）。集成分支 `feat/base-package` 以 fast-forward 合入后删除；仓库无 PR 约定，直接推送。
验收时间：2026-10-31 04:05（Asia/Shanghai）。实施票 01–13 全部 closed（每票正文/进度已按各票收尾更新）。

### local — 2026-10-30T20:10:21.498Z
关闭后补充（2026-10-31T04:10+08:00）：规格关闭写回的文件改动已单独提交 `0969bb1`（仅 `.scratch/base-package/spec.md`：收口评论、状态 closed、进度 100%，不改实现代码），已推送 `origin/main`；在该提交上复跑 `.tmp/final-acceptance.ps1` = 7/7（typecheck/test/build/三入口/demo-build/packlist/五仓 unchanged，日志 `.tmp/acceptance-closeout.log`），工作树仅 `?? .scratch/desktop-crash/`（非本实施）。

## 一、逐票核对（打开每张票对照判据，看最终代码与测试，不只看关闭状态）

- **01 包骨架与三入口契约**（`e801688`）：查 `packages/base/package.json`（`exports` 的 `./core` `./client` `./node`、`bin` `dsh-base`、`peerDependencies` react `^18 || ^19`）、`packages/base/build.mjs`、`packages/base/tsconfig.build.json`、`packages/base/test/dist-contract.test.ts`（8 例）；命令 `npm run typecheck` / `npm run build` / `npm test` 全绿；client 产物零 import、node 产物只 import `node:`、packlist 含 dist/data/README。
- **02 首次真实发布与三通道冒烟**（`9daed13`）：查 `packages/base/scripts/cdn-smoke.mjs`、`packages/base/test/network/cdn-smoke.test.ts`（6 例，默认 skip）、`docs/base包-发布与回滚.md`；真实数据：npm 0.0.1 于 2026-10-31T01:00:26+08:00 可见（`npm view dist-tags.latest` = 0.0.1，shasum `035811a01a7070b30d66c298a754267450dafd4f`，fileCount 27）；unpkg `@latest` 01:05:40 返回（约 5m14s）、jsDelivr `@latest` 01:01:38 返回（约 2m07s）；jsDelivr 精确版本图 `@0.0.1/data/img/card-feishu.png` 200 image/png、`cache-control: public,max-age=31536000,s-maxage=31536000,immutable`、12292B；npmmirror `/files` 403（cnpm 白名单政策，客户端回退 jsDelivr）。
- **03 群组数据链与内置基线**（`400553d`）：查 `contact/{groups.json,crops.json,plugins.json,src/*}`、生成器 `packages/base/scripts/{png,image,io,build-data,contact-update}.ts`、发布物 `packages/base/data/manifest.json` + `packages/base/data/img` 6 PNG、`packages/base/src/core/baseline.ts`；`packages/base/test/data-chain.test.ts` 12 例 + `dist-contract.test.ts` 8 例；`npm run data:check` 二次生成字节一致；contact:update 日期命名、清 56 天旧图、拒非法图/空白裁图、LCS 行级 diff、退出码 3 待真机确认。
- **04 联系弹窗**（`d46a130`，合并 `3085da5`）：查 `packages/base/src/client/{modal,texts,index,styles}.ts`；`packages/base/test/client/{modal,layout,expired,lang,interaction,copy,widgets}.test.ts` 共 29 例；`dialog.showModal` 失败降级、Esc keydown+cancel 双路径、遮罩点击、焦点陷阱与回归、body 滚动锁还原、`role=dialog`/`aria-modal`/`aria-labelledby`、列数 min(群数,4)、`<720px` 2 列、`<480px` 1 列、模块级单例 dialog。
- **05 远程清单与换码演练**（`b756757`）：查 `packages/base/src/client/content.ts`（unpkg → npmmirror → jsDelivr 回退、1500ms 超时、30 分钟缓存、512KB 图片上限、https 白名单）、`modal.ts` 原地换卡、`index.ts` 基线先渲染；`packages/base/test/client/content.test.ts` 25 例 + `remote.test.ts` 7 例；0.0.2-drill 真实换码：真实客户端 154ms 从内置基线切到新图（10857B，sha256 `3d8bedab…`，与 0.0.1 qr 的 `41ae6dba…` 不同），文案从「该二维码已过期」变为「该二维码 6 天内（11 月 6 日前）有效」。
- **06 作者插件卡**（`57903b5`，合并 `8be67dc`）：查 `packages/base/src/client/plugins.ts`、`types.ts`（showSelf、maxRows 默认 5）、`styles.ts`；`packages/base/test/client/plugins.test.ts` 22 例 + 快照；整行 `a target=_blank rel=noopener noreferrer`、固定 5 项顺序 deck→prompt→palette→im→ilife 且默认排除自己、无数据/全排除/maxRows=0 不渲染容器。
- **07 README 现状 fixture 与等价口径**（`7a14c04`，合并 `a96f223`）：查 `packages/base/src/node/readme-compare.ts`（961 行、零 import 单文件）、`packages/base/test/readme-compare.test.ts` 43 例、`packages/base/test/fixtures/readme-blocks.json`（11 文件×4 块，42 非空 + ilife 缺 star-history/more）、`docs/base包-readme现状与形态差异.md` 304 行；`dsh-im-companion/README.md:262` 的 `</div>>>>>>>> origin/master` 被识别为 merge-conflict-residue 脏行。
- **08 README 联系区渲染与同步**（`d6ad09f`/`adb337f`）：查 `packages/base/src/node/{renderers.ts,readme-sync.ts}`、`cli.ts` 的 `readme:init|sync`（`--check`/`--all`/`--root`，退出码 0/1/2）；`packages/base/test/{contact-render,readme-sync,readme-cli}.test.ts` 共 31 例；幂等零 diff、`--check` 差异退出 1、脏行/标记不配对报错且文件不变、图片 URL 精确版本 + 日期文件名 + `?v=YYYYMMDD`、输出不含弹窗专用字段。
- **09 README 作者作品区渲染与同步**（`a9a1c48`+`2996fd9`，合并 `46ff6d6`）：查 `renderMoreBlock`/`pluginLink`/`MORE_TEXT`、per-block heading 变体、`cli --readme/--self`；`packages/base/test/readme-more.test.ts` 7 例 + readme-sync +6 + readme-cli +2；10 处既有渲染点内容等价、prompt 两文件保留 Markdown 标题变体、英文两形态保留、ilife 在 EOF 插入新块、deck-en 移除 `dsh-chinese-skill-patch` 且保留 footer。
- **10 README 星图区与致谢区渲染**（`8e29cb1`，合并 `46ff6d6`）：查 `renderStarHistoryBlock`（picture 深浅双图 + `?v=YYYYMMDDHHmm` 12 位）、`renderThanksBlock`（五仓 `docs/thanks-data.json` 排名与合并段规则、空表仅表头+分隔行）；`packages/base/test/star-history-render.test.ts` 6 例 + `thanks-render.test.ts` 7 例 + `readme-star-thanks-sync.test.ts` 9 例；deck 外链与 im width/角注保留、palette/prompt 单图升双图、ilife 新增星图、五仓致谢表逐行等价（deck 47 行、palette 9、im 3、prompt 5、ilife 空表）。
- **11 全量同步门禁与 doctor**（`5ff50de`）：查 `packages/base/src/node/{targets.ts,doctor.ts}`、`readme:init|sync --all --repos`（内置 11 文件表）、`--check` 对漂移/缺标记/脏行/标记不配对或重复或顺序错误明确报错非零退出且不改文件、同目录临时文件+原子 rename；doctor 检查 package-version/data-freshness/remote-manifest/逐仓 readme-blocks/readme-images/dependency-version/inline-bundle-version/cron-mounts；`packages/base/test/readme-targets.test.ts` 10 例 + `doctor.test.ts` 14 例；`.tmp/drill-repos` 演练 init 迁移 10/11（im 脏行按规格停手报错）、二次 sync 零 diff、doctor `--repos --offline --json` 29 项检查。
- **12 周更发布流水线与发布演练**（`a730f87`→`a85ebab`，退役提交 `950067c`）：查 `packages/base/scripts/release.ts`（preflight→worktree→contact→data→version→gates→pack→publish→registry→CDN→readme→report；`--image`/`--group`；contact 失败 `git clean -fdq -- contact` 回滚；发布前失败 rolled-back、发布后失败 manual）；`packages/base/test/release.test.ts` 20 例；0.0.2-drill 真实发布 01:19:27（`--tag drill`，`@latest` 保持 0.0.1），unpkg 247ms/jsDelivr 914ms 返回新清单、精确图 200 immutable（12292B/10857B/16282B）；用 npm 上真实 0.0.2-drill 清单驱动 readme:sync 演练：10/11 文件把 `@0.0.1` 改写成 `@0.0.2-drill`、wechat 卡从 `card-wechat-2026-10-23?v=20261023` 改为 `card-wechat-2026-11-06?v=20261106`，im 根 README 因脏行按设计拒绝；`950067c` 删除 `scripts/sync-contact.cjs`（186 行）。
- **13 交接文档与最终验收**（`1fd9755`）：查 `docs/handover/01-接入联系弹窗与推荐卡.md`（157 行）、`02-README四块迁移.md`（114 行）、`03-CI与发布.md`（154 行）、`docs/base包-最终验收记录.md`；最终自动验收 7/7（typecheck/test/build/三入口/demo-build/packlist/五仓 unchanged）。

## 二、逐条用户故事 → 实现或测试证据（52 条全覆盖）

- **故事 1、15**（设置面板图标按钮 + 整行版）：`packages/base/src/client/index.ts` 的 `ContactButton`/`ContactRow`；`packages/base/test/client/widgets.test.ts`「opens the modal from the contact button and moves focus back on close」「renders the contact row with a button」。
- **故事 2、5**（弹窗在当前面板上层、Esc/遮罩关闭且焦点回归）：`packages/base/src/client/modal.ts`；`packages/base/test/client/modal.test.ts`「opens with no arguments, shows the baseline groups and dialog semantics」、`interaction.test.ts`「closes on Escape and returns focus to the trigger」「cancels the native cancel event and closes itself instead」「closes when the backdrop itself is clicked but not when the panel is」「keeps Tab focus inside the dialog」「restores focus to the dialog when focus escapes it, then closes safely twice」。
- **故事 3、4、47**（弹窗直看飞码/Q码/微码、扫码提示与欢迎语、群卡三类文字）：`packages/base/src/client/texts.ts` 内置中英文；`packages/base/src/core/types.ts` 的 title/subtitle/note/validUntil；`packages/base/test/client/expired.test.ts` 4 例 + `lang.test.ts` 6 例；`packages/base/test/data-chain.test.ts`「rejects empty groups, bad dates, missing fields and duplicate ids」。
- **故事 6**（颜色跟随宿主深浅主题）：`packages/base/src/client/styles.ts` 全部颜色走宿主变量并带回退：`var(--dsw-alias-border-l1, …)`、`var(--dsw-alias-bg-layer-2, …)`、`var(--dsw-alias-label-secondary, …)`、`var(--dsw-alias-label-tertiary, …)`；`packages/base/test/client/plugins.test.ts`「injects the shared stylesheet once when the card renders」。
- **故事 7、8**（窗口变窄降列不裁码、4 列下码面仍够大）：`packages/base/src/client/modal.ts` 列数 min(群数,4) 与 `<720px` 2 列、`<480px` 1 列；`packages/base/test/client/layout.test.ts` 4 例「defaults to one column per group, capped at four」「honours the columns option below the ceiling and clamps hard above it」「lays the grid out with the column variable and collapses on narrow screens」「sizes the panel like the README cards, with a scrollable body」。
- **故事 9、10、26、27**（离线基线、不展示过期码、坏清单/空群回退基线）：`packages/base/src/client/content.ts` + `packages/base/src/core/baseline.ts`；`packages/base/test/client/content.test.ts` 25 例（含「falls back to jsDelivr when unpkg and npmmirror fail」「degrades to null when every channel fails, without throwing」「rejects invalid JSON and invalid manifests, then keeps falling back」「times out a hanging channel and moves on (1.5s window, no retries)」）、`expired.test.ts`「degrades an expired group to a fallback link and never renders its code」「treats validUntil as inclusive: a code is usable through its last day」。
- **故事 11**（手机端群号点击复制）：`packages/base/src/client/modal.ts`；`packages/base/test/client/copy.test.ts` 2 例「copies the subtitle to the clipboard and marks the button」「selects the text when the clipboard API is unavailable」。
- **故事 12、13、21**（设置面板推荐卡、整行点开新标签、自动排除自己）：`packages/base/src/client/plugins.ts`；`packages/base/test/client/plugins.test.ts`「shows the five finalised plugins in order when no host plugin is set」「drops the host plugin when selfId is configured」「opens the repository in a new tab with opener protection」「renders icon + name + one-line description + external-link icon per row」。
- **故事 14、17、18、42、43**（五仓共用一套件、不 import React 由调用方注入、零 import 单文件、React 18/19、不注册 section 不读写宿主）：`packages/base/package.json`（三入口 exports、`peerDependencies` react `^18 || ^19`）、`packages/base/src/client/index.ts` 的 `createBaseUI(React, {lang, selfId})`、`packages/base/build.mjs` 单文件打包；`packages/base/test/dist-contract.test.ts`「exposes ./core, ./client and ./node」「contains no static import, require, dynamic import or top-level await」「imports as a single self-contained module」「node bundle only imports node: builtins」；`packages/base/src/client` 全目录 grep 无 localStorage/sessionStorage/settings.*/宿主插件 API。说明：自动化只在 React 19 + jsdom 跑过，React 18 未实跑；实现只使用 18/19 共有 API（createElement/hooks）且不 import React，peer 范围钉 `^18 || ^19`，真实 18 宿主由接入验证覆盖。
- **故事 16、38**（三行接入、交接文档可独立执行）：`docs/handover/01-接入联系弹窗与推荐卡.md` §2 安装与三行接入、§3 选项/props 表、§4 逐仓落点、§8 七类失败与回退；`packages/base/test/client` 全量用例都通过 `createBaseUI` 注入 React 调用。
- **故事 19、20、48**（中英内置可覆盖、单实例覆盖群组/插件清单、两出口字段分开）：`packages/base/src/client/{texts,types,index}.ts`；`packages/base/test/client/lang.test.ts` 6 例「uses the explicit setting first」「falls back to the html lang attribute」「lets a single open call override the instance language」「applies text overrides on top of the detected language」；`packages/base/test/client/remote.test.ts`「does not clobber an explicit group override」；`packages/base/test/contact-render.test.ts`「never renders the modal-only title/subtitle/note/qr fields」。
- **故事 22、23、24、25、28**（加群/删群/换序只改数据、周更换码一条命令、结构与尺寸检查+真机提醒、单一插件清单）：`contact/groups.json` + `contact/plugins.json` 唯一真源 → `packages/base/scripts/build-data.ts` 生成 `packages/base/data/manifest.json` + `data/img`；`packages/base/test/data-chain.test.ts` 12 例（含「sorts groups by order, points every QR at the published PNG and validates」「writes dated files, bumps the manifest, drops stale images and prints a diff」「exits 3 until a human confirms, and supports dry-run」「rejects invalid images, blank crops and unknown groups」）。
- **故事 29、36、52**（verifiedAt 与 90 天提醒、一条命令 doctor、钉死版本不自动升级）：`packages/base/src/node/doctor.ts` 的 copy-freshness（90 天）与 dependency-version（精确版本）；`packages/base/test/doctor.test.ts`「flags stale recommendation copy and an old manifest」「flags a dependency range instead of an exact version」「flags image URLs that point at an older version」「prints a machine-readable report with --json and exits 0 when healthy」「checks every managed repository under --repos」；`docs/handover/03-CI与发布.md` §4 检查项表。
- **故事 30、31、32、33、45、46、49**（四块同源渲染、标记隔离、图片不拷副本、精确版本 URL、260 宽表格保真、ilife Markdown 标题）：`packages/base/src/node/renderers.ts`（联系/星图/致谢/作者四块纯函数）+ `readme-sync.ts` 标记块引擎；`packages/base/test/contact-render.test.ts` 10 例（含「renders the standard CONNECT variant content-equivalent to the pre-migration fixture」「renders ilife's Markdown heading variant content-equivalent to its fixture」「keeps the 260-wide whole-card table and hides modal-only fields」「builds precise-version absolute https image URLs with the right cache busters」）、`packages/base/test/readme-sync.test.ts` 20 例（含「inserts paired markers around a rendered contact block in an unmarked README」「rewrites only the marked block, then is a zero-diff no-op」）。
- **故事 34**（星图统一深浅双图 + 分钟级时间戳）：`packages/base/src/node/renderers.ts` 的 `renderStarHistoryBlock`；`packages/base/test/star-history-render.test.ts`「renders a light/dark picture pair with a minute-level version query string」「rejects missing data and a non-minute-level version」。
- **故事 35**（致谢按现有数据生成、风格一致）：`renderThanksBlock`；`packages/base/test/thanks-render.test.ts` 7 例「reproduces the … table from its docs/thanks-data.json」「counts roses by greedy tiers」「merges comments into the issue/PR segments and sorts each segment」「renders an empty table as header + separator only (ilife rule)」。
- **故事 37、50**（不新增定时 workflow、旧脚本退役）：本仓根目录无 `.github/workflows`（`git ls-tree` 为空，未新增 workflow 文件）；`950067c` 删除 `scripts/sync-contact.cjs`（186 行），全仓 grep 只剩 `readme:sync` 一条写 README 路径；doctor `cron-mounts` 检查 + `docs/handover/03-CI与发布.md` §2 给出挂已有 workflow 与 ilife `ci.yml` 加 `schedule:` 的方案。
- **故事 39、44、51**（五仓零改动、ilife 只在总管页 1 处、ilife 也有星图与作品区）：最终验收 `real-repos-unchanged` 7/7（运行前后五仓 HEAD + porcelain 快照一致，演练全部在 `.tmp/drill-repos` 副本）；`docs/handover/01` §5 ilife 特例（只在 `dsh-life-pack` 总管 section 放 1 处，六个 skill 包不加入口）；`packages/base/test/readme-targets.test.ts`「lists the eleven managed READMEs across the five repositories」「initializes all eleven READMEs and is idempotent afterwards」、`packages/base/test/readme-star-thanks-sync.test.ts`「appends a star-history block at EOF for a repository that has none (ilife)」。
- **故事 40、41**（GitHub 观感基本一致、联系区图可点开大图）：`packages/base/src/node/readme-compare.ts` + `packages/base/test/fixtures/readme-blocks.json` 按规格 §6 内容等价口径（成员/链接/表头/alt/图片宽度/致谢数据一致，白空格与属性顺序不敏感，spec.md:289）；`packages/base/test/readme-more.test.ts`「renders every fixture README with only the documented intentional differences」、`readme-compare.test.ts` 43 例；联系区仍输出与迁移前逐字节同构的 `<img width=260>`，「点开看大图」由 GitHub 原生行为提供，规格明确 v1.1 才做自定义点击放大（spec.md:288、spec.md:346），故未加自定义放大。

## 三、检查命令与结果（在 7f1d39f 上，2026-10-31 04:05 +08:00 复跑）

- `git rev-parse HEAD` = `git ls-remote origin refs/heads/main` = `7f1d39f5ee584a83db0195b2a1b2f726a4ffe45b`；`git status --porcelain` 仅 `?? .scratch/desktop-crash/`（非本次实施产物，未提交、未触碰）。
- `npm ci`：node_modules 曾被环境清空，用已提交的 `packages/base/package-lock.json` 恢复（85 packages）。
- `npm run typecheck` → `tsc clean`（exit 0）。
- `npm test` → `Test Files 23 passed | 1 skipped (24)`；`Tests 280 passed | 6 skipped (286)`；跳过的是 `packages/base/test/network/cdn-smoke.test.ts`（需真实网络与已发布版本，规格要求默认 skip）。
- `npm run build` → `build ok: core, client, node`。
- `npm run data:check` → `build:data — generated data is up to date`（exit 0）。
- 三入口 import → `core=8 client=18 node=56`。
- `npm run build:demo` → `demo/dist built`。
- `npm pack --dry-run --json` → `files=32 size=324201`。
- `pwsh .tmp/final-acceptance.ps1` → `RESULT: 7/7 checks passed`（日志 `.tmp/acceptance-closeout.log`）。
- 复现：`git clone` 后 `git checkout 7f1d39f` → `cd packages/base` → `npm ci` → 依次跑上述命令；验收脚本用 PowerShell 7（Windows PowerShell 5.1 会剥掉 `node -e` 的双引号导致误报）。
- 备注：验收窗口内 deck 仓主并发跑截图脚本（`docs/prototype/vc-redesign/screenshots/*` mtime 04:01），`real-repos-unchanged` 曾两次瞬时失败；静默窗口复跑 7/7。该检查是运行前后快照对比，只证明本次运行未写五仓，不比较跨会话基线。

## 四、交付证明

- 长期分支 `main`，提交 `7f1d39f`（`origin/main` 同一提交）；集成分支 `feat/base-package` 已 ff 合入并删除；未使用 PR（仓库无 PR 约定）。
- 实现主体 `1fd9755`：`git show --stat 1fd9755` = 111 files changed, 24935 insertions(+), 242 deletions(-)；其后 `51d55e7`/`a8e46d0`/`7f1d39f` 只改验收记录与规格正文（不改实现代码）。
- 推送记录：`e5c088e..1fd9755` → `1fd9755..51d55e7` → `51d55e7..a8e46d0` → `a8e46d0..7f1d39f`（均 `main -> main`）。
- 提交信息不含 `Closes #` 之类自动关闭关键词；规格关闭只由本次 `deck_issue_patch` 执行。

## 五、遗留处置

- **临时工作树**：6 个 ticket worktree 全部 `git worktree remove` 移除（readme-blocks 用 `--force` 清掉未跟踪 smoke 副本）；`D:/dsh-plugin/base-wt` 目录（含 3 个未跟踪 smoke 脚本）已删除；`git worktree list` 只剩主工作树。
- **分支**：已合并的 `ticket/04-contact-modal`、`ticket/06-author-plugins`、`ticket/07-readme-fixtures`、`ticket/08-readme-contact`、`ticket/09-10-readme-blocks` 与 `feat/base-package` 已删除。**保留未合并分支 `ticket/11-sync-doctor`（`88f0948`）**，其独有提交：`5bbfd8a`（feat(node): add README target table with per-file variants and star query resolution (ticket 11)）、`88f0948`（feat(node): render all eleven READMEs from --repos with idempotent sync (ticket 11)），相对 main 8 files 808 insertions；该实现已被 `5ff50de` 取代、未合入 main，可安全删除（保留供审阅）。
- **未提交改动**：无。工作树仅 `?? .scratch/desktop-crash/`（非本次实施产物，未提交、未触碰）。
- **临时文件**：`.tmp/`（13.9MB，已 gitignore）保留为验收/演练证据（`docs/base包-最终验收记录.md` §6 引用其路径），不属于交付树，可整目录删除；证据可再生成（`.tmp/final-acceptance.ps1`、`.tmp/prepare-drill-repos.ps1`、`.tmp/drill-prepare.mjs`）。`.scratch/probe/`（gitignored 标定探针）与 `.scratch/desktop-crash/` 保持原状。
- **待定事项**：无未决代码项。规格 §6「deck en 移除 `dsh-chinese-skill-patch`」的 D-b 拍板已在规格正文标注（本次 `7f1d39f` 写入）并由票 09 落地；顺序按仓主逐字定稿 deck→prompt→palette→im→ilife 落库。
- **HUMAN-GATE 五项**（规格 §10 要求仓主确认，代理不自判）：真机扫飞书/QQ/微信各一次、真实浏览器 `<dialog>` top layer/遮罩/焦点回归、GitHub 四块观感、五仓真实构建链吃下产物（palette mini-bundler 风险最高）、中国大陆网络三通道全失败降级；逐条列于 `docs/base包-最终验收记录.md` §3，与 `docs/handover/01` §7.2、`docs/handover/03` §6 对应，待各仓主按 §4.2 清单执行。
- **外部限制（非本仓可闭环）**：npmmirror `/files` 403 是 cnpm 白名单政策（客户端已回退 jsDelivr，需时可向 cnpm/unpkg-white-list 提 PR）；npm staged publishing 约 1.5 分钟审核延迟（发布脚本已内置 registry 轮询）；真实新微码未由仓主提供，生产 `@latest` 仍 0.0.1、微信群码 2026-10-30 过期（客户端按设计降级兜底链接），拿到新码后 `npm run release -- --version 0.0.2 --image <新码> --repos <父目录>` 一条命令即可，无需五仓发版。
- **新票**：无。上述 HUMAN-GATE 与外部限制不需要新票；各仓接入与勾选按 `docs/base包-最终验收记录.md` §4.2 执行。

## 六、关闭前自检

- 本评论写的提交 = 跑检查的那棵树：HEAD `7f1d39f`，`origin/main` 同为 `7f1d39f`，工作树无本次实施产生的未提交改动。
- 检查结果来自本次会话（2026-10-31 03:5x–04:05 +08:00）而非记忆；7/7 日志在 `.tmp/acceptance-closeout.log`，测试计数为本会话 `npm test` 输出。
- 13 张实施票（01–13）均 closed 且各票正文/进度已按收尾更新；本次关闭规格票只代表实施完成，HUMAN-GATE 五项仍待仓主确认。

## 进度

- 进度：100%（2026-10-31T04:09:02+08:00）：13 张实施票 01–13 全部关闭；main 7f1d39f 上自动验收 7/7；收口评论见本票 Comments
- 进度：100%（2026-10-31T04:08:28+08:00）：13 张实施票 01–13 全部关闭；main 7f1d39f 上自动验收 7/7，收口评论已留证，规格关闭
