<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 08 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-45066b60-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:47:21.811Z -->
# 12: ilife 仓接入 base 包

**What to build:** ilife 仓接入 base 包：只在总管页加入口（六个子品页不加独立入口），内联 base client；先补 docs/star-history-{dark,light}.svg 资产再迁移 README；ci.yml 加 schedule 与 readme:sync 步骤。

**Blocked by:** 08

**Status:** resolved

- [ ] 总管页接入入口与推荐卡；六个子品页不加独立入口
- [ ] 内联 base client 产物，本仓 tsc -b 与测试通过且无重复 React
- [ ] 补齐星图资产（docs/star-history-dark.svg / light.svg）后 README 四块迁移（联系区用 ## 反馈与联系 Markdown 标题变体）
- [ ] ci.yml 加 schedule: 与 readme:sync 步骤，不新增 workflow 文件
- [ ] readme:sync --check 与 doctor 对本仓全绿
- [ ] 其他仓零改动

## Comments

### local — 2026-10-31T05:44:40.813Z

### local — 2026-10-31T05:44:41.228Z
ilife 仓接入完成并经 Lead 独立复核：依赖钉 0.0.2、总管页用 base AuthorPlugins/ContactRow、产物内联 base client（React 单例）、README 四块托管、ci.yml 加 schedule+readme:sync 未新增 workflow、README/doctor 全绿；定向测试 97 pass/0 fail；全量套件为既有环境性红（基线 130 条，无新增失败）。
## Lead 独立复核（2026-10-31）

提交 `d7cdda30`（master，基线 e7da164d，25 files +1554/−177，单次本地提交未 push，工作区干净）。

### 复核结果（Lead 本机重跑，非采纳实现者自述）
- 依赖：根 package.json 与 packages/plugin-manager/package.json 均 `"dsh-featherhunter-plugin-base": "0.0.2"` 精确；pnpm-lock 只有 integrity `sha512-4iL/yaly5dlgvKOx8hXfJ8qtAD0/W8jFGjDoWtUcqMP9t3ooj2pBE6jcwwgdta2FcHIOFs+/5eJyHmWkkGOi6A==`（与已发布 0.0.2 tarball 一致），npmmirror 命中 0。
- 工作流：`git diff e7da164d..HEAD -- .github/workflows` 仅 M `.github/workflows/ci.yml`；两次 `git ls-tree` 对比 workflow 文件集合完全一致 → 未新增 workflow 文件。
- README 四块托管标记齐全（THANKS-TABLE-ZH / 反馈与联系 CONTACT / STAR-HISTORY picture 暗亮双源 / MORE），`pnpm readme:check` exit 0 up to date；`--repo .` 由本仓脚本带 `--preserve-symlinks-main` 调起。
- 产物：`pnpm build` 后 packages/plugin-manager/dist/client.js 1,286,080 B，含 base 横幅 v0.0.2、`dsh-base-*` 标记 109 处、`require("react")` 恰 1 次（React 仍 external，无第二份）。
- 入口范围：base 引用只在 plugin-manager（src/base-ui.ts 桥、client.ts 第 1479/1480 行渲染 AuthorPlugins/ContactRow、nav.ts 注释、测试）；六个子品包 src 零命中。旧 MORE_PLUGINS 表、MorePluginsCard、ExternalIcon、more* 样式删除。
- 门禁：typecheck exit 0；build exit 0（build 后 git status 干净）；readme:check exit 0；star:check exit 0；thanks:check exit 0；gen:check DATA-ABSENCE PASS；boundaries PASS；base:floor 15/15；changeset:status exit 0；base doctor `--offline` 10 项全 ok（readme-blocks 1、readme-images 3@0.0.2、dependency 0.0.2、star-assets、cron-mounts「mounted in ci.yml with schedule」）。
- 定向测试：node --test（本票改动的 4 个 plugin-manager 测试 + client-bundle-48 + tooling 两个测试）97 pass / 0 fail。
- 全量套件本机仍红（实现者报告基线 130 条环境性红：headless Chrome/CDP、既有像素缝、数据相关；全量跑 47 万 ms 级别且需联网/浏览器，Lead 未复跑）。本票改动文件相关测试全绿、无新增失败 → 按「不新增失败」口径接受；整体验收票 13 将记录该基线红事实。

### 已知偏离 / 后续
1) base CLI（0.0.2）入口判定对 pnpm 软链不友好：脚本不带 `--preserve-symlinks-main` 时静默 exit 0 空转。本仓 readme:* 三脚本已带；属 base 仓改进项，不在本规格范围，已记入票 13 交付说明建议回馈 base。
2) ci.yml 新增 schedule 的 readme-sync 作业需 Actions 写权限/branch protection 首次实跑验证（本地无法证明）。
3) doctor `inline-bundle-version: not inlined` 是 base 扫描器只扫源码的盲区；内联真实性由 panel-shell-679 测试与产物 grep 双重咬住。

结论：票 12 验收通过，关闭。

## 进度

- 进度：100%（2026-10-31T13:44:40+08:00）：Lead 独立复核通过：commit d7cdda30（25 files），typecheck/build/readme:check/star:check/thanks:check/gen:check/boundaries/base:floor/doctor(离线10项) 全绿，定向测试 97 pass/0 fail，无新增 workflow、lock integrity 与已发布 0.0.2 一致
