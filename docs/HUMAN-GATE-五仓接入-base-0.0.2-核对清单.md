# HUMAN-GATE 核对清单：五仓接入 base 0.0.2（票 14）

> 本清单由代理准备，**证据必须由仓主在真机/真实页面上取得**；代理不自判通过。完成后把时间、群、结果/截图路径填进对应表格，并把「结论」节更新到本文件，再关闭票 14。

## 0. 范围与版本

- base 包：`dsh-featherhunter-plugin-base@0.0.2`（CDN 整卡图走 unpkg 精确版本路径；清单走 unpkg @latest）
- 接入提交：dsh-prompt `944905c`、deck `42280a82`、palette `862a4c2`、im-companion `76dd0f6`、ilife `d7cdda30`（均已推送到 GitHub 默认分支）
- 五个入口：prompt 设置面板；deck 设置页底部；palette 设置面板；im 详情面板尾部 `.af-contact`；ilife dsh-life-pack 总管页

## 1. 真机扫码（飞书 / QQ / 微信各一次）

| 项目 | 待记录 | 结果 |
| --- | --- | --- |
| 飞书群 | 时间 / 群名 / 扫码后是否有效 | 通过（owner 2026-11-01 确认「B 组没问题」） |
| QQ 群 | 时间 / 群名 / 扫码后是否有效 | 通过（owner 2026-11-01 确认「B 组没问题」） |
| 微信群 | 时间 / 群名 / 二维码是否在有效期内（周更图） | 通过（owner 2026-11-01 确认「B 组没问题」，新码 validUntil=2026-11-07） |
| 过期/失效表现 | 微信二维码过期时是否给出可读提示（而非白屏/坏图） | 已不适用（0.1.3 起微信内置基线码，0.1.5 弹窗三卡均为 data:image/png 内联码） |

截图建议放 `docs/human-gate/` 或直接贴 GitHub PR/issue 附件。

## 2. 真实浏览器 dialog 行为

打开任一仓的设置面板 → 联系入口 → 弹窗，逐项确认：

- [ ] 弹窗位于 top layer（不被宿主设置面板、下拉、toast 遮挡）
- [ ] 遮罩覆盖全屏，点击遮罩关闭
- [ ] Esc 关闭
- [ ] Tab 焦点困在弹窗内且循环；关闭后焦点回到触发按钮
- [ ] 深色 / 浅色主题下文字、卡片、二维码可读
- [ ] 窄屏（≤ 640px）降列且二维码不溢出
- [ ] 至少 2 个仓（建议 prompt + deck 或 ilife）各验一次，记录仓名与浏览器/版本

## 3. GitHub 页面观感（每仓四块）

逐仓打开仓库首页 README（中文）与 `docs/README.en.md`（英文）：

- [ ] 联系块：整卡图正常显示、无 404、卡片宽度不溢出
- [ ] 星图：暗/亮两种源都正常（或对应变体）、时间戳与数据日一致
- [ ] 致谢表：行数与数据文件一致、无空行渲染错误
- [ ] 作者其他插件：四行链接可点、与 base manifest 一致
- [ ] 文档站/Pages 如启用，四块同样正常

## 4. 中国大陆网络降级

在断掉 GitHub / npmjs / jsDelivr / unpkg 等外部网络的条件下（或代理规则全阻断）：

- [ ] 联系弹窗仍能打开并显示内置基线（bundled）二维码，不是空白/报错
- [ ] 弹窗内「打开 GitHub」类外链失败时不阻断主流程
- [ ] 卡片整图（README 用）失败时页面其余内容仍正常
- [ ] 至少一仓真实构建链吃下产物（palette mini-bundler 风险最高；ilife 走 tsc -b 已验证构建，剩余为页面行为）

## 5. 结论

- 待仓主填写：通过项 / 未通过项 / 待确认项（明确标注「待确认」而不是默认通过）
- 全部项确认后：把本文件结论更新，关闭票 14；规格收口由仓主在规格详情页点「完成」按钮做核对。
- **2026-11-01 14:12 状态**：代理自动化侧已补齐 C4/C6/E1/E2/E3（全部 PASS，见 §7.6），B 组 owner 已确认；仅剩 owner 的 C4/C6 主观观感一眼 + D 组 desktop profile 安装形态（需授权装五仓 npm 正式版并重启桌面应用）。这两项确认后即可关票。

