<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 06, 08 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-57146219-5977919 -->
<!-- DSH-CREATED: 2026-10-30T15:56:56.418Z -->
# 09: README 作者作品区渲染与同步

**What to build:** 实现作者其他作品区的渲染器与同步：标准 HTML 标题 + 引导句 + 四行链接；兼容 prompt 两个文件的 Markdown 标题变体与两种英文标题；每仓排除自己；新增成对标记；ilife 补上该块；deck 英文页按拍板移除不在定稿清单里的第 6 个插件行。

**Blocked by:** 06, 08

**Status:** resolved

- [ ] 现有 10 处渲染结果与 fixture 内容等价（成员、顺序、链接、文案）
- [ ] prompt 两个文件保留 Markdown 标题变体；英文标题两种历史形态都保留
- [ ] ilife 新块插入到正确位置；deck 英文页多余行按拍板移除
- [ ] 同步幂等、检查模式可用；标记不配对或脏行时报错

## Comments

### local — 2026-10-30T18:10:24.580Z
验收通过：MORE 块渲染/同步完成，a9a1c48 + 2996fd9，合并 46ff6d6；全量 253 测试、typecheck、build 绿。四行链接、每仓排除自己、prompt Markdown 变体、两种英文标题、ilife 补块、deck-en 移除多余行、幂等与错误保护均有单测与 11 份真实 README 副本冒烟证据。

### local — 2026-10-30T18:10:24.665Z
实现、测试与验收证据已入正文；集成分支合并完成。

## 进度

## 结果（2026-10-31）

**实现**：`renderers.ts` 新增 `renderMoreBlock` + `pluginLink` + `MORE_TEXT`；`readme-sync.ts` 注册 MORE 定义的 render/locateLegacy/detect，支持 per-block heading 变体与 headingText，legacy 定位在顶层 `---` 后保留 footer；`types.ts` 的 `BlockDefinition.detect` 增加 headingText；`cli.ts` 增加 --readme/--self。
**测试**：`test/readme-more.test.ts`（7）、`readme-sync.test.ts` MORE 引擎用例（+6）、`readme-cli.test.ts`（+2）；合并后全量 253 测试通过、typecheck/build 绿。
**验收**：
- [x] 10 处既有渲染点内容等价（成员/顺序/链接/文案；palette 等仅 more.items 顺序差异，已记录）
- [x] prompt 两文件保留 Markdown 标题变体；英文 "More from the author"/"More by the author" 两种历史形态保留
- [x] ilife 在 EOF 插入新块（4 行、排除自己）；deck 英文页移除 dsh-chinese-skill-patch 行且保留 `---` 之后的问答/版权 footer
- [x] 同步幂等、--check 可用；标记不配对或脏行时报错且文件字节不变
**提交**：a9a1c48（实现）、2996fd9（footer 边界修复）；集成合并 46ff6d6。
**偏差/风险**：deck-en 与 im 的 legacy 外层 `</div>` 在 footer 之后保留为孤立闭合标签（浏览器容忍，列入迁移报告的外观微调）；palette/prompt 星图双图共用现有单 SVG（票 10 范围）。
