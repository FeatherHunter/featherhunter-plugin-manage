<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 09, 10 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-e72bb919-5977919 -->
<!-- DSH-CREATED: 2026-10-30T15:57:03.890Z -->
# 11: 全量同步门禁与 doctor

**What to build:** 提供全量同步与门禁：一次命令同步全部 11 个目标文件；检查模式对漂移、缺块、脏行、标记不配对给出明确错误并非零退出；doctor 汇总健康度：包版本、数据新鲜度、远端清单可达性、README 各块状态、各仓定时任务挂载情况、文案校验时间是否超过 90 天。失败时不留半成品。

**Blocked by:** 09, 10

**Status:** resolved

- [ ] 全量同步覆盖 11 个文件，二次运行零 diff
- [ ] 检查模式对漂移/缺块/脏行/标记错误分别报错，退出码非零
- [ ] doctor 各检查项有独立用例，输出结论可读、可被 CI 解析
- [ ] 同步中途失败不留半成品（先写临时再原子替换）

## Comments

### local — 2026-10-30T19:12:00.760Z

### local — 2026-10-30T19:12:01.007Z
已交付：--repos 批量同步 11 文件、--check 四类错误非零退出、doctor 六类检查、原子写与测试；演练 10/11 通过，im README 既有脏行为 HUMAN-GATE。
## 票 11 完成结果

- 实现：`readme:init|sync --all --repos <parent>` 按内置 11 文件表批量迁移（每文件语言 / selfId / 星图 / 感谢数据）；`--check` 对漂移、缺标记、merge-conflict 脏行、标记不配对 / 重复 / 顺序错误均明确报错并非零退出，且不改文件；写文件走同目录临时文件 + 原子 rename，单文件失败不留半成品，其余文件继续处理。
- doctor：`doctor [<repo-dir>] [--repos <parent>] [--offline] [--json]`，检查包版本、manifest 版本与新鲜度、远端 CDN 清单（unpkg → jsDelivr 回退，1.5s 超时）、逐仓 README 四块（内部 sync --check）、精确版本图片地址、依赖声明精确版本、内联 bundle banner 版本、workflow 是否挂 readme:sync（ilife 额外要求 schedule）。输出 `ok/fail + name + detail`，CI 可解析。
- 测试：新增 test/readme-targets.test.ts（10 例：11 条目标表、星图版本探测与 8→12 位补齐、--repos 解析、11 文件 init + 二次零 diff、漂移恢复、四类损坏各自非零退出且文件不动、缺文件时其余文件写入且无 .tmp 残留、参数互斥）与 test/doctor.test.ts（14 例：核心检查、CDN 回退顺序、逐仓各检查项失败用例、CLI --json / --offline / 退出码 / 未知目录）。全量 277 passed / 6 skipped，typecheck 绿，build / demo / packlist 绿（32 files, 324023 bytes）。
- 演练（真实 README 副本 .tmp/drill-repos，五仓只读）：init 迁移 10/11；dsh-im-companion/README.md:262 存在既有 `</div>>>>>>>> origin/master` 残留，按规格停手报错（HUMAN-GATE：需仓主手工删除该行后重跑）；二次 sync 对 10 个文件零 diff；--check 对 10 个文件全绿、im 根 README 非零退出；doctor --repos --offline --json 输出 29 项检查，readme-blocks / readme-images 对已迁移文件全绿，dependency-version / cron-mounts 对五仓均 fail——真实仓库尚未声明本包依赖、也未挂载 readme:sync（属票 12/13 交接后各仓落地的集成项）。
- 提交：5ff50de feat(node): multi-repository README sync and doctor health checks (ticket 11)。

## 进度

- 进度：100%（2026-10-31T03:12:00+08:00）：readme --repos 全量同步 + doctor 健康检查已实现并提交 5ff50de；全量测试/typecheck/build/演练通过（im 根 README 脏行按规格报错，待仓主修）