## 6. 场景化走查（照着做；做完把结果填回 §1–§4）

> A / B / C 组零安装即可做；D 组需要先装本次构建产物；E 组需要临时断外部网络。

### A. GitHub 页面观感（约 5 分钟）

| # | 场景 | 怎么做 | 应看到 |
| --- | --- | --- | --- |
| A1 | 中文 README 四块 | 浏览器打开五仓主页（README 默认展示） | 联系整卡图 3 张（飞书 / QQ / 微信）正常显示；Star 历史图有数据；致谢表行数与数据一致；「作者的其他插件」四行可点 |
| A2 | 英文 README 四块 | prompt / deck / palette / im 打开 `docs/README.en.md`（deck 另看 `package/README.md`） | 与 A1 相同，文案为英文；ilife 无英文页，跳过 |
| A3 | 外链可用 | 点四块里任一 GitHub 链接 | 新标签打开对应仓，无 404 |

### B. 真机扫码（手机约 5 分钟）

| # | 场景 | 怎么做 | 应看到 |
| --- | --- | --- | --- |
| B1 | 飞书（永久码） | 手机扫 README 联系卡里的飞书码；或手机打开 `https://unpkg.com/dsh-featherhunter-plugin-base@0.0.2/data/img/card-feishu.png` 长按识别 | 进入「DSH 插件交流群」（组织：用户418832的组织） |
| B2 | QQ（新群） | 同上，扫 `card-qq.png`（群号 1020866453） | 能加群 / 进群 |
| B3 | 微信（**应已过期**） | 扫 `card-wechat-2026-10-23.png`；再看弹窗里的微信卡 | 微信码 `validUntil=2026-10-30` 已过期：弹窗显示「该二维码已过期，请点击下方链接获取最新群二维码」，不展示坏图；扫码不应成功 —— 要真正验微信群需先换新群码 |

### C. 真实浏览器 dialog 行为（约 10 分钟，零安装）

打开 `packages/base/demo/index.html`（Chrome / Edge 双击即可，file:// 可运行）：

- [ ] C1 点「打开弹窗（零参，用内置基线）」→ 弹窗浮在页面之上、有半透明遮罩、背后内容不可点
- [ ] C2 Esc 关闭；重开点遮罩关闭；重开点右上 ×；每次关闭后焦点回到触发按钮（Tab 观察焦点环）
- [ ] C3 弹窗打开时连按 Tab：焦点只在弹窗内循环，不跑到背后页面
- [ ] C4 窗口宽度拖到 ~1200 / ~600 / ~420：卡片从 3 列 → 2 列 → 1 列，无横向溢出
- [ ] C5 系统切深色 / 浅色（或 DevTools Rendering → prefers-color-scheme）：文字、卡片、二维码可读
- [ ] C6 点「切换语言：中文」：按钮与弹窗文案变英文；再点回中文
- [ ] C7 DevTools Network 勾 Offline 后刷新：仍能打开弹窗并显示飞书 + QQ 两个真码（包内置基线，不是空白）
- [ ] C8 微信卡显示过期降级（预期同 B3）
- [ ] C9 页面「作者的其他插件」：默认 4 行（不含 deck），showSelf 版 5 行；行序 prompt → palette → im → ilife → deck，点击新标签打开 GitHub

### D. 插件真实页面入口（需先装本次构建产物）

当前 DSH web profile 装的是旧发布版；装好五仓（或至少 1–2 仓）本次构建产物并重启后逐仓验：

