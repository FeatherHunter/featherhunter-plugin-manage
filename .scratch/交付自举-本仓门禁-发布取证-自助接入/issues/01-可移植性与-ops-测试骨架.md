<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-c1969ad1-5978770 -->
<!-- DSH-CREATED: 2026-11-02T14:50:11.685Z -->
# 01: 可移植性与 ops 测试骨架

**What to build:** 仓库根由脚本自身位置推导：scripts/ops 里按仓库名解析默认路径的脚本（门禁入口、发布脚本）在任何克隆位置、任意 cwd 下都解析到脚本所属仓库；同时把 ops 域测试套件与子进程夹具辅助搭好，后续票在同一套件上加用例。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [ ] 夹具：把 scripts/ops 原样复制到临时目录（不创建 packages/base 包），运行门禁入口且不传 --repo，退出 2 且 stderr 指向 临时目录/packages/base；该用例在修复前必须红（旧代码会解析到本机真实仓并继续跑）。
- [ ] 真实仓内任意 cwd 运行门禁入口 --json --only docs，回执 repo 字段等于本仓根，无需 --repo。
- [ ] 仍保留的跨仓脚本 --help 全部退出 0（只证明未改坏，不新增依赖）。
- [ ] 新测试套件随包内 npm test 执行；子进程调用不经 shell；共享夹具辅助在本票冻结，后续票不得修改。
- [ ] npm run typecheck 与 npm test 绿。



## Comments

### local — 2026-11-02T15:18:36.895Z
实施与验收证据：commit 7184482（3 文件 +287/-2）。可移植性：lib/common.mjs 用 import.meta.url 推导 REPO_ROOT，DEFAULT_REPOS.base=REPO_ROOT。夹具：test/ops/support/ops-fixtures.ts（冻结）+ portability.test.ts 3 用例。红→绿：旧代码复制工具箱用例期望 exit 2 实得 0（真跑了本机仓 docs）；修复后 3/3 passed，stderr 指向 tmp/packages/base。集成后主仓门禁 exit 0。额外：发现干净克隆下 dist-contract 依赖 gitignored dist，由 Lead 在集成分支补 commit 607edf5（dist 缺失时测试自行 build），已在 t02 干净工作树验证 8/8 通过。

### local — 2026-11-02T15:18:47.592Z
票面 5 条验收全部满足：夹具可移植性用例先红后绿；真实仓任意 cwd --json --only docs 回执 repo=本仓根；跨仓脚本 --help 均 0；新套件随 npm test 执行、子进程不经 shell、夹具已冻结；typecheck 与 test 绿。





## 进度

- 进度：100%（2026-11-02T23:18:30+08:00）：已合入集成分支 6c2d6ec；门禁全绿：typecheck 3.4s / tests 1008 passed 6 skipped / docs:check / build
