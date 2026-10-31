<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: hac2-t8 -->
<!-- DSH-CREATED: 2026-10-31T16:14:39.829Z -->
# 08: 作者插件卡完整介绍 HoverTip 与 base 0.1.5 五仓换代

**What to build:** 让「作者的其他插件」每一行在鼠标悬停 / 键盘聚焦时，用 base 共用 HoverTip 弹出该插件的**完整介绍词**（行内描述被省略号截断，气泡是读全文案的唯一途径），同时把 owner 要求的两处文案改掉，发 base 0.1.5 并五仓换代重装验收。**已完成的 base 侧实现**（本轮已在工作区落地，待发布）：(1) packages/base/src/client/hover-tip.ts 抽出通用 `createTipController(options)` 与 `TipController{show,hideSoon,hideNow,dispose}`（160ms 离开延迟、Escape 立即隐藏、aria-describedby 指向气泡、document.body 挂载、同屏仅一枚），cluster.ts 改用同一控制器（删除本地重复实现约 85 行）；(2) packages/base/src/client/plugins.ts 的 `renderAuthorPlugins` 增加 `tip?: TipController` 选项，把 onMouseEnter/onMouseLeave/onFocus/onBlur 直接挂在原有 `a.dsh-base-plugins__row` 上（不新增包裹层、不改 flex/省略号布局），内容取 `pickText(plugin.desc, lang)` 完整文案；(3) packages/base/src/client/index.ts 的 AuthorPlugins 用 `useMemo` 建控制器、卸载时 dispose 并传给渲染函数；(4) texts.ts 文案：zh contactTip 改为「扫码加入交流群，反馈、建议、idea 都欢迎🎉」、zh issueTip 改为「任何功能需求、故障、建议、意见都可以提ISSUE问题单🙏」，en 同步（contactTip "...are all welcome 🎉"、issueTip "...just open an ISSUE ticket 🙏"）；(5) 测试：plugins.test.ts 新增 5 条 tooltip 用例（hover 显示完整 desc + role=tooltip + aria-describedby、离开 200ms 后消失且 aria 清除、跨行移动只留一枚、Escape 隐藏、focusin/focusout 显示隐藏），actions.test.ts 三处文案断言同步。**待做**：版本升 0.1.5（package.json / package-lock / manifest / baseline 已重生成）、本地门禁全绿、发布 0.1.5 三通道可读、五仓依赖升 0.1.5 重建内联产物（banner v0.1.5）出 tarball、重装 web profile 由 owner 复验「作者插件卡的完整介绍气泡」与两处新文案。''

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] base 源码含通用 createTipController + 作者插件行接入 tooltip（不新增包裹层、不改省略号布局），单测覆盖 hover/离开/跨行/Escape/键盘聚焦
- [ ] 两处文案中英同步改好，actions.test.ts 断言同步，base typecheck / vitest / build / build:demo / data:check 全绿
- [ ] base 版本 0.1.5，发布后 npmmirror / unpkg / jsDelivr 三通道可读 0.1.5，发布 tarball 解包含 createTipController 与 v0.1.5 banner
- [ ] 五仓依赖精确 0.1.5、内联/派生产物 banner v0.1.5（file:line 证据）、各仓门禁与定向测试绿、五份 tarball 落到 D:/temp/hac2-pack/b015
- [ ] web profile 重装 0.1.5 并重启实例，CDP + owner 人眼复验：作者插件卡悬停出完整介绍气泡、页头三钮气泡结尾 🎉 / ISSUE问题单🙏 正确

## 进度
