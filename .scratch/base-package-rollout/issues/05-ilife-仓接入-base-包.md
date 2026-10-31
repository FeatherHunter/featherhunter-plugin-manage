<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-45066b22-5978045 -->
<!-- DSH-CREATED: 2026-10-31T02:26:34.640Z -->
<!-- DSH-BLOCKED-BY: 01 -->
# 05: ilife 仓接入 base 包

**What to build:** ilife 仓接入 base 包：只在总管页加入口（六个子品页不加独立入口），内联 base client；先补 docs/star-history-{dark,light}.svg 资产再迁移 README；ci.yml 加 schedule 与 readme:sync 步骤。

**Blocked by:** #01

**Status:** resolved

- [ ] 总管页接入入口与推荐卡；六个子品页不加独立入口
- [ ] 内联 base client 产物，本仓 tsc -b 与测试通过且无重复 React
- [ ] 补齐星图资产（docs/star-history-dark.svg / light.svg）后 README 四块迁移（联系区用 ## 反馈与联系 Markdown 标题变体）
- [ ] ci.yml 加 schedule: 与 readme:sync 步骤，不新增 workflow 文件
- [ ] readme:sync --check 与 doctor 对本仓全绿
- [ ] 其他仓零改动

## Comments

### local — 2026-10-31T03:47:36.630Z
这张票作废：建票时规格容器 #00 还不存在，票是以 kind=issue 直接建的，无法挂到规格下（deck_map_link 补 parent 会被后端拒绝）。已按规格体系重建为 #12（kind=spec-ticket、父票 #00、依赖边齐全），正文与验收条目一致，后续以 #12 为准。

### local — 2026-10-31T03:47:36.798Z
重复票，已由 #12 取代（规格容器 #00 建立前误建为普通 issue）

## 进度
