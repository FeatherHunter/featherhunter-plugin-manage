<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 09, 10 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-e72bb919-5977919 -->
<!-- DSH-CREATED: 2026-10-30T15:57:03.890Z -->
# 11: 全量同步门禁与 doctor

**What to build:** 提供全量同步与门禁：一次命令同步全部 11 个目标文件；检查模式对漂移、缺块、脏行、标记不配对给出明确错误并非零退出；doctor 汇总健康度：包版本、数据新鲜度、远端清单可达性、README 各块状态、各仓定时任务挂载情况、文案校验时间是否超过 90 天。失败时不留半成品。

**Blocked by:** 09, 10

**Status:** ready-for-agent

- [ ] 全量同步覆盖 11 个文件，二次运行零 diff
- [ ] 检查模式对漂移/缺块/脏行/标记错误分别报错，退出码非零
- [ ] doctor 各检查项有独立用例，输出结论可读、可被 CI 解析
- [ ] 同步中途失败不留半成品（先写临时再原子替换）

## 进度
