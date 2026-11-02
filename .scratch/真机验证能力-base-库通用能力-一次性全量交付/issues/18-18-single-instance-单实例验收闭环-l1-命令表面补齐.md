<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-c0c7d348-5978529 -->
<!-- DSH-CREATED: 2026-11-01T18:48:32.210Z -->
# 18: 18 single-instance：单实例验收闭环（L1 命令表面补齐）

**What to build:** 规格第 79 行的 L1 命令表面含 `single-instance`，但原 17 张实施票没有一张覆盖它（票 06 只覆盖 `concurrent`，票 04 只覆盖 `launch`/`stop` 原语）。补齐这条 L1 命令：一条命令走完「计划 → 起一个隔离实例 → 检查（可达性 / 日志可解析 / 页面）→ 回收 → 写报告」的骨架，`--dry-run` 零写入零启动，`--json` 单段报告，`--keep` 保留实例但报告注明，退出码 0/1/2 与报告词表严格一致；页面检查缺浏览器适配器时记 `blocked` 而不是 `fail`。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [ ] 绿跑：报告里四条检查（instance-reachable / logs-readable / instance-pages / teardown-clean）与 steps（plan/launch/checks/cleanup）齐全，`run.json` + `.sha256` 可复核
- [ ] `--dry-run` 零写盘、零 spawn，打印的投影与真实执行同一份计划
- [ ] 提前退出/日志零事件/缺日志目录/无浏览器适配器/杀不掉的残留进程，各自给正确退出码与 expected/actual/hint
- [ ] `--keep` 时 teardown-clean 记 skip 且报告 note 注明 stopped:false，不影响退出码

**为什么现在才有这张票：** 规格命令表在拆分实施票之后补入了 `single-instance`，17 张票均未认领；实现与测试已随 d8a6bba 落在 base 仓，补票是为了让「每条实现都能追到票面」这条纪律成立。

**验收判据：**

## Comments

### local — 2026-11-01T19:52:41.128Z
真机证据（matt 仓阶段 A，批次 home D:/Temp/matt-batch-home，真实 home 只读）：
- `single-instance --profile web`（经由包装的 node_modules base dist）exit 0，4/4 pass：instance-reachable（instance a968ab95191278d4 pid 55916 port 50991 ready 18366ms）、logs-readable（4 events parse）、instance-pages（800x600 viewport / 1920x1080 screen）、teardown-clean；steps [plan, launch, checks, cleanup] 齐全。
- run.json sha256 = 272cc144ebd24fb6e2cb8bfde9125924de5a89ba02d18a0a231aeac13b37ba1f（同目录 .sha256 文件可复核）。
- dry-run 零写盘零 spawn、提前退出/零事件/缺日志目录/无浏览器 blocked、--keep teardown skip note stopped:false、残留进程 fail —— 由 tests/single-instance.test.ts 12 例覆盖（d8a6bba，npm test 全量 932 passed/6 skipped）。
- 真实 home settings.yaml 前后 sha256 68fcd8f0ff53f2e666073eab1776cf8b09972ea313eef1f03638920021c957f7（8141B，mtime 未变）。
详见 D:/Temp/matt-t13-phaseA-report.md（sha256 760a90bd5349f982bbbf3a43ed56cb65b7cb95282de6b52c6bf296884c2731c2）。

### local — 2026-11-01T19:52:41.822Z
四条验收全部满足：绿跑四检查+steps+run.json sha 可复核；dry-run 零写零 spawn 有单测；五类异常退出码与 expected/actual/hint 有单测；--keep 时 teardown skip 且 note stopped:false。

## 进度

- 进度：100%（2026-11-02T03:52:40+08:00）：真机 single-instance exit0 4/4，run.json sha256 272cc144… 可复核；单测覆盖 dry-run/早退/零事件/缺目录/无浏览器/残留/--keep
- 进度：90%（2026-11-02T03:23:23+08:00）：实现与测试已随 d8a6bba 落盘（orchestration/checks/logs-readable.ts、cli/commands/single-instance.ts、tests/single-instance.test.ts 12 tests 全绿）；待真机 single-instance 证据（matt 批次 home）出后关票