- [ ] D1 deck：设置 → 插件 tab（order 40）→ MattSkills 面板底部 → 联系入口可点 → 弹窗；面板底部推荐卡四行
- [ ] D2 palette：设置 → 调色板 section 底部 → 联系入口 + 推荐卡
- [ ] D3 prompt：设置 → 提示词模板 section 底部 → 推荐卡四行（旧四行卡已删）
- [ ] D4 im：插件详情面板尾部「联系我们」一行 → 点开弹窗
- [ ] D5 ilife：爱生活总管页 → 推荐卡 / 入口
- [ ] D6 每仓只有一处入口、最多一处推荐卡；弹窗在宿主设置面板之上（top layer），Esc / 遮罩 / 焦点表现与 C 组一致

### E. 大陆网络降级（约 5 分钟）

- [ ] E1 断开 unpkg / GitHub / jsDelivr（代理规则全阻断或 hosts）后刷新，再开弹窗：仍显示内置基线飞书 + QQ 码
- [ ] E2 弹窗里外链 / 整卡图失败时：不弹错误框、不白屏，主流程可用
- [ ] E3 恢复网络后刷新：回源清单更新，微信群卡仍按 `validUntil` 判断

> 做完按 §1–§4 的表格填结果，或把结论发给代理回填；**未验的项标「待确认」，不得默认通过**。

## 7. 2026-11-01 更新：0.1.5 收口状态（代理实测 vs 待仓主）

> 本清单写于 base 0.0.2 时期；此后已发布到 **0.1.5**，五仓换代并装入 web profile 由 owner 人眼验收（2026-11-01 00:44 owner 确认「我目前看到的效果都满意」）。以下为按最新形态重算的覆盖状态。

### 7.1 代理已实测、可作证据（web profile 0.1.5 真机 CDP，1416×845）

- 五仓设置分区（提示词模板 / MattSkills / OpenCode调色板 / 爱生活 / IM机器人增强）各 1 个 `.dsh-base-cluster`（92×28、gap 4、透明底、0 边框、role=group、aria-label=快捷操作）+ 3 枚 28×28 彩色图标按钮；旧 `.dsh-base-actions--group` 命中 0；面板底部联系整行命中 0（按 owner 拍板：只保留页头图标）。
- 三钮气泡文案：联系我们「扫码加入交流群，反馈、建议、idea 都欢迎🎉」/ Star「您的🌟是我夜空中最亮的星🌹」/ Issue「任何功能需求、故障、建议、意见都可以提ISSUE问题单🙏」；同屏 1 枚、opacity 1。
- 落点：联系我们开弹窗；Star → 各仓首页；Issue → 各仓 `/issues` 列表。
- 作者插件卡 4 行，悬停出 1 枚 role=tooltip 完整介绍词（aria-describedby 指向气泡）——覆盖旧 §6 C9 的「行可点 + 卡片数据一致」与新增 tooltip 行为。
- 联系弹窗（覆盖旧 §6 C1/C2/C3/C5 的代理可验部分）：3 卡 data:image/png、natural 320×320、显示 215×215、左右留白 13/13px；Esc 关闭且焦点回触发按钮；Tab×4 焦点困在 dialog；初始焦点为关闭按钮；深色 `prefers-color-scheme:dark` 下可读；窄 viewport 1000/900 无横向溢出（旧 §6 C4 的列数变化属更窄宽度，代理未在 420px 档复测）。
- base demo 0.1.5 五状态 computed 值：默认 `::before opacity 0`；is-hover .85；is-active `matrix(.88,…,1)` + .95；is-focus `outline 2px solid rgb(77,107,254)` offset 2；disabled `opacity .38 + grayscale(1) saturate(.25)`；`prefers-reduced-motion` 规则在 `packages/base/src/client/styles.ts:105`（覆盖旧 §6 C5/C6 的组件侧证据）。
- 截图：`.tmp/web4-author-tip.png`、`web4-header-tip.png`、`web4-modal.png`、`web4-dark.png`、`demo015-part0.png`、`demo015-part1.png`。

### 7.2 待仓主亲验（代理不可代劳）

