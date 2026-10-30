<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 07, 08 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-7edf6957-5977919 -->
<!-- DSH-CREATED: 2026-10-30T15:56:58.991Z -->
# 10: README 星图区与致谢区渲染

**What to build:** 实现星图区与致谢区渲染器：星图统一为深浅双图 + 分钟级版本查询串，同时保留 deck 的独立页面外链、im 的宽度与角注等可选功能元素；palette/prompt 从单图升为双图；ilife 补星图。致谢沿用现有标记，输出三列表格，保留编号、花数与准入规则。星图 SVG 的生成脚本与定时任务不在本票范围内，不得改动。

**Blocked by:** 07, 08

**Status:** ready-for-agent

- [ ] 星图四处现有形态内容等价（含 deck 外链、im 宽度与角注）
- [ ] ilife 新增星图块；palette/prompt 升级为双图，查询串为分钟级
- [ ] 致谢表五仓内容等价，ilife 空表按规则处理
- [ ] 未修改任何 SVG 生成脚本或定时任务文件

## 进度
