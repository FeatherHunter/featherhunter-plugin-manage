<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 02 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-c21ba0fc-5978444 -->
<!-- DSH-CREATED: 2026-11-01T11:43:04.004Z -->
# 03: 03 self-check：技能与模型

**What to build:** 把「插件需要的技能都装上了」「MiniMax-cn 这类模型都配好了」变成可证伪检查。技能：按声明（名单 + 期望数量，两者必须自洽）比对宿主实际注册集合，默认走文件树枚举（六个根 × 已知 rank），不拿「模型可见技能数」当判据；随包技能目录要自洽（frontmatter name == 目录名，缺 frontmatter 单独报）。模型：比对默认模型条目的 provider+model、provider 条目的凭据引用名、引用方（如 vision 路由）的 model id 是否逐字一致；凭据不可得记 `blocked`（说明缺什么、可去哪补），不记 `fail`；密钥值永不进日志、回执、证据。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 故意删一个技能 / 改一个技能目录名 → 检查必须变红，且报出是哪一个
- [ ] 16 个隐藏技能的场景下不会误判（不得用模型可见数量断言）
- [ ] 模型 id 与声明不一致（历史上的 404/UNKNOWN_MODEL 情形）→ 检查变红并指出两处字面差异
- [ ] 凭据缺失 → `blocked` + 可执行 hint；全部产物 grep 不到密钥值

# 03: self-check：技能与模型





## 进度
