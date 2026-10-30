# base 包与联系弹窗：方案笔记（v2，2026-10-30 拍板后）

> 规格票：`.scratch/base-package/spec.md`（deck issue 00）。本笔记是背景与决策记录，冲突时以规格票为准。
> 对抗式审查证据：`docs/base包-对抗式审查.md`（第一轮 F1~F16；第三轮 §8 追加 F17~F30，含 README 四块实测与发布链可验证性），规格票 00 已按此修订到 383 行；本笔记 §5/§9/§13 待票定稿后同步。

## 0 一句话

把「联系弹窗 / 作者插件推荐卡 / README 联系区·星图区·致谢区·作者其他插件区」从 N 份复制品，收敛成 **一个 npm 包（通用件 + 渲染器）+ 一份数据 + 一条 npm CDN 分发通道**；五个插件仓库本次零改动，只按交接文档接入。

## 1 为什么这样切（第一性原理）

| 事实 | 推导 |
| --- | --- |
| 五仓 client 各自打包、互不共享运行时 | 复用只能靠 npm 包 + 编译期内联，不能靠运行时互引 |
| 插件产物是单文件 bundle（esbuild/tsdown/mini-bundler/tsc-b 四套） | 包产物必须单文件、零 import、无动态 import、无 TLA |
| 宿主 React 18.3 与 19.x 并存 | 包不能 import React，调用方注入 |
| 图片只能进 data URI 或宿主静态路由，五仓无 assets 通道 | 图片走 npm CDN 精确版本 URL（README）+ 内联基线（弹窗兜底） |
| 微码 7 天过期，但包版本升级要五仓各自发版 | 数据必须与代码版本解耦：发数据版本、不发代码；正确性靠 validUntil 校验 |
| 推荐文案里的数字多处不一致且会过期 | 文案禁写数字的建议**被仓主 2026-10-30 推翻**：允许写数字，但每条带 `verifiedAt`，`doctor` 超 90 天未核对就提醒；改文案只发数据版本 |
| 五仓已有 star-history / thanks 两个每日定时 workflow | 不再新增定时任务（README 竞争提交 + GitHub 60 天不活动自动禁用） |
| 设置页内容列是滚动容器、遮罩 z-index 1000 | 弹层必须用 `<dialog>.showModal()`（top layer），absolute/portal+z-index 不可靠 |

## 2 决策记录

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| D1 | 数据放哪 | 唯一真源在 manage 仓 `contact/`，随 npm 包发布为 `data/` |
| D2 | 仓库 | 代码放本工作区（manage 仓），不新建仓库 |
| D3 | 范围 | 一次性做完：联系弹窗 + 四块 README + 推荐卡 |
| D4 | 入口 | SVG 图标按钮，点击打开弹窗 |
| P-A | 分发通道 | **npm CDN**：清单 unpkg @latest，图片 jsDelivr 精确版本，npmmirror 兜底 |
| P-B | v1 范围 | 四块全做：联系 / 星图 / 致谢 / 作者其他插件 |
| P-C | 弹窗列数 | 4 列，窄屏降 2 列、1 列 |
| P-D | ilife 入口 | 只在 dsh-life-pack 总管页 1 处，子品页不改 |
| P-E | 推荐位形态 | 一物两版：设置面板控件 + README 中英两版 |
| P-F | 硬约束 | 不修改另外五个仓库的任何代码与 README |
| T1 | 包形态 | 单包三入口 `./core` `./client` `./node`，纯 ESM，零运行时依赖 |
| T2 | React | 不 import，`createBaseUI(React)` 工厂注入；peer `^18 || ^19` |
| T3 | 弹层 | 原生 `<dialog>.showModal()` |
| T4 | 视觉 | 沿用 README 排版语言；颜色走宿主主题令牌 + 内置回退 |
| T5 | 文案 | 内置 zh/en，语言回退链 显式 > html[lang] > navigator > zh |
| T6 | 图片 | 弹窗用裁图 320px/16 色；README 用整卡 260 宽；内置基线只放飞书 + QQ |
| T7 | 有效性 | `validUntil` 过期即降级为链接，绝不展示过期码 |
| T8 | 测试 | vitest + jsdom；README 四块用现状快照做语义等价回归 |

## 3 数据与发布物

```
contact/                  # 人维护（manage 仓）
  groups.json             # 群组清单
  plugins.json            # 作者插件清单（5 项，禁数字文案）
  src/                    # 整卡截图 + 二维码原图 + crops.json
packages/base/
  src/core/ src/client/ src/node/
  data/manifest.json      # 发布物：{schema, version, revision, updatedAt, fallbackUrl, groups, plugins}
  data/img/               # 发布物：card-*.png（260）、qr-*.png（320/16 色）
```

规则：清单全量（可增删换序）；空数组视为非法回退基线；单群过期只降级该卡；文件名带日期保证 CDN 缓存不串图；作者插件清单 5 项、每渲染面排除自己。

