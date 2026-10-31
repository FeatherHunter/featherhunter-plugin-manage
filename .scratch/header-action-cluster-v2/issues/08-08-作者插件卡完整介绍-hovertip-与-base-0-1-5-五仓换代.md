<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: hac2-t8 -->
<!-- DSH-CREATED: 2026-10-31T16:14:39.829Z -->
# 08: 作者插件卡完整介绍 HoverTip 与 base 0.1.5 五仓换代

**What to build:** 让「作者的其他插件」每一行在鼠标悬停 / 键盘聚焦时，用 base 共用 HoverTip 弹出该插件的**完整介绍词**（行内描述被省略号截断，气泡是读全文案的唯一途径），同时把 owner 要求的两处文案改掉，发 base 0.1.5 并五仓换代重装验收。**已完成的 base 侧实现**（本轮已在工作区落地，待发布）：(1) packages/base/src/client/hover-tip.ts 抽出通用 `createTipController(options)` 与 `TipController{show,hideSoon,hideNow,dispose}`（160ms 离开延迟、Escape 立即隐藏、aria-describedby 指向气泡、document.body 挂载、同屏仅一枚），cluster.ts 改用同一控制器（删除本地重复实现约 85 行）；(2) packages/base/src/client/plugins.ts 的 `renderAuthorPlugins` 增加 `tip?: TipController` 选项，把 onMouseEnter/onMouseLeave/onFocus/onBlur 直接挂在原有 `a.dsh-base-plugins__row` 上（不新增包裹层、不改 flex/省略号布局），内容取 `pickText(plugin.desc, lang)` 完整文案；(3) packages/base/src/client/index.ts 的 AuthorPlugins 用 `useMemo` 建控制器、卸载时 dispose 并传给渲染函数；(4) texts.ts 文案：zh contactTip 改为「扫码加入交流群，反馈、建议、idea 都欢迎🎉」、zh issueTip 改为「任何功能需求、故障、建议、意见都可以提ISSUE问题单🙏」，en 同步（contactTip "...are all welcome 🎉"、issueTip "...just open an ISSUE ticket 🙏"）；(5) 测试：plugins.test.ts 新增 5 条 tooltip 用例（hover 显示完整 desc + role=tooltip + aria-describedby、离开 200ms 后消失且 aria 清除、跨行移动只留一枚、Escape 隐藏、focusin/focusout 显示隐藏），actions.test.ts 三处文案断言同步。**待做**：版本升 0.1.5（package.json / package-lock / manifest / baseline 已重生成）、本地门禁全绿、发布 0.1.5 三通道可读、五仓依赖升 0.1.5 重建内联产物（banner v0.1.5）出 tarball、重装 web profile 由 owner 复验「作者插件卡的完整介绍气泡」与两处新文案。''

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] base 源码含通用 createTipController + 作者插件行接入 tooltip（不新增包裹层、不改省略号布局），单测覆盖 hover/离开/跨行/Escape/键盘聚焦
- [x] 两处文案中英同步改好，actions.test.ts 断言同步，base typecheck / vitest / build / build:demo / data:check 全绿
- [x] base 版本 0.1.5，发布后 npmmirror / unpkg / jsDelivr 三通道可读 0.1.5，发布 tarball 解包含 createTipController 与 v0.1.5 banner
- [x] 五仓依赖精确 0.1.5、内联/派生产物 banner v0.1.5（file:line 证据）、各仓门禁与定向测试绿、五份 tarball 落到 D:/temp/hac2-pack/b015
- [~] web profile 重装 0.1.5 并重启实例，CDP + owner 人眼复验：作者插件卡悬停出完整介绍气泡、页头三钮气泡结尾 🎉 / ISSUE问题单🙏 正确

## Comments

### local — 2026-10-31T16:22:04.010Z

### local — 2026-10-31T16:35:32.206Z
## 2026-11-01 00:40 0.1.5 五仓换代 + web profile 重装 + 真机 CDP 取证完成（等 owner 人眼复验）

- **五仓升级完成（HEAD==origin，base devDep 精确 0.1.5）**
  - dsh-prompt `eabd828`（10 files +135/−112；lib/client.js:6527 banner v0.1.5、:6891/:7669/:8757 createTipController、:8539-8548 rowTip）
  - dsh-mattpocock-skills-deck `61b557d4`（14 files +133/−116；scripts/generated/baseClient.derived.js:6 banner、:2040-2064 rowTip）
  - dsh-opencode-palette `3b01032`（12 files 21+/21−；package/lib/client.js:22802 banner、:23171 createTipController、:24839 rowTip）
  - dsh-im-companion `e7651a9`（13 files +17/−17；lib/client.js:28163 banner、:28527 createTipController、:30176 rowTip）
  - ilife `c7f0ea8`（7 files +19/−19；dist/client.js:101 banner、:2114 rowTip）
