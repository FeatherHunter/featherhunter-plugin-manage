<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 01 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-58f396e9-5978444 -->
<!-- DSH-CREATED: 2026-11-01T11:43:03.705Z -->
# 02: 02 self-check：运行时与装配体检

**What to build:** 插件仓只写一份声明（包名、默认 profile、客户端入口、构建命令等）就能跑 `dsh-verify self-check`：只读、约数秒，检查 DSH 运行时（可执行与 asar 入口）、node 版本、目标 profile 是否存在、插件是否已安装（版本 + 客户端入口 sha256）。输出人类可读的 `ok|fail` 行与 `--json` 单段 JSON，退出码 0/1/2（2 = 受阻），失败行必须写「期望 vs 实际 + hint」。这条票同时定下「计划 → 执行 → 报告」骨架与最小证据落盘（命令输出、文本证据），供后续所有命令复用。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 在真实插件仓跑 `self-check` 能正确报出上述四项的通过/失败
- [ ] 未注入浏览器等可选能力时不产生 `fail`（应为 `skip` 或 `blocked`）
- [ ] 测试走进程内 CLI 入口 + 注入替身，不依赖本机真实 home、不真起实例
- [ ] README 有「安装 → 写声明 → 跑自检 → 读报告」的首段，足够一个新仓照着做

# 02: self-check：运行时与装配体检





## 进度