- ~~**B 组**~~：2026-11-01 owner 确认「B 组没问题」→ 已通过（见 §1 与票 14 记录）。
- **C4 更窄档**：~~420px 左右单元格换行表现（代理只验到 900/1000 无溢出）~~ → **代理已自动化实测 PASS**（1200/600/420 三档列数 3/2/1、无横向溢出、无越界元素，见 §7.6）；仅剩主观观感待 owner 一眼。
- **C6 语言切换**：~~中英切换在真实浏览器（demo 与插件面板内）的观感~~ → **demo 页中英切换已自动化实测 PASS**（文案/aria/弹窗全量切换并可复原，见 §7.6）；插件面板内英文需切 DSH UI 语言，组件双语已覆盖；观感待 owner 一眼。
- **D 组**：~~desktop profile 安装形态（原 registry 旧版 0.4.39 / 2.1.10 / 0.3.85 / beta.32 / 0.2.25）~~ → **已通过（2026-11-01 15:27，owner 安装五仓 npm 正式版并重启桌面应用；16:42 反馈「现在都重启了，暂时没看到什么问题」）**：desktop profile 五仓全部为 npm 正式版（prompt 0.4.40 / deck 1.9.0-beta.33 / palette 2.1.11 / im 0.2.26 / life-pack 0.3.86），真实目录无软链，运行日志正常；证据见 §7.7。入口观感以 owner 本次反馈为准。
- **E 组**：~~断 unpkg / GitHub / jsDelivr 后的降级行为（E1 内置基线码仍可开、E2 失败不白屏、E3 恢复后回源）~~ → **代理已自动化实测 PASS**：E1 三通道全失败仍显示 3 个内置真码、无白屏/错误框；E2 合成清单验证「远程图失败回退内置码 / 过期卡降级 link / 无内置码降级 link」三链路且不弹错；E3 恢复后 unpkg 清单 200 + 3 张远程图 200（回源成立），见 §7.6。

### 7.3 旧条目过期说明

- §0 版本与提交为 0.0.2 时期快照，最新为 base 0.1.5 + 五仓 0.1.5（commits 见规格 `.scratch/header-action-cluster-v2/spec.md` 验收记录）。
- §6 D1–D5 的「面板底部联系入口 + 推荐卡」形态已被 owner 拍板取代：只保留页头三枚图标入口，底部联系整行已从五仓移除（base 的 ContactRow 组件保留给其他使用者）。
- §6 B3 的过期降级已不再适用（微信码已换新并内置基线码，0.1.3 起离线也有码）。

### 7.4 发版链路（2026-11-01 01:2x）

