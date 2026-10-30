# awesome 上架预览图上限、选图与"只显示三张"根因

> 日期：2026-10-26 · 工作区：D:/dsh-plugin/featherhunter-plugin-manage
> 定稿：8 张，顺序已写入插件仓 `screenshots.json`（待 push）。

## 一、上限：1–8 张

- awesome 规定 1–8 张，声明在**你自己仓库** `package.json` 旁的 `screenshots.json`。来源：`awesome-dsh-plugin/contributing.md` “Screenshots / 截图”节。
- 校验在 `scripts/build-site.mjs`：键必须精确匹配条目 URL；值必须是 1–8 个字符串；绝对 URL 仅允许 GitHub 托管 https（raw.githubusercontent.com / user-images.githubusercontent.com / camo.githubusercontent.com / github.com）；相对路径不得以 `/` 开头、不得含 `..`。
- `scripts/probe-screenshots.mjs`：`MAX_SHOTS = 8`；按作者仓库 `HEAD` 解析相对路径；只把 404/410 判死并从发布数据剔除，未探明视为存活。
- 不声明则回退：市场从 README 抽图，且同样走 GitHub 托管白名单（徽章服务/CDN/个人域名被丢弃）。来源：contributing.md + `renderReadme` 的 `imgAllowed`。

## 二、定稿 8 张及顺序（用户确认：4→7→2→1→3→5→6→8）

| # | 路径 | 角色 |
|---|---|---|
| 1 | assets/readme/中文-深色-右侧面板-技能页面-列表.png | 库存先行 |
| 2 | assets/readme/中文-深色-右侧面板-技能页面-详情.png | 深度 |
| 3 | assets/readme/中文-深色-右侧面板-列表-Map详情.png | 决策地图 |
| 4 | assets/readme/中文-深色-右侧面板-列表-列表.png | 总览（原封面） |
| 5 | assets/readme/中文-深色-右侧面板-列表-ISSUE详情.png | 执行闭环 |
| 6 | assets/readme/中文-深色-工作区-多ISSUE并发.png | 规模 |
| 7 | assets/readme/中文-深色-胶囊状态栏-WorkRoute.png | 活证明 |
| 8 | assets/init/中文-深色-4-点击确认后-注入prompt.png | 上手 |

替换掉的两张：`胶囊状态栏-输入框区域.png`（52KB，脱离上下文最难懂）、`右侧面板-切换后端.png`（设置页，说服力弱）。
本地校验：8 文件全部存在；纯相对路径；无越界；数量 1–8 内 → PASS。

## 三、“只看到三张”的真实根因（重要，纠正早期推断）

早期推断“未上架”是**错的**——插件早已收录。实际链路：

1. **条目已收录**：`data/plugins/FeatherHunter__dsh-mattpocock-skills-deck.yml` 存在（category: skill）；market index 3552 条中包含该条目，`homepage` 指向 awesome 详情页。
2. **market index 不带截图字段**：`scripts/lib/market-index.mjs` 的 `buildMarketIndex({ entries, npmMap, locales, origin })` **不接收 screenshots**，源码完全不提 screenshot。线上 `https://awesome-dsh-plugin.com/index.json` 实测 **3552 条中 0 条**有 `screenshots` 字段。
3. **站点详情页也没图**：`https://awesome-dsh-plugin.com/p/FeatherHunter/dsh-mattpocock-skills-deck/` 实测 200 但 `<img>` 数为 0、不含 `中文-深色` 路径。
4. **作者侧声明本身是好的**：`raw.githubusercontent.com/FeatherHunter/dsh-mattpocock-skills-deck/HEAD/screenshots.json` 200，可正常返回；`probe-screenshots.mjs` 在 build-site.yml 中**每次构建都会跑**。
5. 所以市场侧无法读到作者的 8 张声明，只能走 README 回退抽取，白名单过滤后剩约 3 张 —— 这就是“只有三张”的直接原因。

结论：断点在 awesome 的**发布链路**（probe 结果未进入 market index / 详情页产物），不在本仓声明。可对照：`xiaoksio/dsh-solution-explorer`、`kendu76/dsh-music-player` 同样声明了 screenshots.json（HEAD 200），线上同样 0 图。

## 四、待办

- 插件仓 `screenshots.json` 已改为定稿顺序（未 commit / 未 push）；push 后 probe 才读到新顺序。
- 需要向上游确认：market index 何时补 `screenshots` 字段（否则换图对市场端无感）。
- 8 张全为中文深色，英文/浅色截图列为 V2。