群组数据一份、两个出口：README 版用 `readmeTitle` + `alt` + `card`（260 宽整卡，表格结构与现状逐字接近，ilife 用 `## 反馈与联系` 变体），弹窗版用 `title` + `subtitle` + `note` + 裁图 + `validUntil` 角注（见规格 §2 规则 9）。

作者插件清单的文案已由仓主于 2026-10-30 逐字定稿，落在 `contact/plugins.json`（顺序 deck → prompt → palette → im → ilife，每条 `order` + `verifiedAt`）。ilife 的「⚠️建设中⚠️」写在文案本身，所以设置面板卡与 README 中英两版显示完全一致。

## 4 图片与体积实测

| 图片 | 原始 | 320px 16 色 | 备注 |
| --- | --- | --- | --- |
| 飞书码裁图 | 25.9KB | 13.4KB | 可解，安全 |
| QQ 码裁图 | 61.1KB | 23.1KB | 4 色会发白，必须 16 色 |
| 微信码裁图 | 39.1KB | 16.9KB | 圆点 + 中心 logo |

内置基线只放飞书 + QQ ≈ 49KB base64；三码全内置 ≈ 71KB。裁图白边需外扩到 ≥4 模块。

## 5 分发通道与新鲜度（P-A）

- 清单：`https://unpkg.com/dsh-featherhunter-plugin-base@latest/data/manifest.json`（60s 缓存）→ npmmirror（先取 latest 版本）→ jsDelivr @latest。
- 图片：`https://cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base@<version>/data/img/<path>`（immutable）；失败换 npmmirror。
- 弹窗流程：内置基线首帧渲染 → 并行 fetch（1500ms 超时、不重试）→ 校验 → 整体替换 → 关闭销毁；模块内缓存 30 分钟；`preloadContent()` 预热。
- 微码周更：新图 → `contact:update`（结构校验 + 落盘 + 更新清单 + 清旧图 + 打印 diff）→ `npm version patch && npm publish`（1~10 分钟到 unpkg）。
- 不做运行时远程加载代码 / 远程 HTML。

## 6 包结构与 API

```ts
import { createBaseUI } from 'dsh-featherhunter-plugin-base/client'
const base = createBaseUI(React, { lang: "zh", selfId: "deck" })
// base.ContactButton / base.ContactRow / base.AuthorPlugins
// base.openContactModal(opts?) / base.closeContactModal() / base.preloadContent()
```

- `./core`：`normalizeManifest` / `mergeContent` / `pickLang` / `formatValidity` / `texts`。
- `./node`：`renderContactBlock` / `renderStarHistoryBlock` / `renderThanksBlock` / `renderMoreBlock` / `verifyBlock` + CLI（`readme:init` / `readme:sync [--check] [--all]` / `contact:update` / `doctor`）。
- 产物单文件 ESM、零 import；client 样式一次性注入 `dsh-base-ui-style` 一段 `<style>`，类名前缀 `dsh-base-`。

## 7 设置面板三件套

- `ContactButton`：16px 线框 SVG、`currentColor`、aria-label + title；hover 用主题令牌提亮；尺寸可传。
- `ContactRow`：整行动作版（图标 + 文字 + 右侧箭头），给放不下图标按钮的面板。
- `AuthorPlugins`：卡片 = 1px border + 圆角 10 + 内边距 12/14 + 标题行（2x2 宫格图标 + 13px 600）+ 4~5 行（monospace 包名 12/650 + 描述 12 secondary + 外链图标 14）；整行 `<a target="_blank">`；数据来自 manifest.plugins（文案为 2026-10-30 定稿，见 `contact/plugins.json`）并排除 selfId；纯展示不发请求。

## 8 联系弹窗

- `<dialog>.showModal()`；标题区（CONNECT / 反馈与联系 + 关闭 x）→ 欢迎语 → 4 列群卡 → 底部「扫描二维码加入我们」提示。
- 群卡：标题 / 副行 / 二维码（白底、pixelated、≥150px）/ 角注；过期卡换成兜底链接。
- Esc、点遮罩关闭；焦点回归触发按钮；锁 body 滚动；`role=dialog` + `aria-modal`。
- 手机端群号可点复制；不展示过期码；失败静默降级。

## 9 README 四块

| 块 | 标记 | 说明 |
| --- | --- | --- |
| 联系区 | `<!-- CONTACT-START/END -->` | 保持现状表格结构（CONNECT h2 或 ilife 的 `## 反馈与联系` + 欢迎语 + 三列 260 宽整卡），图片指向 npm CDN 精确版本；副行/角注只进弹窗 |
| 星图区 | `<!-- STAR-START/END -->` | `<picture>` 深浅双图 + `?v=YYYYMMDDHHmm`；ilife 补 |
| 致谢区 | 沿用 `<!-- THANKS-TABLE-*-START/END -->` | 表结构不变，纯函数生成 |
| 作者其他插件区 | `<!-- MORE-START/END -->` | `<h2><sub>MORE</sub><br>作者的其他作品</h2>` + 引导句 + 4 行（顺序 deck → prompt → palette → im → ilife，文案与设置面板同源）；ilife 补；每仓排除自己 |

