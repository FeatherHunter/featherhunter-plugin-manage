<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: hac2-t2 -->
<!-- DSH-CREATED: 2026-10-31T10:35:02.338Z -->
# 02: base 预清理与最后一天文案修正

**What to build:** 删除 base 0.1.1 中永不命中的分段控件残留：7px 内切圆角规则、发丝分隔线规则、对应注释与 README 两处「分隔线」描述，统一表述为「一个容器 + N 个独立按钮」。组 aria-label 改为不写死三项名的泛称。修正弹窗二维码有效期文案：最后一天（days=0）不再显示「该二维码 0 天内…」，改为「今天（M 月 D 日前）有效」类中英文案；补最后一天/前一天/已过期/无有效期的单测。base vitest 与 typecheck 绿。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 全仓搜索不再出现 7px 内切圆角、hairline divider、分隔线等分段控件表述
- [ ] 组 aria-label 为泛称，不随按钮数量写死
- [ ] 最后一天文案有中英两条，单测覆盖四个边界
- [ ] base vitest / typecheck 全绿

## 进度
