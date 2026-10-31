<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: hac2-t3 -->
<!-- DSH-CREATED: 2026-10-31T10:35:02.641Z -->
<!-- DSH-BLOCKED-BY: 01, 02 -->
# 03: ActionCluster v2 按选定方向落地 + demo 状态样张

**What to build:** 按票 01 选定的方向把 base 页头三件套重构为 ActionCluster：items 数组驱动（id/icon/label/tip/href/onClick/disabled）、size 14|16|18、gap、variant、maxVisible 溢出「⋯」；按钮直接渲染，不再被 HoverTip 的 span 包一层；容器不响应 hover、无选中态；按钮 hover 使用与容器底色不同的 token，focus 用 inset 环，disabled 正确降级；气泡 160ms、同屏一枚、补 aria-describedby；组 aria-label 泛称、每钮独立 Tab；demo 增加浅/深状态样张（默认/hover/active/focus/disabled/溢出）；旧 ActionGroup 保留一版兼容。

**Blocked by:** #01, #02

**Status:** ready-for-agent

- [ ] 四种状态（含 hover 与 focus）在 demo 浅色、深色下肉眼可辨
- [ ] 溢出与第 4 钮按 maxVisible 行为正确
- [ ] 无障碍：组 role/aria-label、每钮 aria-label/Tab、气泡 aria-describedby
- [ ] base 单测与 demo 构建绿；现有调用不被破坏

## 进度