- **tarball 五份** 落 D:/temp/hac2-pack/b015/：prompt 997,184B / deck 1,612,044B（sha256 BE10EE…4B4E0）/ palette 704,112B / im 1,174,158B / life-pack 1,901,796B；解包逐包校验 v015=1 / v014=0 / tipCtrl=3 / rowTip=3 / QR box=1。
- **聚合校验**：readme:sync --check --all --repos D:/dsh-plugin EXIT 0（11 份 up to date）；doctor --repos D:/dsh-plugin EXIT 0（package-version 0.1.5、manifest v0.1.5 rev2、五仓 readme-images @0.1.5、dependency-version 0.1.5、deck inline-bundle-version inlined v0.1.5）。
- **web profile 重装**：备份 D:/temp/hac2-pack/web-profile-backup-20261101-0022（6 件）；b015 tarball 改名 b015x 强制重解析；dsh plugin --profile web add → EXIT 0（Packages: +5，2.1s）；node_modules 五包 v0.1.5 标记各 1 处、v0.1.4 命中 0；重启 3080 实例（pid 34380），日志无插件加载报错。
- **真机 CDP 复验（1416×845，MattSkills 设置页）**：作者插件卡 4 行；悬停第 2 行 dsh-opencode-palette → `.dsh-base-tip` 恰 1 枚、role=tooltip、文本「38 款 opencode 经典配色 + 20+自定义主题 一键换装 DSH。」（完整介绍词，行内为省略号），该行 aria-describedby=dsh-base-tip-1。
- **页头三钮气泡文案实测**：联系我们 →「扫码加入交流群，反馈、建议、idea 都欢迎🎉」；Star 这个项目 →「您的🌟是我夜空中最亮的星🌹」；提交 Issue →「任何功能需求、故障、建议、意见都可以提ISSUE问题单🙏」；opacity 均 1、同屏 1 枚。
- **联系弹窗回归**：三卡 feishu/qq/wechat 均为 data:image/png 内联码（natural 320×320、显示 215×215），左右留白各 13px 对称，微信卡 note「该二维码 6 天内（11 月 7 日前）有效」，无 fallback 链接。
- **截图**：.tmp/web4-author-tip.png、web4-header-tip.png、web4-modal.png（裁图同名 -crop.png）。
- **剩余**：owner 人眼复验（web profile 已装好，地址见票 06），通过即关闭本票与票 06。
## 2026-11-01 00:22 base 0.1.5 已发布，五仓升级派单

- 发布：commit 9ca64c6（manage main），publish-base workflow run 41218845884 success，`npm notice version: 0.1.5` / tarball 386.8kB / 40 files
- npmmirror `https://registry.npmmirror.com/dsh-featherhunter-plugin-base/0.1.5` → 200（6290B）；npmmirror tarball 386,834B 解包核验：banner `/*! dsh-featherhunter-plugin-base v0.1.5 */`、v0.1.4 命中 0、manifest version=0.1.5 revision=2 groups=3、`createTipController` 3 处、`dsh-base-plugins__row` tooltip 接线 3 处、新文案 `contactTip: "扫码加入交流群，反馈、建议、idea 都欢迎🎉"` 与 `issueTip: "任何功能需求、故障、建议、意见都可以提ISSUE问题单🙏"` 均在产物内（emoji 以 \u{...} 形式编码）
- base 本地门禁：typecheck 0 / vitest 27 files 347 passed 6 skipped / build 0 / build:demo 0 / data:check 0
- 本地 demo CDP 实测：作者插件行悬停后出现深色气泡显示完整介绍词（role=tooltip、opacity=1、同屏 1 枚）
- 五仓升级已派单 team task-25..29（prompt / deck / palette / im / ilife），要求 tarball 落 D:/temp/hac2-pack/b015/；web profile 已备份到 D:/temp/hac2-pack/web-profile-backup-20261101-0022

## 进度

- 进度：95%（2026-11-01T00:35:31+08:00）：0.1.5 五仓换代、web profile 重装与 CDP 取证完成，等 owner 人眼复验
- 进度：25%（2026-11-01T00:22:03+08:00）：0.1.5 已发布并在 npmmirror 可装；五仓升级执行中
