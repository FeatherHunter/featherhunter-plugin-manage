<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 03, 07 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-b7d5aaaa-5977919 -->
<!-- DSH-CREATED: 2026-10-30T15:56:53.917Z -->
# 08: README 联系区渲染与同步

**What to build:** 实现联系区的渲染器与同步命令：标准标题变体与 ilife 的 Markdown 标题变体都能渲染；README 里插入成对标记，命令支持初始化、同步、只检查三种模式；联系区图片改为绝对 CDN 地址（258 宽整卡、日期文件名、带版本查询串）；同步只替换标记块，遇到脏行或结构可疑处停手报错，重复运行零 diff。

**Blocked by:** 03, 07

**Status:** resolved

- [x] 两个变体渲染结果与 fixture 内容等价
- [x] 初始化能在无标记文件里正确插入标记；同步幂等；检查模式有差异时非零退出
- [x] 脏行被识别为错误且不改文件；标记不配对时报错
- [x] 图片 URL 为精确版本 + 日期文件名 + 版本查询串；README 输出不含弹窗专用字段

## Comments

### local — 2026-10-30T17:25:08.167Z
联系区渲染与同步完成：两变体等价、init 插入、同步幂等、--check 退出 1、脏行/标记不配对报错、CDN 精确版本 URL 均通过 31 例测试；已合入 feat/base-package (adb337f)。

## 进度

## 结果（2026-10-31）
- 实现：`src/node/renderers.ts`（联系卡渲染、CDN 图片 URL 规则）、`src/node/readme-sync.ts`（标记块引擎/原子写/脏行停手/legacy 定位）、`cli.ts` 新增 `readme:init|readme:sync`（`--check`/`--all`/`--root`，退出码 0/1/2）；`package.json` 注册 `readme:init`/`readme:sync`/`readme:check` 脚本；测试 `test/{contact-render,readme-sync,readme-cli}.test.ts` 共 31 例。
- 验收逐条：① 标准标题变体与 ilife Markdown 标题变体渲染等价（fixture 对比）；② 无标记文件可插入标记、同步幂等（重复运行零 diff）、`--check` 有差异退出 1；③ 脏行（如 im README 的 `</div>>>>>>>> origin/master`）报错退出 1 且文件不变、标记不配对报错；④ 图片 URL 为 `https://cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base@0.0.1/data/img/<日期文件名>`，限时码带 `?v=YYYYMMDD`，输出不含弹窗专用字段。
- 偏差：卡片宽度按规格用 260（票面写 258）；规格 §7 的 `--repos` 与票面 `--root` 冲突，按票面实现可重复 `--root`；`readme:init` 要求 contact 块以 `</div>` 收尾才插入。
- 合并：`adb337f`（--no-ff 合入 feat/base-package），全量测试 181 passed / 6 skipped。