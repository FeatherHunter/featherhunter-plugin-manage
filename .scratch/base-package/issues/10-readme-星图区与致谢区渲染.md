<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 07, 08 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-7edf6957-5977919 -->
<!-- DSH-CREATED: 2026-10-30T15:56:58.991Z -->
# 10: README 星图区与致谢区渲染

**What to build:** 实现星图区与致谢区渲染器：星图统一为深浅双图 + 分钟级版本查询串，同时保留 deck 的独立页面外链、im 的宽度与角注等可选功能元素；palette/prompt 从单图升为双图；ilife 补星图。致谢沿用现有标记，输出三列表格，保留编号、花数与准入规则。星图 SVG 的生成脚本与定时任务不在本票范围内，不得改动。

**Blocked by:** 07, 08

**Status:** resolved

- [ ] 星图四处现有形态内容等价（含 deck 外链、im 宽度与角注）
- [ ] ilife 新增星图块；palette/prompt 升级为双图，查询串为分钟级
- [ ] 致谢表五仓内容等价，ilife 空表按规则处理
- [ ] 未修改任何 SVG 生成脚本或定时任务文件

## Comments

### local — 2026-10-30T18:10:25.487Z
验收通过：星图与致谢块渲染/同步完成，8e29cb1，合并 46ff6d6；全量 253 测试绿。deck 外链与 im width/角注保留、palette/prompt 单图升双图（sources 差异已记录）、ilife 新增星图、五仓致谢表逐行等价、空表规则与排名规则复现；未改 SVG 生成器/未新增定时任务/五仓零改动。

### local — 2026-10-30T18:10:25.568Z
实现、测试与验收证据已入正文；集成分支合并完成。

## 进度

## 结果（2026-10-31）

**实现**：`renderers.ts` 新增 `renderStarHistoryBlock`（picture 深浅双图 + `?v=YYYYMMDDHHmm` 12 位校验、可选外链/width/角注）与 `renderThanksBlock`（复用五仓 docs/thanks-data.json 的排名与合并段规则、空表仅表头+分隔行）；`readme-sync.ts` 注册 star-history/thanks 定义与 legacy 定位、per-language marker 跳过、hasData gating；`types.ts` 增加 `ThanksEntry/ThanksAuthor/ThanksData/StarHistoryData` 与 `starHistory/thanks` 选项。
**测试**：`star-history-render.test.ts`（15）、`thanks-render.test.ts`（17）、`readme-star-thanks-sync.test.ts`（9）、`readme-sync.test.ts`（+6）、`readme-cli.test.ts`（+2）、fixtures/thanks-data 五仓只读副本；合并后全量 253 测试通过。
**验收**：
- [x] star 四种既有形态内容等价（deck 外链、im width/角注保留；palette/prompt 单图升双图，仅 sources 差异已记录）
- [x] ilife 新增 star 块；palette/prompt 升级双图且带分钟级 ?v
- [x] thanks 五仓表格等价（deck 47 行、palette 9、im 3、prompt 5、ilife 空表），排名/合并段/链接规则复现
- [x] 不改 SVG 生成脚本、不新增定时任务、五仓零改动
**提交**：8e29cb1；集成合并 46ff6d6。
**偏差/风险**：palette/prompt 双图两色共用现有 `docs/star-history.svg`（生成器不在本票范围）；CLI 暂无注入 star/thanks 数据的参数，`readme:sync --all --repos` 的数据装载由票 11 的 targets 模块负责。
