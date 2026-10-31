<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-c7b484f6-5978045 -->
<!-- DSH-CREATED: 2026-10-31T02:26:33.276Z -->
<!-- DSH-BLOCKED-BY: 01 -->
# 03: palette 仓接入 base 包（mini-bundler 风险）

**What to build:** palette 仓接入 base 包，重点是验证 palette 的 mini-bundler 能内联 base client 产物：INLINE_PACKAGES 登记新产物，设置面板接入入口与推荐卡，README 三个文件迁移四块（星图保留单张主题中性图），已有 workflow 挂 readme:sync。

**Blocked by:** #01

**Status:** ready-for-agent

- [ ] 依赖钉精确版本；INLINE_PACKAGES 登记 base client 产物
- [ ] mini-bundler 构建通过且产物无重复 React
- [ ] 设置面板入口与推荐卡接入；旧实现删除
- [ ] README.md、package/README.md、docs/README.en.md 四块迁移
- [ ] 已有 workflow 挂 readme:sync，不新增 workflow 文件
- [ ] readme:sync --check 与 doctor 对本仓全绿；本仓构建与测试通过
- [ ] 其他仓零改动

## 进度