## 五、市场端硬上限：6 张（2026-10-27 补）

dsh-market 实际发布包 `dshmarket@1.71.1` 源码证据：`src/client/market-data.ts:1131` `const MAX_SCREENSHOTS = 6`，渲染前 `.slice(0, MAX_SCREENSHOTS)`。awesome 允许 8 张，市场只渲染 6 张。

## 六、图片描述：全链路无字段（2026-10-27 补）

- awesome `screenshots.json`：只收路径字符串（三种形状均为数组），无 caption/alt 字段；`probe-screenshots.mjs` 只 `shots.push(s)`。
- `buildMarketIndex({entries, npmMap, locales, origin})` 不接收 screenshots。
- market `RegistryPlugin.screenshots?: string[]` 纯 URL 数组；灯箱渲染 `<img alt="">`，无图注。
- 结论：想给单张图配文字说明，当前无落点；只能把字画进图里，或推动上游加字段。

## 七、竖屏截图会被 README 回退路径丢弃（2026-10-27 补）

`previewDimensionScore()` 要求 `width>=280 && height>=150 && area>=48000 && 1.05<=ratio<=3.2`，竖屏返回 null。本仓 8 张里 6 张竖屏（ratio 0.58–0.72），只有 `胶囊状态栏-WorkRoute.png`（1677×592）和 `init/...注入prompt.png`（1204×783）是横向。catalog 声明路径只过 `gateScreenshot`（https + GitHub 托管 + 非 SVG），**不做尺寸过滤**。

## 八、最终交付：6 张已推送（2026-10-27）

- 提交：`02beca35` → `FeatherHunter/dsh-mattpocock-skills-deck` `main`（`459e15b3..02beca35`），只改 `screenshots.json` 一个文件。
- 远端验证：`raw.githubusercontent.com/.../HEAD/screenshots.json` 与 `/main/` 均返回 200 且为 6 张。
- 保留（按用户确认顺序前 6）：技能页面-列表 / 技能页面-详情 / 列表-Map详情 / 列表-列表 / 列表-ISSUE详情 / 工作区-多ISSUE并发。
- 砍掉：胶囊状态栏-WorkRoute、init 注入prompt（恰是两张横向图）。
- 操作方式：用独立 worktree（`D:\dsh-plugin\.tmp-shots6`，分支 `market/screenshots6`）提交推送，**没碰主仓工作区里其他会话未提交的 20+ 个文件**；完成后 worktree 已 remove + prune。


## 更正（2026-10-27 晚，实测推翻了上一版结论）

上一节「为何只见三张」的两个推测都不成立，实测结果如下：

1. **市场数据源是 `dsh-plugin-catalog/plugins.json`，不是 `index.json`。** `index.json` 是 format-1 索引，官方校验器明确「格式未定义的成员会被忽略丢弃」，本来就不带 screenshots——拿它下「catalog 没有截图」的结论是查错了文件。
2. **plugins.json 共 6896 条，其中 1541 条带 screenshots 字段。** 本项目条目 `FeatherHunter/dsh-mattpocock-skills-deck` 在其中，且带 **8 张截图**（= 推送前旧 screenshots.json 的内容：列表-列表 / 列表-Map详情 / 列表-ISSUE详情 / 技能页面-列表 / 胶囊-输入框区域 / 胶囊-WorkRoute / 右侧面板-切换后端 / init-4）。说明 author-declared 链路一直通。
3. **「只能看到三张」是卡片的设计上限，不是数据缺陷。** dshmarket 1.66.47 `client/client.js:7286`：`const CARD_SHOT_LIMIT = 3`，注释原文「The dialog shows every screenshot; a grid of cards pulling six full-size PNGs each is what makes the first paint crawl.」卡片最多 3 张缩略图；详情/灯箱 `client.js:7418` 用 `curated` 全量渲染，上限 `MAX_SCREENSHOTS = 6`（`client.js:2481`）。
4. **真正待办**：catalog 里仍是推送前的旧 8 张。awesome 的 `build-site.yml` 只让 nightly（`cron: '23 2 * * *'`，北京 10:23）跑 `PROBE_ALL` 并发布 catalog，push 构建不 probe。所以新 6 张要等下一轮 nightly 才会替换进 catalog。
5. 因此**不需要动 README**；README 回退只是 curated 为空时的兜底，本项目 curated 非空，兜底从来没被用过。
