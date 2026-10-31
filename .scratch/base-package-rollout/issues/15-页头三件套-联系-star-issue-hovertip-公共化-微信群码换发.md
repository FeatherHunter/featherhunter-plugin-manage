<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: header-trio-2026-10-31 -->
<!-- DSH-CREATED: 2026-10-31T08:16:36.396Z -->
# 15: 页头三件套（联系/Star/Issue）+ HoverTip 公共化 + 微信群码换发 2026-10-31

**What to build:** 

**Blocked by:** None (can start immediately)

**Status:** resolved

- [ ] packages/base 新增 ContactButton/StarButton/IssueButton/ActionButtons/ActionGroup/HoverTip，中英文案与图标规格有单测
- [ ] 全量 vitest / typecheck / build 绿
- [ ] base 版本 0.1.0 发布到 npm（--tag latest），三通道可读新数据
- [ ] 五仓（deck/prompt/palette/im/ilife）在设置面板或页头按各自宿主风格接入三件套；im 保留自绘作者插件卡，ilife 右下角使用手册入口不动
- [ ] 五仓构建通过、提交并推送；README 联系区指向新微信群码
- [ ] deck 页面与 CDN 新卡实测截图

## 目的

用户 2026-10-31 追加两项需求，随 base 0.1.0 一并落地：

1. 统一页头三件套 + 三项合一控件：联系 / Star / Issue 三个按钮；Star、Issue 用 MattDeck 同族线稿 SVG；悬浮提示抽成公共 HoverTip 组件；三句悬浮文案中英双语，可用 texts 覆盖。
2. 微信群二维码换发：旧码 2026-10-30 到期；新图 contact/src/card-wechat-2026-10-31.png / qr-wechat-2026-10-31.png，validUntil 2026-11-07。

## 验收


## 背景

- 规格：.scratch/base-package-rollout/spec.md
- Star 悬浮文案为用户原文：“您的🌟是我夜空中最亮的星🌹”；联系、Issue 两句由我拟定并经 demo 截图核对。
- 新微信群码图源：C:\\Users\\辰辰洋洋\\Pictures\\群聊：DSH 插件交流群.png；仓主已确认“二维码全部正确”。

## Comments

### local — 2026-10-31T09:35:24.529Z
全部验收项完成：base 0.1.1 发布（jsDelivr/unpkg/npmmirror 可读，含 2026-10-31 新微信群码与页头三件套组件）；五仓（prompt f7229e5+685cb7b、deck 91db8fcf、palette 28f215b、im aa36b20、ilife a1d108a7）依赖升 0.1.1、页头/面板接 ActionGroup、内联产物 banner v0.1.1、构建与测试通过并已 push；README 联系区全部指向新群码；deck 页面与 CDN 新卡实测通过。注：base 实际发版为 0.1.1（0.1.0 因 manifest 版本缺陷已 deprecate）。

## 进度

- 进度：100%（2026-10-31T17:35:23+08:00）：base 0.1.1 已发布并三通道验证；五仓均已升依赖、接入页头三件套并推送；README 新微信群码已生效；deck GitHub 页面实测新卡渲染正常
- 进度：55%（2026-10-31T16:48:41+08:00）：base 0.1.1 已发布并验证（jsDelivr 200、npmmirror latest=0.1.1）；五仓 README 已同步新微信群码；五仓依赖升级+页头三件套接入由 5 个子代理并行进行中
