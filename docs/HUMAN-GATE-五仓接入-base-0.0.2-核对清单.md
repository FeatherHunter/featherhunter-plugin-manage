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
- **C4 更窄档**：420px 左右单元格换行表现（代理只验到 900/1000 无溢出）。
- **C6 语言切换**：中英切换在真实浏览器（demo 与插件面板内）的观感。
- **D 组（已按新形态改写）**：五仓插件要装进 **desktop profile** 才有「插件详情面板 / 总管页」真机入口；当前只验了 web profile 设置分区。**性质为临时验证**：装的是本地 tarball（file: 依赖），不改包版本、不需要发版；验完可按备份回滚。desktop profile 正是当前 DSH Desktop 会话所在 profile，安装后需重启桌面应用，须 owner 授权/操作。
- **E 组**：断 unpkg / GitHub / jsDelivr 后的降级行为（E1 内置基线码仍可开、E2 失败不白屏、E3 恢复后回源）。

### 7.3 旧条目过期说明

- §0 版本与提交为 0.0.2 时期快照，最新为 base 0.1.5 + 五仓 0.1.5（commits 见规格 `.scratch/header-action-cluster-v2/spec.md` 验收记录）。
- §6 D1–D5 的「面板底部联系入口 + 推荐卡」形态已被 owner 拍板取代：只保留页头三枚图标入口，底部联系整行已从五仓移除（base 的 ContactRow 组件保留给其他使用者）。
- §6 B3 的过期降级已不再适用（微信码已换新并内置基线码，0.1.3 起离线也有码）。

### 7.4 发版链路（2026-11-01 01:2x）

- **dsh-prompt 0.4.40 已正式发布到 npm**（GitHub Actions run [41223953408](https://github.com/FeatherHunter/dsh-prompt/actions/runs/41223953408) success；commit `ae7c6b5`）：npmmirror `latest=0.4.40`、jsDelivr `@0.4.40` 200、`npm install dsh-prompt@0.4.40` 实测可装，包内内联 base v0.1.5（彩色快捷操作簇 + 作者插件卡 tooltip + 二维码居中）。
- 用途：若要做 **D 组正式版安装形态**（而非 file: tarball 临时验证），可用带版本号的正式包：`dsh plugin --profile <profile> add dsh-prompt@0.4.40`；本机 npmjs TLS 受限时需该 profile 的 `.npmrc` 指向 `https://registry.npmmirror.com/`（web profile 已如此配置）。其余四仓尚未发版。
