<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 02 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-c21ba0fc-5978444 -->
<!-- DSH-CREATED: 2026-11-01T11:43:04.004Z -->
# 03: 03 self-check：技能与模型

**What to build:** 把「插件需要的技能都装上了」「MiniMax-cn 这类模型都配好了」变成可证伪检查。技能：按声明（名单 + 期望数量，两者必须自洽）比对宿主实际注册集合，默认走文件树枚举（六个根 × 已知 rank），不拿「模型可见技能数」当判据；随包技能目录要自洽（frontmatter name == 目录名，缺 frontmatter 单独报）。模型：比对默认模型条目的 provider+model、provider 条目的凭据引用名、引用方（如 vision 路由）的 model id 是否逐字一致；凭据不可得记 `blocked`（说明缺什么、可去哪补），不记 `fail`；密钥值永不进日志、回执、证据。

**Blocked by:** 02

**Status:** resolved

- [ ] 故意删一个技能 / 改一个技能目录名 → 检查必须变红，且报出是哪一个
- [ ] 16 个隐藏技能的场景下不会误判（不得用模型可见数量断言）
- [ ] 模型 id 与声明不一致（历史上的 404/UNKNOWN_MODEL 情形）→ 检查变红并指出两处字面差异
- [ ] 凭据缺失 → `blocked` + 可执行 hint；全部产物 grep 不到密钥值



## Comments

### local — 2026-11-01T14:50:27.882Z
实现完成并复核（提交 e5a438c，集成分支 feat/real-machine-verification）。

交付：
- 三个 hard 检查接入内置 self-check 序列（位于 package-installed 之后、screen-present 之前）：skills-set / model-configured / model-credential。
- 技能集合判定只用文件树+frontmatter：仓库随包目录与安装副本两份比对；声明名单与期望数量自洽（expectedCount≠names 直接 invalid-input 变红）；宿主六根 rank 100/200/300/400/500/600 观测（custom 只读不可知记 note；user-dsh 跳过 .system），按 name 合并保留最小 rank、冲突记 note，非 bundled 来源不参与 extra；不使用模型可见技能目录计数（证据 modelCatalogUsed:false）。
- 安装副本技能目录路径回退：声明路径→包根同名；找不到记 blocked 并 hint（可能是该包本来不带技能，应设 bundledSkills:false）。
- frontmatter name 与目录不符、目录缺 frontmatter name 一律 fail 并点名目录（宿主静默跳过情形）；平铺无 frontmatter 的 .md（README/LICENSE 等说明文档）记 ignored，不计技能集合，避免真机绿样本假红——依据：真实 matt 包 bundled-skills 顶层确实有说明文档。
- model-configured 只读 profile 补丁文件；缺条目类（只读无法判断 bundle 层）记 blocked 并给两条出路；不一致类 fail，expected/actual 同写两处 provider/model/apiKeyEnv 字面值，hint dsh-verify model --fix。
- model-credential 解析顺序：批次 home（self-check 无实例，记不适用）→ 真实 home 的 .credentials.yaml 顶层 refs 键名（只读名字，绝不读值）→ 进程环境；命中 pass 报来源，全缺 blocked+hint；证据只有 apiKeyEnv/sources/valueRead:false。canary 验证产物 0 命中。

验证（Lead 独立复跑）：typecheck exit 0；npm test 45 passed|1 skipped files / 600 passed|6 skipped；npm run build 六入口 ok；describe --json commands=15 checks=20 fields=13。真机冒烟（impl 报告，D:/Temp/rmv-smoke）：27+27 技能绿样本 exit 0；删 tdd exit 1 点名；改目录名 exit 1 点名；模型不一致 exit 1 两处字面值同现；真实 web profile 缺 llm-pi-ai 时 model-configured blocked exit 2 且凭据 pass；canary 0 命中。

### local — 2026-11-01T14:50:34.430Z
票 03 全部验收项通过并已提交 e5a438c





## 进度

- 进度：100%（2026-11-01T22:50:23+08:00）：实现并复核完成：skills-set / model-configured / model-credential 接入 self-check；真机反例与 canary 通过；typecheck 0、npm test 600 passed/6 skipped、build 六入口 ok；提交 e5a438c