目标文件 11 个（5 仓 × 中文/package/en 变体，ilife 仅中文）。

## 10 同步与发布

- 主路径：本地 `npx ... readme:sync --all --repos <目录>`；`--check` 作 CI 门禁。
- 次路径：在五仓**已有**的 thanks/star workflow 里加一步，不新增 workflow/schedule。
- `doctor`：一条命令报告依赖版本、内联产物版本、四块是否与清单一致。
- base 发版：test → build → data → 版本 → npm publish。
- 发布凭据：仓主已给 npm token（npm 用户 `feather_wch`，包名探测 404 可用）；token 只存本机 `.local/npm-token.txt`（`.gitignore` 已忽略），不入库、不写进任何文档，发布时从该文件读。

## 11 五仓接入边界（本次不改它们）

| 仓 | 设置面板接入点 | 备注 |
| --- | --- | --- |
| deck | settings.section（自研 esbuild 内联拼接） | 替换 MORE_PLUGINS 与 word.yaml 文案 |
| palette | tab order30 + section order16（自研 mini-bundler，需登记依赖） | 删 authorPlugins 3 行与 i18n |
| prompt | settings.section order50（tsdown） | 删 settings-links.ts 推荐卡 |
| im | 仅 settings.section order22（tsdown） | 删自绘二维码弹窗 connect-flow.ts，改调 base |
| ilife | 仅 dsh-life-pack 总管页 1 处（tsc -b） | 子品页不改 |

## 12 交接文档

1. `docs/handover/01-接入联系弹窗与推荐卡.md`
2. `docs/handover/02-README四块迁移.md`
3. `docs/handover/03-CI与发布.md`

## 13 验收

- 包能构建、三入口可 import、测试全绿；demo 页四列群卡 + 推荐卡可见。
- 断网仍有飞书/QQ；过期群只剩链接；空清单回退基线；`readme:sync --check` 在 11 个文件上通过。
- 二进制快照：README 四块与现状语义等价。
- 交接文档步骤可在任一仓独立完成接入。

## 14 非目标

- 不改五仓代码与 README（只出文档）。
- 不做安装检测 / 一键安装 / 运行时远程代码 / 在线生成二维码 / 点击放大整卡。
- 不新增定时 workflow、不用 PAT。

## 15 历史与证据

- 首版方案（GitHub raw + 每仓定时 workflow + jsQR 门禁）已被对抗式审查推翻，见 `docs/base包-对抗式审查.md`。
- 关键外部事实：GitHub 官方文档「公开仓库 60 天无活动，scheduled workflow 自动禁用」；UNPKG/jsDelivr/npmmirror 缓存行为实测；OpenCV/jsQR 对 QQ/微信码解码失败实测。

## 16 实施票（2026-10-30 批准后建票）

拍板补充（2026-10-30 用户确认，均按推荐）：**D-a** 「4 列」按上限解释，列数 = min(群组数, 4)；**D-b** deck 英文页的 `dsh-chinese-skill-patch` 行移除；**D-c** README 验收改「内容等价 + 保留各仓功能元素」；**D-d** ilife 在现有 CI 文件里加定时（不新增 workflow 文件），否则接受随发版滞后。

| # | 实施票 | 阻塞 | 交付的垂直能力 |
|---|---|---|---|
| 01 | 包骨架与三入口契约 | — | 可发布包、产物契约、demo 壳 |
| 02 | 首次真实发布与三通道冒烟 | 01 | 真发 0.0.1，三 CDN 实测 |
| 03 | 群组数据链与内置基线 | 01 | 一份数据 → 清单 + 图 + 内置基线 + 更新命令 |
| 04 | 联系弹窗 | 03 | 按钮 + 弹窗（离线可用） |
| 05 | 远程清单与换码演练 | 02, 04 | 远端清单、降级、真实换码 |
| 06 | 作者插件卡 | 03 | 面板推荐卡 |
| 07 | README 现状 fixture 与等价口径 | 01 | 11 文件四块基准 + 内容等价判定 |
| 08 | README 联系区渲染与同步 | 03, 07 | 联系区 init/sync/check |
| 09 | README 作者作品区渲染与同步 | 06, 08 | MORE 区渲染与同步 |
| 10 | README 星图区与致谢区渲染 | 07, 08 | 星图 / 致谢渲染 |
| 11 | 全量同步门禁与 doctor | 09, 10 | --all / --check / doctor |
| 12 | 周更发布流水线与发布演练 | 05, 11 | 换码一条命令 + 两次真实演练 + 旧脚本退役 |
| 13 | 三份交接文档与最终验收走查 | 04, 06, 11, 12 | 交接文档 + HUMAN-GATE |

票文件在 `.scratch/base-package/issues/01..13`，父票为规格票 00。README 的实际落地仍由五仓主按交接文档执行，本仓不含五仓代码改动。
