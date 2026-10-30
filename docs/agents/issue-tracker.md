# Issue tracker: Local Markdown

Issues and specs for this repo live in the local-markdown backend (`backendId: markdown`, see `docs/agents/workspace.yaml`). Tickets are files in the workspace, but all reads/writes go through the `deck_*` tools — never hand-write ticket files.

## Conventions (deck 口径)

- 规格不是 `.scratch/<feature-slug>/spec.md` 文件，而是一张票（`kind=spec`，是顶层容器，不挂地图、不传 `parentKey`）。
- 实施票用 `deck_issue_create` 建（`kind=spec-ticket`，`parentKey` 填规格票号，`blockedBy` 填依赖票号），编号与文件头标记由工具写，不要手写 `.scratch/<feature-slug>/issues/` 下的文件。
- 认领与状态用 `deck_issue_patch` 改，不要手改 `Status`/`Assignees` 行。认领写入 `Assignees` 行由工具完成。
- 探索地图是顶层容器（`kind=map`）；地图下的工单用 `kind=map-ticket` 并带一枚 `label`（`wayfinder:research` / `wayfinder:prototype` / `wayfinder:grilling` / `wayfinder:task`），`parentKey` 填探索地图票号。
- 普通票用 `kind=issue`（万能兜底），缺陷用 `kind=bug`。
- 补边用 `deck_map_link`；上报当前在办哪张票用 `deck_issue_report`。
- 动票之前先调 `deck_context` 确认工作区与后端（工作区与仓库只从当前会话取，不接受参数）。

## When a skill says "publish to the issue tracker"

Use `deck_issue_create` (single ticket) or `deck_map_plan_create` (whole map skeleton with children + edges in one call). Do not create directories or markdown files under `.scratch/` by hand. If the skill text tells you to hand-write files, the deck usage in this document wins.

## When a skill says "fetch the relevant ticket"

- 单票正文/关系：`deck_issue_get`（只求快、反向边不急时传 `blocking=false`）。
- 按状态/label/assignee/关键词列薄行：`deck_issue_list`（先薄行扫数）。
- 看一张地图的全部子票/进度：`deck_map_snapshot`（子票清单要全不断时传 `detail=thin`）。

## Wayfinding operations

Used by `/wayfinder`. The **map** is a `kind=map` ticket with one **child** ticket per work item (managed by tools, not hand-written files).

- **Map**: `kind=map` 顶层票（Notes / Decisions-so-far / Fog 正文）。
- **Child ticket**: `kind=map-ticket` + 一枚 `label` 标注类型（`wayfinder:research` / `wayfinder:prototype` / `wayfinder:grilling` / `wayfinder:task`），`parentKey` 指向地图票；问题写在正文。
- **Blocking**: `blockedBy` 依赖边（`deck_issue_create` 传入或事后 `deck_map_link` 补）。所有阻塞票都关闭后才算 unblocked。
- **Frontier**: `deck_map_snapshot` 取全量子票（`detail=thin` 防截断），过滤 open + unblocked + unclaimed；先建先得。
- **Claim**: `deck_issue_patch` 认领（写 `Assignees` 行），先认领再开工。
- **Resolve**: `deck_issue_patch` 写答案/改状态并 `comment` 留痕；地图的 Decisions-so-far 回填上下文指针；开始/做完一块工作时用 `deck_issue_report` 上报一次。