- **dsh-prompt 0.4.40 已正式发布到 npm**（GitHub Actions run [41223953408](https://github.com/FeatherHunter/dsh-prompt/actions/runs/41223953408) success；commit `ae7c6b5`）：npmmirror `latest=0.4.40`、jsDelivr `@0.4.40` 200、`npm install dsh-prompt@0.4.40` 实测可装，包内内联 base v0.1.5（彩色快捷操作簇 + 作者插件卡 tooltip + 二维码居中）。
- 用途：若要做 **D 组正式版安装形态**（而非 file: tarball 临时验证），可用带版本号的正式包：`dsh plugin --profile <profile> add dsh-prompt@0.4.40`；本机 npmjs TLS 受限时需该 profile 的 `.npmrc` 指向 `https://registry.npmmirror.com/`（web profile 已如此配置）。**2026-11-01 12:16 起五仓均已发版**：dsh-prompt 0.4.40、dsh-mattpocock-skills-deck 1.9.0-beta.33、dsh-opencode-palette 2.1.11、dsh-im-companion 0.2.26、ilife 0.3.86（七包），详见 §7.5。
- **发版口径**：dsh-prompt 的「发版」现在是 **npm publish + GitHub Release 一步完成**（`publish.yml` 的 `Create GitHub release` 步骤，按 CHANGELOG 版本段写 notes、附两个 tarball 资产、设为 Latest；publish 步骤幂等）。v0.4.40 release 已补齐并设为 Latest：https://github.com/FeatherHunter/dsh-prompt/releases/tag/v0.4.40 。

### 7.5 web profile 已切 npm 正式版（2026-11-01 12:40，票 09）

- **五仓 npm 最新版**：dsh-prompt `0.4.40`、dsh-mattpocock-skills-deck `1.9.0-beta.33`（dist-tags beta+latest）、dsh-opencode-palette `2.1.11`、dsh-im-companion `0.2.26`、ilife `0.3.86`（dsh-life-pack + 六单品）。deck 与 im 是本次补发（此前 npm 停在 beta.32 / 0.2.25，不含 base 0.1.5 UI）。
- **web profile 现状态**：`~/.dsh/profiles/web/package.json` dependencies 全是版本号，**无任何 `file:` 依赖**（pnpm-lock 同）；bundles 8 个。安装方式 `dsh plugin --profile web add --save-exact <五个版本> --registry=https://registry.npmmirror.com/`；装前备份 `D:/temp/hac2-pack/web-profile-backup-20261101-1215`。
- **复验（重启 127.0.0.1:3080 后 CDP）**：五插件设置页版本文案 = npm 版本；每页 1 个 `.dsh-base-cluster` + 3 钮；作者插件卡 tooltip 正常；联系弹窗三卡二维码 natural 320×320、box-sizing=border-box。截图 `.tmp/web5-*.png`。
- **对 D 组的影响**：web profile 不再是 file: tarball 形态；desktop profile 仍是 registry 旧版，若 owner 要做 D 组真机目验，把五个版本装进 desktop profile 并重启桌面应用即可（同样是 npm 包，可回滚）。

### 7.6 代理自动化实测补齐 C4/C6/E（2026-11-01 14:0x，CDP 网络级模拟）

> 依据 owner 2026-11-01 指示「你能自动化测试的 可以直接测试」。以下由代理用无头 Chrome（CDP）在真实页面执行，属**自动化实测证据**，不能替代 owner 对观感的主观确认；D 组安装形态已由 owner 于 15:27 完成并核验（见 §7.7）。

**环境**
- Chrome 156 headless，CDP 9333；web profile 页面 http://127.0.0.1:3080/（五仓 npm 正式版：prompt 0.4.40 / deck 1.9.0-beta.33 / palette 2.1.11 / im 0.2.26 / ilife 0.3.86，内联 base 0.1.5）；base demo 0.1.5 由静态服务器 http://127.0.0.1:8899/demo/index.html 提供（`packages/base/demo/` + `dist/demo.js`）。
- 驱动脚本 `.tmp/hg-cdp.mjs`（CDP WebSocket 直连；plan 支持 viewport/navigate/reload/offline/block/unblock/preload/intercept/eval/shot/key；输出 NETREQ/NETFAIL/LOGS）；plan 与日志在 `.tmp/hg-plan-*.json`、`.tmp/hg-*.log`。
- 降级用 CDP `Network.setBlockedURLs`（按 URL 全阻断）与 `Network.emulateNetworkConditions offline` 实现，等价于「大陆网络三通道全失败」；弹窗路径固定为：账号菜单 → 设置 → MattSkills → 联系我们。

**C4 窄档列数（PASS，demo + web 两处）**

| 视口 | 列数 | 布局 | 横向溢出 |
| --- | --- | --- | --- |
| 1200×900 | 3 | 1 行（卡宽 241px，弹窗 800×505 / 800×438） | `docScrollWidth==viewportWidth`，grid/dialog `scrollWidth-clientWidth=0` |
| 600×900 | 2 | 2 行（弹窗 552×869 / 552×792） | 同上 0 |
| 420×900 | 1 | 3 行（卡宽 338px，弹窗 386×880 / 386×792，body 内部滚动 clientH 620 / scrollH 1296） | 同上 0 |

- 420px 档无横向溢出、无越界元素（逐元素 `getBoundingClientRect` 检查）；二维码 `data:image/png` natural 320×320，显示 215/219/312px 未破图。
- 截图：`.tmp/hg-c4-1200.png`、`hg-c4-600.png`、`hg-c4-420.png`（demo）；`.tmp/hg-web-1200.png`、`hg-web-600.png`、`hg-web-420.png`（web profile）。
- 覆盖 §7.2「C4 更窄档」与旧 §6 C4 列数项；**卡片间距/留白是否舒服这类观感仍建议 owner 一眼**。

**C6 中英切换（PASS，demo 页；面板内英文依赖宿主语言设置）**
- demo 点「切换语言」→ 按钮文案「切换语言：English」，cluster aria-label 变 Contact us / Star this project / Open an issue / More actions，插件卡标题 More plugins by the author，弹窗标题 Feedback and Contact、scanHint「Scan the QR code to join us」、close aria「Close」、卡片标题/副标题/note 全英文（含 wechat「Valid for 6 days (until 11/7)…」）；再点回中文全部复原（反馈与联系 / 扫描二维码加入我们 / 关闭 / 群号：1020866453 / 作者的其他插件）。
- 截图：`.tmp/hg-c6-en-modal.png`、`hg-c6-zh-modal.png`。
- 插件面板内语言由宿主 `lang` 传入（五仓 createBaseUI 显式传 lang），验面板英文需切 DSH UI 语言；组件侧双语渲染已由 demo 覆盖。

**C7 附加：demo 离线（PASS，仅作辅助）**
- `Network.emulateNetworkConditions offline` 后 reload，demo 页面正常渲染（16 个 cluster、弹窗可开、3 卡 img complete、note 正常、无异常）；在线/离线截图 `.tmp/hg-c7-online.png`、`hg-c7-offline.png`。
- 注意 demo 传了 `resolveQr:()=>DEMO_QR` 占位码，**不能作为「内置真码」证据**；真码证据见 E1。

**E1 断 CDN（PASS，web profile 真实页面）**
- `Network.setBlockedURLs` 阻断 `*unpkg.com*`/`*cdn.jsdelivr.net*`/`*registry.npmmirror.com*`/`*github.com*` 后 reload：页面正常（title=DeepSeek Harness、账号菜单在、body 正常渲染），设置→MattSkills→联系我们弹窗可开。
- 页内 fetch 记录：三个清单通道全部 `TypeError: Failed to fetch`（6/1/2ms）→ loader 返回 null → 采用内置基线；弹窗 3 卡 feishu/qq/wechat、标题「DSH 插件交流群」、note 分别为「该二维码永久有效」「扫一扫二维码，加入群聊」「该二维码 6 天内（11 月 7 日前）有效，重新进入将更新」，无 fallback link，`errText=[]`、`window.__errs=[]`、gridOverflow=0；截图中 3 个内置二维码正常渲染，无白屏、无错误框。
- 截图：`.tmp/hg-e1-blocked2.png`（1200×900，151516B）；日志 `.tmp/hg-e1.log`。
- 测量瑕疵说明：弹窗打开 2.5s 时读 `img.naturalWidth` 仍为 0×0（同一代码在 E3 3s 后读到 320×320），属测量时机，截图已证渲染。

**E3 恢复回源（PASS，web profile 真实页面）**
- 解除阻断 + reload + 重开弹窗：页内 fetch 记录 `unpkg .../data/manifest.json` **200（992ms）**；随后远程图 `cdn.jsdelivr.net/.../data/img/qr-feishu.png`、`qr-wechat-2026-10-31.png`、`qr-qq.png` 全部 **200（1575–1657ms）**——基线走 bundled 不会请求这三张图，故证明远程清单被采用并预取了远程图；弹窗 3 卡 img 均 `320x320/true`（src=data:image/png）、note 文案同基线、`errs=[]`、gridOverflow=0；CDP NETREQ 记录到同样 4 条 200。
- 截图：`.tmp/hg-e3-restored2.png`；日志 `.tmp/hg-e3.log`。

**E2 合成降级清单（PASS，web profile 真实页面）**
- 做法：CDP Fetch 拦截 `*unpkg.com*` 返回自造 manifest（schema 1 / version 0.1.5 / revision 99 / fallbackUrl=GitHub issues；groups= feishu remote 图、wechat remote 图 + `validUntil=2026-10-30`（已过期）、telegram remote 图（无内置码）），同时阻断 jsdelivr+npmmirror 让远程图必失败。
- 结果：拦截 200（6ms）后清单被采用（卡片标题变为自造「【远程清单】…」），三卡降级链全部符合预期：
  - feishu：远程图失败 → 回退内置 `qr-feishu`，img 320×320/true；
  - wechat：`validUntil` 过期 → `card--expired`、无 QR、note「该二维码已过期，请点击下方链接获取最新群码」、link=fallbackUrl；
  - telegram：远程图失败且无内置码 → 无 QR、link 卡片；
  - 全程 `errText=[]`、`window.__errs=[]`、gridOverflow=0、cols=3、页面 bodyLen 正常——**不弹错误框、不白屏**。
- 截图：`.tmp/hg-e2-degraded2.png`（105888B）；日志 `.tmp/hg-e2b.log`；plan `.tmp/hg-plan-e2b.json`。
- 附注：首轮自造 manifest 把 `card` 写成 `"feishu"`（校验要求 png/jpg 文件名，见 `dsh-prompt/lib/client.js:7947`），被拒后 loader 继续走 npmmirror/jsdelivr 通道并最终回落基线——这本身验证了「非法清单不会弄坏页面」；改 `card:"card-feishu.png"` 后即通过。

**结论**
- 代理自动化侧：C4、C6、C7（辅助）、E1、E2、E3 全部 PASS，证据如上；§7.2 中 C4/C6/E 的「代理不可代劳」部分已由自动化实测覆盖。
- 仍待 owner：C4/C6 的**主观观感**（一眼舒服即可）；D 组 desktop profile 安装形态已由 owner 完成并核验（见 §7.7）；B 组 owner 已确认。
- 复跑命令：`node .tmp/hg-cdp.mjs .tmp/hg-plan-e2b.json`（其余 plan 同名规律：`hg-plan-demo-c4.json` / `hg-plan-demo-c6.json` / `hg-plan-demo-c7.json` / `hg-plan-web-c4.json` / `hg-plan-e1.json` / `hg-plan-e3.json`）。

### 7.7 D 组 desktop profile 安装形态（2026-11-01 15:27，owner 操作 + 代理核验）

- **owner 动作**：2026-11-01 15:27 前后在 DSH Desktop 里把五仓插件装/更到 npm 正式版，随后重启桌面应用；16:42 反馈「现在都重启了，暂时没看到什么问题」。
- **代理核验（2026-11-01 16:4x，重启后）**：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\package.json` dependencies 五仓均为 npm 精确版本，node_modules 实际版本一致且全部为真实目录（无 Junction）：

| 插件 | declared | actual | link |
| --- | --- | --- | --- |
| dsh-prompt | 0.4.40 | 0.4.40 | 无 |
| dsh-mattpocock-skills-deck | 1.9.0-beta.33 | 1.9.0-beta.33 | 无 |
| dsh-opencode-palette | 2.1.11 | 2.1.11 | 无 |
| dsh-im-companion | 0.2.26 | 0.2.26 | 无 |
| dsh-life-pack | 0.3.86 | 0.3.86 | 无 |

- **运行证据**：`.dsh-market\log.ndjson` 07:27:11Z「install dsh-mattpocock-skills-deck: pinned to the registry's latest, 1.9.0-beta.33, so pnpm's fresh-release hold cannot substitute an older version silently」→ 07:27:19Z「the host's own replay activated it; adopted instead of mounting a second copy (#814, #827)」+「dsh-mattpocock-skills-deck@1.9.0-beta.33 exit=0 hot=true」；`~/.dsh/logs/dsh-im-companion/2026-11-01.log` 持续 config.io load ok（读回 18 家 / 8 助理，至 16:43 仍活跃）→ 官方包已加载运行。
- **附带修复**：此前 desktop 的 dsh-im-companion 是 Junction 指向本地仓（本地 0.2.26 vs 声明 0.2.25），pnpm 在 Windows 上 rename junction 报 `ERR_PNPM_EPERM`；15:18 已由代理改为 registry 0.2.26（真实目录，lock integrity 与 npm 一致，备份 `.tmp-backup-im-official-20261101-1518`），重启后运行正常。
- **结论**：D 组安装形态通过；「插件详情面板 / 总管页」入口观感以 owner 本次「没看到什么问题」反馈为准。回滚方式：按备份或按版本号重装即可（npm 包可随时降级）。

