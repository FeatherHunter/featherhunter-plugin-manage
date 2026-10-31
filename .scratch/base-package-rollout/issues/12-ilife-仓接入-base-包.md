<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 08 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-45066b60-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:47:21.811Z -->
# 12: ilife 仓接入 base 包

**What to build:** ilife 仓接入 base 包：只在总管页加入口（六个子品页不加独立入口），内联 base client；先补 docs/star-history-{dark,light}.svg 资产再迁移 README；ci.yml 加 schedule 与 readme:sync 步骤。

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] 总管页接入入口与推荐卡；六个子品页不加独立入口
- [ ] 内联 base client 产物，本仓 tsc -b 与测试通过且无重复 React
- [ ] 补齐星图资产（docs/star-history-dark.svg / light.svg）后 README 四块迁移（联系区用 ## 反馈与联系 Markdown 标题变体）
- [ ] ci.yml 加 schedule: 与 readme:sync 步骤，不新增 workflow 文件
- [ ] readme:sync --check 与 doctor 对本仓全绿
- [ ] 其他仓零改动

## 进度
