<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: header-trio-2026-10-31 -->
<!-- DSH-CREATED: 2026-10-31T08:16:36.396Z -->
# 15: 页头三件套（联系/Star/Issue）+ HoverTip 公共化 + 微信群码换发 2026-10-31

**What to build:** 

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

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

## 进度
