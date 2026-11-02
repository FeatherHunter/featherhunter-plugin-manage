<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 真机验证能力：base 库通用能力（一次性全量交付） -->
<!-- DSH-STATUS: closed -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-a9ecc07d-5978442 -->
<!-- DSH-CREATED: 2026-11-01T11:30:55.317Z -->

## Problem Statement

作为插件维护者，我们现在的真机验证是「一次性手工作坊」：

- matt 插件仓里有一套 43 个 `.mts`、约 1.2 万行的真机脚本，绑定在某一台机器的安装路径、某个固定 profile、某些中文界面文案上；另外四个插件仓几乎没有等价物。协议靠复制同步，抄漏一处时验证会**静默跳过**（假绿），这正是五仓漂移的病根。
- 作为评审者，看到「1.9.0 真机通过」无法复核：不知道是哪个提交、哪个包（sha256）、哪台机器、哪份模型/技能配置。2026-10 已经出现过证据被重跑覆盖、手改证据副本、窄窗机器证据丢失的事故。
- 作为 AI agent，想现场验证一条新场景，只能去改插件仓的脚本（等于每次都在改产品代码），或者手工敲一长串命令；结论留在终端里，变成不了可复核的证据。
- 「插件装好了」「技能都在」「MiniMax-cn 配好了」三件事目前没有权威判据：数模型可见技能会漏掉 16 个隐藏技能；`--dump-config` 不是只读命令；凭据来源（批次 home / 真实 home / 进程环境）说不清；`/api/<channel>/<endpoint>` 这类接口理解是错的，会直接把请求打到宿主的 throw 分支上。

本规格要解决的是：**把「怎么验证」收敛成 base 库的一份通用能力，把「验证什么」留给各插件仓的一行声明**，让五个仓（以及以后的新插件）同一套代码、同一套证据、同一套门禁；改一处，到处生效。

## Solution

在 base 库新增一个**完全自包含**的「真机验证」能力，一次性全量交付：

- **核心零依赖**：只用 Node 内建；浏览器、票面协议等插件形状的东西通过端口注入，缺省时相关检查记 `blocked`，绝不记 `fail`。
- **接入成本一份声明**：插件仓写一份约 25 行的 `verify/profile.ts`（包名、默认 profile、客户端入口、插件缓存目录、插件设置目录、技能期望、模型期望、构建命令、环境白名单、可选钩子），加两条 npm script（只读自检 / 起实例验收）；`dsh-verify` 由已有 devDependency 提供，零新增安装。
- **能力对任意 profile 生效**：默认 `web`，可自由指定任意 profile 名，不绑定某个插件或某台机器。
- **三层可选择性**：L1 预置命令（自检、单实例、并发、冻结、批次、证据、清理），L2 原语（启动/停止/隔离探测/模型/安装/技能/日志/证据/检查/步骤）供 agent 任意组合，L3 逃逸舱（实例句柄、页面句柄、自定义步骤与检查、插件仓自写场景文件）保证封装边界能被打穿。
- **每个结论都可证伪**：批次身份行（批次名 + 40 位提交 + 64 位包 sha256）、基线行（ref + tip + 目标版本）、候选判定、新鲜度双判据、证据绑定三重比对；证据不可变、可归档、可校验。
- **接口是契约**：命令 id 与内置检查 id 稳定，改 id 等于改接口；输出 `ok|fail/blocked/skip` 行、`--json` 一段 JSON、退出码 0/1/2（2 = 受阻/待人工确认），人类文案写「期望 vs 实际 + hint」。
- **文档即入口**：一个只读 README 的新插件仓能自己完成接入并跑通只读自检，全程不问人；验收方式是独立 agent 只拿 README 在陌生仓执行，凡需提问处记为文档缺陷。

## User Stories

1. 作为插件维护者，我想只写一份约 25 行的声明就能接入真机验证，以便不必再复制一整套脚本。
2. 作为插件维护者，我想在任意 profile（默认 web）上验证，以便同一能力覆盖桌面端与隔离实例。
3. 作为插件维护者，我想用一条只读、约 5 秒的自检命令在提交前跑，以便早发现装配问题。
4. 作为插件维护者，我想用一条起点、跑场景、收证据的验收命令在发版前跑，以便一次拿到结论。
5. 作为插件维护者，我想冻结「候选」（提交、版本、包哈希、文件清单、构建提交、源码稳定性），以便任何结论都能被第三方复核。
6. 作为插件维护者，我想开批次并记录基线，以便事后知道这批结论验证的是哪份代码。
7. 作为插件维护者，我想在基线已前进或 HEAD 已移动时自动判「批次失效」，以便不误信旧结论。
8. 作为插件维护者，我想证据不可变、可归档、可逐文件校验，以便复盘时拿到「测量当刻的原件」。
9. 作为插件维护者，我想一条命令并发起 N 个隔离实例，以便验证多实例相关功能。
10. 作为插件维护者，我想断言每个实例的端口、DSH_HOME、启动目录、插件日志目录两两不同，以便证明隔离不是口头承诺。
11. 作为插件维护者，我想探针证明隔离实例不会写进我真实的插件设置文件，以便跑验证不污染开发环境。
12. 作为插件维护者，我想验证「插件已安装，且版本与包内文件哈希都对得上候选清单」。
13. 作为插件维护者，我想验证「声明/随包发行的技能集合恰好被宿主注册」，并且不被「模型可见技能数」误导。
14. 作为插件维护者，我想验证模型配置（provider、model id、凭据引用名、模型目录）逐字一致，且密钥值永不进日志/回执/证据。
15. 作为插件维护者，我想用 API key 直连型模型（如 MiniMax-cn）做真机验证，以便不依赖账号登录态。
16. 作为插件维护者，我想在配置不一致时用 `--fix` 只修可修项（补 provider 条目、对齐 model id、补凭据引用），且默认只读。
17. 作为插件维护者，我想清理命令只报账、不猜着删，以便工作根不会失控也不会误删。
18. 作为 AI agent，我想不改 base 源码、只新增场景文件就能表达任意验证，以便现场发挥。
19. 作为 AI agent，我想通过库 API 组合原语而不是被迫走固定命令，以便实现未预置的场景。
20. 作为 AI agent，我想在启动前用 dry-run 看到真实会执行的启动计划（argv、环境变量名、日志落点、模型来源），以便不盲跑。
21. 作为 AI agent，我想拿到机器可读的 JSON 与稳定退出码，以便自动判断成功/失败/受阻。
22. 作为 AI agent，我想在浏览器适配器缺失时得到 `blocked` 而不是 `fail`，以便区分「环境不支持」和「真有问题」。
23. 作为新插件的开发者，我想只读 README 就完成接入并跑通自检，以便不依赖口头传授。
24. 作为新插件的开发者，我想打包白名单最多只多一行，验证文件不进发布包，以便接入成本可接受。
25. 作为评审者，我想看到带「批次名 + 提交 + 包 sha256」的身份行，以便在票面/发布检查里复核结论。
26. 作为评审者，我想发布前门禁自动拦住「清单票未关闭、身份行缺失或与候选不符、候选不是发布提交祖先且无差异审计」。
27. 作为评审者，我想每条失败都说清「期望 vs 实际」并给可执行 hint，以便不必追问实现者。
28. 作为评审者，我想 `blocked` 与 `fail` 严格分开，以便缺适配器时不会长期假红、真问题时不会静默绿。
29. 作为跨平台维护者，我想 Windows/macOS/Linux 同一套代码（Windows 优先），以便不同机器结论可比。
30. 作为工具维护者，我想命令 id 与检查 id 是稳定契约，以便门禁与票面评论能按 id 引用。
31. 作为工具维护者，我想本能力与其他功能在目录与入口上完全解耦，以便单独演进、不牵连 base 其它部分。
32. 作为将来的第三方插件作者，我想这套接入方式不依赖本仓五仓，以便外部插件也能照做。

## Implementation Decisions

**能力归属与边界**
- 能力核心归 base 包，负责「怎么验证」：契约（结果/身份/证据/检查/启动计划/候选/批次/技能/模型/场景/端口）、纯规则、编排、DSH 运行控制、证据与报告、CLI。
- 使用方（插件仓）负责「验证什么」：一份声明 + 可选场景文件 + 可选适配器（浏览器、票面、发布前检查）。票面协议**不进零依赖核心**，放在适配器层。
- 能力目录与入口自包含：独立导出子路径与独立 bin，不 import base 的 core/client 模块，其它功能也不 import 它。

**端口与依赖**
- 全部副作用收在端口接口后：文件系统、命令、进程、HTTP、时钟、环境、屏幕、浏览器；核心只用 Node 内建，构建期强制校验「非相对 import 必须以 `node:` 开头」「自包含 bundle 不许有 import/require/动态 import」。
- 浏览器端口由插件仓注入；未注入时页面相关检查 `blocked`。
- 父进程环境不得整体下传：子进程只收白名单 + 声明值 + 解析出的模型密钥（最后注入、同名覆盖）；密钥值只进子进程环境，不落任何文件/回执/JSON。

**命令表面与可选择性（三层）**
- L1：`self-check`、`single-instance`、`concurrent`、`freeze`、`batch`、`evidence`、`run`、`cleanup`、`describe`。
- L2 原语：`launch`、`stop`、`isolation`、`model`、`install`、`skills`。
- L3 逃逸舱：实例句柄（页面/原始进程）、运行时步骤钩子、自定义检查、插件仓自写场景文件。
- 全部命令支持 `--json` 与 `--dry-run`（写操作类），并共享一套「计划 → 执行 → 报告」骨架：计划是纯函数，dry-run 打印计划即真实执行的同一份结论。
- 扩展性判据：拿现存的 10 条真机命令做对照，至少 8 条必须零改核心即可表达；否则记为扩展性缺陷。

**事实的权威通道（依据宿主调研，含纠错）**
- 本地 HTTP API 只有**单通道**：`POST /api/<endpoint>`；`settings`/`skills`/`llm`/`pluginManager`/`pluginInventory`/`session` 只是 endpoint 首段，不存在多通道写法。请求体字段为 `payload`，`method` 必须与 URL endpoint 逐字相同；数据在 `body.result.value`；失败常为 HTTP 200 + `result.ok:false`；未带会话 cookie 一律 401。
- 会话建立：`GET /connect?token=…&interactions=none` 换 cookie；token 来自启动 stdout 那一行 `dsh web: http://127.0.0.1:<port>/?token=<43>`。
- ready 判据两条并用：该行本身（宿主在 loader 完成与启动审计通过后才打印）+ `pluginInventory/list` 的 `fiberPhase` 全 active；端口监听、日志行都不算 ready。
- 插件版本/加载态：`pluginManager/listBundles`、`pluginManager/listPlugins`、`pluginInventory/list`；包内文件 sha256 只能读磁盘（`profiles/<profile>/node_modules/<pkg>/…`）。
- 模型：`session/modelCatalog`、`settings/describe`、`credentials/describe`（只取引用名与是否可用，不取密钥值）、`session/list` 的模型投影；不碰密钥文件内容。
- 技能：HTTP 的 `skills/list` 只给用户可调用子集且丢 source/rank，**不得**用作「技能都装上了」的判据。权威判据二选一：默认按文件树枚举（六个根 × 已知 rank 100/200/300/400/500/600），可选由插件自开只读端点走 `ctx.skills.snapshot()` 拿完整清单；「模型可见技能数」只允许作为注记，不能作为断言。
- `--dump-config` 不是只读（会新建 profile 并重写 cordis.yml），不得列入只读证据通道。
- 启动进程的事实：独立 `DSH_HOME`、独立 `USERPROFILE`/`HOME`、独立启动目录（三者缺一不可）；进程以 detached 方式启动并写 `instance.json` 作为后续命令的句柄；停止要杀进程树，杀完要验证已消失。

**结果语义与退出码**
- 检查四态：`pass` / `fail` / `skip` / `blocked`；`blocked` 必须携带缺什么（结构化原因：缺适配器 / 缺前置 / 平台不支持），不得退化成 `fail`，也不得暗记 `pass`。
- 退出码：0 = 全过（允许 skip），1 = 硬失败，2 = 受阻（需人工确认）。跳过（skip）不计失败但必须在报告里可见。
- 人类输出一行一条：`ok|fail|skip|blocked <检查 id> <说明>`；失败行必须带 `expected` 与 `actual`；JSON 报告单段输出到 stdout，进度走 stderr。

**身份、候选与批次（可证伪性的核心）**
- 身份行与基线行是**逐字 wire format**（生成与解析互为逆运算，改动即视为不兼容）：身份行 = `- 验证身份：批次 <批次名>；候选提交 <40位小写hex>；候选包 sha256 <64位小写hex>`；基线行 = `- 验证基线：本地 <ref> <tip>；目标版本 <version>`。
- 文件摘要算法固定：先拒绝反斜杠路径与坏 sha；按 path 做 UTF-16 code unit 排序；每行 `<sha256>  <path>`；换行 join；整体 sha256；**无尾换行、不做路径归一化**（历史 digest 的兼容边界）。
- 候选 = 提交 + 版本 + 包绝对路径 + 包 sha256 + 文件清单 + 文件摘要 + manifest 摘要 + 构建提交 + 源码稳定性 + 有效性（release/development）。判定顺序固定（先根因后衍生）：不在批次目录 → 早于批次 → HEAD 不一致 → 产物构建提交不一致 → 源码不稳定 → 基线包含关系未判定/不成立 → 版本与基线不等 → 包缺失/哈希不符 → 文件摘要重算不符。
- 新鲜度双判据：HEAD 未移动 **且** 基线 ref 当前 tip 未前进；基线不可读 ≠ 未前进（判失效）；显式允许过期基线时必须在报告里注明。
- 证据绑定三重比对：批次名、提交、候选 manifest sha256；任一不符则该证据不得进入统计。
- 批次记录 schema 版本化；旧记录缺少基线字段归一为「无基线」这一显式状态，而不是被悄悄当作不检查。

**证据**
- 证据项统一形状：类型（文本/JSON/截图/日志切片/命令/文件）+ 相对路径（`/` 分隔）+ 字节数 + sha256 + 采集时间 + 备注；同名文件加序号后缀，绝不覆盖。
- 证据清单的 `candidate` 只能由命令层从批次记录注入，不能被 `--extra` 覆盖。
- 归档：整批复制到归档根下的 `<批次名>-<时间戳>/`，附按路径排序的 `SHA256SUMS.txt`，并提供可校验命令；归档与摘要文件的关系（是否含尾换行）必须写死。
- 更正只许写旁注文件，绝不改原件。

**隔离与写盘安全**
- 写盘只允许：工作根、系统临时目录、显式允许目录；真实 DSH home 对工具**只读**（启动前解析真实路径做比对，拒绝落在真实 home 内的目标）。
- 删除必须过防呆：拒绝盘符根、用户 home、当前工作目录、层级过浅的路径；未知类别目录只报账不删；清理默认 dry-run，必须显式确认才删。
- 隔离探针必须**执行**：用重定向环境起一个子进程，让它解析自己的 home、写读标记；同时比较开发者真实插件设置文件前后哈希，三件事全成立才算通过。

**模型配置**
- 模型配置 = 某 profile 的补丁文件；工具只做**最小编辑**：设置默认模型条目的 provider/model（并删除 provider 专属字段）、在 provider 插件条目里补齐凭据引用名与模型条目；已符合时不写盘（幂等）；不存在的插件条目/默认模型条目一律拒绝而不是凭空创建。
- 凭据解析顺序固定：批次 home 的凭据存储 → 真实 home 的凭据存储 → 当前进程环境；只在子进程环境里出现值，报告只给来源与是否可用。
- 配置比对规则：默认模型条目的 provider+model、provider 条目的凭据引用名、模型条目 id 存在性；对 vision 路由等「引用方」的 model id 必须与声明逐字一致（历史上的 404/UNKNOWN_MODEL 就是这样来的）。

**技能**
- 声明 = 技能名集合 + 期望数量；两个字段必须互相自洽（数量与名单不符直接拒绝，防止掉一个静默通过）。
- 比较规则：缺失即失败；多出的只有 `source=bundled` 才算多余；registry 重复也失败；宿主其它来源的技能不参与判断。
- 随包目录自洽检查：frontmatter `name` 必须等于目录名（不等时宿主会静默跳过），另报缺 frontmatter 的目录。

**安装与打包**
- 默认「解包覆盖」安装（跨盘时 pnpm 硬链接会失败），CLI 安装仅在包与 home 同盘时可用；两种方式都要在安装后核对：版本、客户端入口 sha256、版本常量、候选文件清单逐项一致。
- 接口校验：界面/客户端版本常量与插件名必须出现，但**不得**把宿主合成的多客户端响应整体哈希当身份。

**官方契约与文档**
- 命令 id、检查 id、profile 字段、退出码、`ok|fail` 行格式是契约，集中在一处描述，CLI 帮助与文档从同一处生成（避免文档与实现漂移）。
- README 必须自足：安装 → 写声明 → 两条 script → 跑自检 → 读报告 → 常见失败处理；配一个「agent 使用说明」，讲清 L1/L2/L3 与 0 改核心写场景的边界。
- 五仓接入形态：一份声明 + 两条 script + 打包白名单 0–1 行（有 `files` 白名单的仓无需改动打包；无白名单的仓需加一行排除或补白名单）。
- matt 仓迁移：删掉被替代的通用脚本（预估 >85% 真机代码），只保留插件特有场景。

## Testing Decisions

**什么算好测试**
- 只测外部行为：命令的 stdout JSON 形状、退出码、工作根下的产物（instance/batch/evidence/stopped）、stderr 的人类进度；不断言内部函数或私有字段，重构不应让测试变红。
- 每条断言都要能回答「凭什么」：写清来源（哪个检查 id、哪份计划、哪条文件）；禁止「跑完没报错就算过」。
- 每个门禁自带反例（negative）：故意破坏一个前提，断言它必须变红；证明门禁有牙齿，而不是恒绿。
- 时间、随机、网络、浏览器一律由注入端口替代，测试不得依赖本机状态（真实 home、真实凭据、真实屏幕、真实安装路径）。

**Seam（已与用户确认：A + B）**
- Seam A（主，沿用本仓既有先例——`doctor` 那套）：能力的进程内 CLI 入口。测试直接调用入口函数、捕获 stdout/stderr、取退出码，断言 JSON/产物；真实现与测试替身通过端口注入切换，命令代码零改动。
- Seam B（接入 seam，唯一新增）：插件仓的声明文件经 `defineVerificationProfile()` 校验。用假插件仓验证：声明非法时拒绝并给可执行 hint；只有 README 的独立 agent 能完成接入并跑通自检（凡提问/猜测处记为文档缺陷）。
- 不新增第三条 seam：身份行、候选判定、批次新鲜度、技能比较、模型配置编辑这些纯规则**不单独开洞**，它们只经由 Seam A 的外部行为被覆盖。

**覆盖矩阵（必测）**
- 正例：单实例自检全绿；两实例并发隔离断言全绿；冻结 → 开批 → 收证据 → 报告身份行一致。
- 反例：候选提交 ≠ HEAD；候选包被替换（哈希不符）；基线前进；证据来自另一批次；技能少一个；技能 frontmatter name ≠ 目录名；模型 id 与声明不一致；凭据缺失（应为 blocked 而非 fail）；未注入浏览器（应为 blocked）；实例提前退出（要报 stderr 尾部而不是干等超时）；孤儿进程未清理；日志零事件；清理遇到未知目录只报账。
- 边界：0 实例、1 实例、N 实例；端口由系统分配；同秒两次归档；CRLF 补丁文件；空技能集；超长批次名（合法性校验）。

**先例**
- 本仓 `doctor` 的测试形态（进程内调 CLI + 捕获输出 + 假仓库夹具）就是 Seam A 的先例；假仓库/假 manifest 的夹具写法可复用。
- matt 仓现有的「门禁走进程接口 + 每条门禁带 `--negative`」是可借鉴的方法论，但其进程夹具不应移植（我们不再起真进程做主 seam）。

## Out of Scope

- 五个插件仓的具体改造与提交（本规格只定接入形态；执行由实施票拆分）。
- matt 仓旧脚本的逐文件删除顺序与 PR 编排。
- 插件特有的界面断言（Dock 宽度、弹窗文案、全屏判定等）——它们属于插件仓的场景与浏览器适配器。
- 票面协议（GitLab/GitHub 评论解析、发布前检查脚本）的具体实现——属适配器层，另有规格。
- macOS/Linux 的实机验收（本版保证端口抽象与同一套代码，Windows 优先验收）。
- 性能优化、并行度调优、缓存策略。
- 外部插件市场/第三方发布流程。

## Further Notes

- 三条一手依据：`docs/DSH宿主可观测面-真机验证调研.md`（宿主通道与纠错，每条带 file:line）、`docs/dsh-web-profile-真机验证环境调研.md`（profile/端口/token/重装语义）、`docs/五仓发布与真机验证现状调研.md`（五仓差距与发布目录差异）；matt 旧实现的第一性原理复盘在 `docs/matt-真机验证-第一性原理复盘.md`。
- 已冻结的 contracts 原型可作为规则层参照（候选判定、新鲜度、身份行、技能比较、模型 patch 编辑），但**不作为交付物**；实现时允许重构，接口保持不变。
- 两个待实施时确认的点（实施时已定）：①技能完整清单走文件树枚举（六个根 × rank 100/200/300/400/500/600），插件端点只作为可选补充，见 `docs/adr/0002-real-machine-verification-as-built.md` 决定 9；②批次 work root 默认仓库内 `.scratch/verify`，已被五仓 `.gitignore` 覆盖，也可用 `--work-root` 指到系统临时目录。
- 历史教训要写进门禁：2026-10-29 用 setViewportSize 假装全屏导致误判产品缺陷；批次重跑覆盖证据；手改证据副本导致「原件」不存在；同版本重装是静默 no-op（必须先 remove 再 add）。

## Comments

### local — 2026-11-02T07:32:05.949Z
# 真机验证能力：base 库通用能力（一次性全量交付）

核对日期：2026-11-02。核对人：Lead（单上下文）。规格：`.scratch/真机验证能力-base-库通用能力-一次性全量交付/spec.md`。实施票 01–22 已全部关闭，本评论做收口核对；关闭动作与评论在同一次调用完成。

## 0. 四条件结论

1. **规格承诺逐条实现/测试，削减已确认**：见第 3 节（22/22 票逐张）与第 4 节（32/32 用户故事逐条）；未做项与理由见第 5 节，均属规格 Out of Scope 或已记 ADR-0002。
2. **改动在长期分支**：base 仓 `main` 已有交付提交 `db2a16c265ba222ac45c009377931e2f5b0a7fe1`（远端 origin/main 同提交）；本次能力从 `4b8d96f` 起经 `d1a81ba` 快进合入 main。五仓改动均在各自默认分支（prompt/palette/matt 的 main、im/ilife 的 master）并与 origin 同步。
3. **评论写下的提交上检查可复现全绿**：第 2 节列出干净 worktree 上 npm ci/build/typecheck/vitest/docs:check 的逐条命令与退出码，工作树 status 为空。
4. **遗留已处置**：第 6 节逐项给出归属；唯一需要工程跟进的一项（已发布插件包内联旧 base）由 rollout 规格票 14 承接。

## 1. 交付证明

- **能力代码位置**：`packages/base/src/real-machine-verification/`（contracts/、orchestration/、orchestration/checks/、runtime/、adapters/browser/、evidence/、cli/、cli/commands/、tests/），能力以独立子路径 `./real-machine-verification` 与 bin `dsh-verify` 提供。
- **交付提交**：base `db2a16c265ba222ac45c009377931e2f5b0a7fe1`（`main`，origin 同步；`feat/real-machine-verification` 同提交，保留作外部复核引用）。其上一提交 `d1a81ba4fa1de87d15a245ba9b147dd548d15a2e`。「chore(deck): 收口票 20–22 与规格进度（真机验证能力）」为票面记账提交（7 files +436/−4）。
- **发布物**：npm `dsh-featherhunter-plugin-base@0.1.7`（latest；207 files / 793.4 kB；shasum `8de03dd147d86d31949b24d1938271d15c03c80d`；integrity `sha512-1jCq/PshSnwQ5TKCEJKciqYiB9f2wwPJ6J+jKg+PmevSvlesHdv30S79GbIFiTjSYmm9suIhkVrpGEArp+GTbQ==`）。解包校验含 `findWriteUnderRealHome`、`base-version-unreadable`、`allowOutdatedBase`、`prepareHome`、`runReleaseGate`。
- **五仓接入提交（均已推送 origin、工作树无本任务改动）**：
  - dsh-prompt：`main` `5b3a402c8e47620028781673a52b134121fc6618`
  - dsh-opencode-palette：`main` `b1d12433d2f51051f4e205f1ba5190dc4d49c00f`
  - dsh-im-companion：`master` `f4c38eb`（本次重建 .git 后提交并推送）
  - ilife：`master` `59d32ae4145a2f7324321a8096759b9c83785e17`
  - dsh-mattpocock-skills-deck：`main` `47da8093bb84bc9886c37c38b68e1aa8362feef3`（另含迁移提交 `926e4199`、`ee7df187`）
  - 五仓 devDependencies 均为精确 `"0.1.7"`（非 file:/link:），node_modules 为注册表真实安装；package-lock / pnpm-lock 的 resolved 指向 registry 0.1.7 tarball。
- **matt 迁移净减（票 13 更正口径）**：删旧通用真机台 41 文件 9,591 行；新增/改写 verify/ 与门禁、文档 4,461 行；净 **−5,959 行**。旧台保留 15 文件 4,392 行，全部被引用（票 13 评论列了逐个引用点）。

## 2. 检查命令与结果（在 `db2a16c` 的干净 worktree 上）

做法：`git worktree add --detach <tmp> db2a16c`，在 `<tmp>/packages/base` 下依次执行；跑完删除 worktree（当前 `git worktree list` 只剩主工作树）。

| 命令 | 结果 |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run build` | exit 0（六入口 core/client/node/node-cli/rmv-index/rmv-cli + docs 生成） |
| `npm run typecheck` | exit 0 |
| `npx vitest run` | exit 0：**Test Files 70 passed \| 1 skipped (71)**；**Tests 1003 passed \| 6 skipped (1009)** |
| `npm run docs:check` | exit 0：`docs ok: README.md and AGENTS-USAGE.md match describe` |
| `git status --porcelain` | 空 |

补充实测（同提交构建的 dist）：
- `node dist/real-machine-verification/cli/main.js --version` → `0.1.7` / `capability real-machine-verification (schema 1)`
- `... describe --json` → schemaVersion=1、commands=15、profileFields=15、builtInChecks=22
- matt `npm test`（0.1.7 安装后，提交 47da8093 时）：exit 0，84 条 GATE-RESULT 全部 failed:0（合计 9,094 条断言），verify-chain 5 条全绿。
- 五仓 self-check（只读、真实 home）：prompt / palette / im / ilife 均 `5 pass, 0 fail, 3 skip, 0 blocked`；matt `11 pass, 0 fail, 2 skip`。

## 3. 逐票核对（22/22）

- **01 能力骨架与 describe**：`cli/capability-description.ts`（15 命令、22 个内置检查 id、15 个 profile 字段、全局/命令 flag）；`describe --json` 实测如上。测试 `tests/capability-description.test.ts`（含「广告的 check id 必须在源码 emit」「字面量 `checkId(...)` 必须被广告」双向门禁）、`tests/architecture.test.ts`（自包含 / 无插件常量 / 目录解耦三门禁）、`tests/self-contained.test.ts`、`tests/cli-entry.test.ts`。
- **02 self-check 运行时与装配**：`cli/commands/self-check.ts`、`orchestration/self-check.ts`、`orchestration/checks/`（dsh-runtime、node-version、profile-declaration、profile-present 等）；四态与退出码 0/1/2。测试 `tests/self-check-cli.test.ts`（参数错误、--json 形状、blocked/skip、全局参数错误 stage usage）、`tests/self-check-report.test.ts`、`tests/contracts-core.test.ts`。
- **03 self-check 技能与模型**：`orchestration/checks/skills-set.ts`、`skills-observation.ts`、`model-configured.ts`、`model-credential.ts`、`contracts/skills-rules.ts`、`contracts/model-rules.ts`；技能集合只用文件树六根 × rank 100–600 判断，不用模型可见数；缺失即失败（不被宿主其它根掩盖，对抗审计修复项）。测试 `tests/self-check-skills-model.test.ts`、`tests/skills-observation.test.ts`、`tests/skills.test.ts`、`tests/model-credentials.test.ts`、`tests/credential-store.test.ts`。
- **04 启动与停止隔离实例**：`orchestration/instance.ts`、`primitives.ts`、`contracts/launch-plan.ts`、`runtime/dsh/home.ts`、`http-session.ts`；杀进程树、停止后无残留。测试 `tests/launch-cli.test.ts`、`tests/launch-orchestration.test.ts`（含 beforeStart 时机/失败）、`tests/http-session.test.ts`。
- **05 设置隔离探针**：`cli/commands/isolation.ts`、`orchestration/isolation-probe.ts`；子进程 home 落在隔离目录、真实 settings.yaml 前后 sha256 不变（真机 68fcd8f0… 不变）。测试 `tests/isolation-probe.test.ts`。
- **06 并发 N 实例**：`orchestration/concurrent.ts`；N 实例 home/dir/port/log 两两不同，teardown 干净。测试 `tests/concurrent.test.ts`；matt 真机 2/2。
- **07 证据归档与校验**：`contracts/evidence-contract.ts`、`evidence/store.ts`（含 recordFile 收编场景自写文件，对抗审计修复）、`evidence/manifest.ts`、`archive.ts`、`verify.ts`；sha256 绑定、只追加、校验命令。测试 `tests/evidence-store.test.ts`、`tests/evidence-manifest.test.ts`、`tests/evidence-archive.test.ts`。
- **08 候选冻结**：`orchestration/freeze.ts`、`cli/commands/freeze.ts`、`contracts/candidate-rules.ts`；candidate.json 含提交/版本/包 sha256/fileDigest/fileCount，dirty 默认拒绝、--allow-dirty 显式。测试 `tests/freeze.test.ts`、`tests/contracts-rules.test.ts`；真机冻结 0.1.7 候选（tgz sha256 b3749edb…）。
- **09 批次身份与新鲜度**：`orchestration/batch.ts`（两阶段 open：prepare 写批次与基线行 → seal 实测候选并写身份行）、`contracts/identity.ts`（身份行 wire format）、`contracts/batch-rules.ts`（新鲜度双判据、证据绑定三重比对）；候选九条判定顺序按 spec 实现（不在批次目录→早于批次→HEAD→构建提交→源码稳定→基线包含→版本→包缺失/哈希→文件摘要）。测试 `tests/batch.test.ts`（60 用例：ghost 候选拒收、tgz 替换/缺失、fileDigest 不符、版本/HEAD/基线不符、allow-stale 降级、status candidate-identity 漂移）、`tests/contracts-rules.test.ts`；matt-beta35/36 身份行真机产出。
- **10 模型配置修复**：`runtime/dsh/model-configurator.ts`、`cli/commands/model.ts`；默认只读，--fix 最小编辑，dry-run 预测与真跑同结论（对抗审计修复），密钥不落盘。测试 `tests/model-fix.test.ts`（18）、`tests/model-credentials.test.ts`。
- **11 浏览器适配器与页面场景**：`adapters/browser/loader.ts`、`orchestration/page-check.ts`；插件自带 Playwright 适配器，缺适配器记 blocked。测试 `tests/browser-adapter.test.ts`、`tests/page-check.test.ts`；matt ui 场景 18/18（真实页面断言 + 截图入证据）。
- **12 场景原语与 L3**：`contracts/scenario.ts`（defineScenario、钩子 beforeLaunch/prepareHome/afterLaunch、custom observations、四态）、`orchestration/primitives.ts`、`scenario-run.ts`、`cli/commands/{run,install,skills}.ts`；十条旧真机命令 ≥8 条零改核心可表达（结论见票 12）。测试 `tests/scenario.test.ts`（含 prepareHome 生效/失败阻断、证据收编）、`tests/orchestration.test.ts`。
- **13 matt 仓接入与旧脚本下线**：matt 新建 verify/（profile、browser、build、hooks、checks、scenarios/ui、scenarios/smoke、windows、presets、README、ticket-face），删旧台 41 文件 9,591 行；迁移后门禁 `tests/verify-windows.ts`（60 断言）、`tests/verify-verify-checks.ts`（67）、`tests/verify-release-gate.ts`（88）、`tests/verify-gate-map.ts` 全绿；matt `npm test` 84 门禁 0 fail。
- **14 其余四仓接入**：prompt/palette/im/ilife 各写 `verify/profile.ts`（约 25 行）+ 两条 npm script，精确钉 0.1.7；四仓 self-check 5 pass/0 fail/3 skip。提交号见第 1 节。
- **15 文档即入口验收**：第三轮独立验收（fresh 子代理、陌生副本无 .git/node_modules、零提问四步接入）记录 `docs/真机验证能力-独立验收记录-第三轮.md` 与 `D:/Temp/t15c-acceptance-report.md`；D1–D10 唯一 FAIL=D5（全局参数错误 --json 无输出）已修（提交 7c968d1，补 2 测试 + 文档句）。测试 `tests/readme.test.ts`、`tests/capability-docs.test.ts`。
- **16 发布前门禁与票面适配器**：`contracts/ticket-face.ts`、`contracts/release-gate.ts`、`orchestration/release-gate/{plan,run,report}.ts`、`adapters/ticket-face/loader.ts`（纯规则 + 适配器接口 + 门禁编排，不新增 CLI 命令）；matt 侧 `scripts/lib/release-preflight-gate.mts`（全仓唯一 import runReleaseGate）、薄 CLI `scripts/release-preflight.mts`（无 --soft）、`verify/ticket-face.mts`；两条发布路径四态同码。测试 `tests/release-gate.test.ts`、`tests/ticket-face-adapter.test.ts`、matt `tests/verify-release-gate.ts`；真机 gh 未登录演示 PREFLIGHT-BLOCKED exit2。
- **17 工作根清理**：`orchestration/cleanup.ts`、`cli/commands/cleanup.ts`、`runtime/dsh/cleanup-scan.ts`；只报账、失败不删、--keep-batches/--keep-homes。测试 `tests/cleanup.test.ts`；真机 17 条目 keep 2 / delete 15。
- **18 single-instance**：`cli/commands/single-instance.ts`、`orchestration/checks/{instance-reachable,logs-readable,teardown-clean,...}.ts`、`checks/pages`；真机 4/4。测试 `tests/single-instance.test.ts`。
- **19 写命令 dry-run 补全**：install/model/freeze/batch/cleanup/evidence 等写命令均先出计划、--dry-run 零写盘、JSON 形状稳定；launch --dry-run 输出 argv/env 名/日志/模型来源。测试分布 `tests/cli-entry.test.ts`、`tests/launch-cli.test.ts`、`tests/install.test.ts`、`tests/model-fix.test.ts`、`tests/freeze.test.ts`、`tests/batch.test.ts`、`tests/cleanup.test.ts`。
- **20 对抗审计修复收口**：提交 `a0ee9c5`（25 files +1732/−417）修六类真缺陷——候选判定接入批次流程（两阶段+九条规则实测）、真实 DSH home 写目标守卫（realPath + 包含关系 + 去 DSH_REAL_HOME 覆盖）、model 四态/dry-run 同结论、幽灵 check id 清理+emit 门禁、batch blockedReason、自定义检查四态、screen-present platform-unsupported。测试 `tests/real-home-guard.test.ts`（子目录/junction/DSH_REAL_HOME/写目标）、`tests/capability-description.test.ts`、`tests/batch.test.ts`、`tests/self-check-cli.test.ts`。
- **21 matt 两阶段批次真机复核**：刷新 matt 的 base 快照到 0.1.7、改 matt 两处流程文档（verify/README.md、docs/agents/real-machine-verification.md）；真机 7 项全 exit 0（prepare→freeze 进批次目录→seal、install、self-check、single-instance、concurrent、ui、smoke、batch status candidate-identity pass）。明细见票 21 评论。
- **22 交付收口与票面同步**：票 20/21/22 建票/更新/关闭；票 13/15/16 补审计复核评论；ADR-0002 增补决定 11 与对抗审计补记；spec.md 的 Further Notes 待定点落定 + 进度段；本评论即最终收口。

## 4. 用户故事逐条证据（32/32，spec.md:33-64）

1. 声明约 25 行 → `contracts/verification-profile.ts`（15 字段）+ 五仓 `verify/profile.ts`；`tests/contracts-profile.test.ts`、`tests/declaration-loader.test.ts`。
2. 任意 profile → 所有命令支持 `--profile`；五仓实测 `--profile web`；`tests/self-check-cli.test.ts`、`tests/launch-cli.test.ts`。
3. 只读自检约 5s → `cli/commands/self-check.ts`；五仓 self-check 全部 exit 0（5 pass/3 skip；matt 11 pass/2 skip）。
4. 一条验收命令+证据 → `run` 命令 + `orchestration/scenario-run.ts`；matt ui 18/18、smoke 10/10，report sha256 落盘。
5. 冻结候选 → `freeze` 命令 + `orchestration/freeze.ts`；真机 candidate.json + tgz sha256 b3749edb…；`tests/freeze.test.ts`。
6. 开批+基线行 → `batch open` prepare + `contracts/identity.ts` baseLine；matt-beta35/36 真机输出。
7. 批次失效 → `contracts/batch-rules.ts` judgeFreshness 双判据；`tests/batch.test.ts` 新鲜度用例；matt batch status 实测 active/candidate-identity pass。
8. 证据不可变/归档/校验 → `evidence/` 四模块 + `evidence` 命令；`tests/evidence-*.test.ts`；page-check 截图 sha256 写入证据。
9. 并发 N 实例 → `orchestration/concurrent.ts`；`tests/concurrent.test.ts`；matt concurrent 2/2、4 evidence。
10. 隔离两两不同 → instances-distinct 检查；`tests/concurrent.test.ts`；matt 两实例 home/dir/log/port（54296/54297）独立。
11. 不写真实设置文件 → isolation-probe + real-home-guard；真机真实 settings.yaml sha256 前后不变（68fcd8f0…）。
12. 安装核对 → `install` 命令 + package-installed/package-files/client-entry/version；`tests/install.test.ts`；matt 685/685 文件。
13. 技能集合 → `skills-set`/`skills-observation`（六根 × rank）；`tests/skills.test.ts`、`tests/skills-observation.test.ts`。
14. 模型配置逐字比对+密钥不落盘 → model-configured/model-credential + `contracts/model-rules.ts`；`tests/model-credentials.test.ts`、`tests/credential-store.test.ts`。
15. API key 直连模型 → credential-store 解析顺序（批次 home→真实 home→进程环境）；`tests/credential-store.test.ts`、`tests/model-fix.test.ts`。
16. --fix 最小编辑默认只读 → `runtime/dsh/model-configurator.ts`、`cli/commands/model.ts`；`tests/model-fix.test.ts`（18，含 dry-run 预测与子目录 home 拒绝）。
17. 清理只报账 → `orchestration/cleanup.ts`；`tests/cleanup.test.ts`；真机 cleanup 17 条目 keep2/delete15、释放 251MB。
18. agent 只写场景文件 → `contracts/scenario.ts`、`scenario-run.ts`；`tests/scenario.test.ts`；matt verify/scenarios/{ui,smoke}.ts。
19. 库 API 组合原语 → `orchestration/primitives.ts` + `index.ts` 导出；`tests/orchestration.test.ts`、`tests/scenario.test.ts`。
20. dry-run 启动计划 → launch --dry-run 输出 argv/env 名/日志/模型来源；`tests/launch-cli.test.ts` 及各写命令 dry-run 测试。
21. JSON+稳定退出码 → 全局 `--json` 单文档、0/1/2 三码；`tests/self-check-cli.test.ts`、`tests/cli-entry.test.ts`。
22. 缺浏览器 blocked → page-check/browser-adapter；`tests/page-check.test.ts`、`tests/browser-adapter.test.ts`；四态 blockedReason 结构化。
23. README 自足 → README 五步 + 两条 npm script + 打包白名单指引；独立验收零提问记录（`docs/真机验证能力-独立验收记录-第三轮.md`、`D:/Temp/t15c-acceptance-report.md`）；`tests/readme.test.ts`、`tests/capability-docs.test.ts`。
24. 打包白名单 ≤1 行 → 五仓 files/.npmignore；matt `package/package.json` 的 files 不含 verify；说明在票 14 评论与 README。
25. 身份行 → `contracts/identity.ts` formatIdentityLine/parse；`tests/contracts-rules.test.ts`、matt `tests/verify-1766-release-audit.ts`；matt-beta36 身份行候选包 sha256=tgz sha（b3749edb…）。
26. 发布门禁 → contracts/release-gate + orchestration/release-gate/*；`tests/release-gate.test.ts`；matt verify-release-gate 88 断言、PREFLIGHT-BLOCKED 真机演示。
27. 失败给 expected/actual+hint → `contracts/check.ts` + CLI 渲染；`tests/self-check-cli.test.ts`、`tests/batch.test.ts`、`tests/cleanup.test.ts`。
28. blocked≠fail 结构化 → BlockedReason 三码（adapter-missing/prerequisite-missing/platform-unsupported）；`tests/self-check-cli.test.ts`、`tests/capability-description.test.ts`、screen-present 断言。
29. Windows 优先同套代码 → `runtime/platform/` + ports；Windows 真机全链路运行如上；macOS/Linux 实机验收按规格 Out of Scope 未做。
30. 命令/检查 id 契约 → `cli/capability-description.ts` 22 条广告 id + 双向 emit 门禁（`tests/capability-description.test.ts`）。
31. 目录入口解耦 → 独立子路径/bin；`tests/architecture.test.ts`（三门禁）、`tests/self-contained.test.ts`。
32. 第三方插件可照做 → 通用 profile + README；五仓只是示例；第三轮陌生仓独立验收即外部视角证据。

## 5. 规格中削减/未做项（按规格原文或已确认）

- **五仓具体改造与提交**：spec Out of Scope，但本次按用户后续指令**已实际完成**（第 1 节提交）。
- **票面协议具体实现**：spec 要求属适配器层；base 只交付纯规则 + 适配器接口 + 门禁编排（不新增 CLI 命令），matt 侧 gh 适配器落地——符合规格，非削减。
- **插件特有界面断言**：base 只提供浏览器适配器接口与页面检查原语，具体断言由插件仓场景持有（matt ui 场景）；符合规格。
- **macOS/Linux 实机验收**：Out of Scope，未做。
- **性能优化、外部插件市场**：Out of Scope，未做。
- **已知偏离（ADR-0002）**：决定 8（`/connect` 省略 interactions，spec.md:87 为调研前旧写法）；决定 9（custom 技能根只读不可观察，插件可用自定义检查补足）；决定 11（技能重复在文件树路径端到端不可达，只保留 registry 路径能力）。三者均为规格无法在只读观察面内满足的客观限制，已记 ADR 与票面。

## 6. 遗留与处置

1. **已发布插件包仍内联旧 base**（prompt 0.4.40 / deck 1.9.0-beta.33 / palette 2.1.11 / im 0.2.26 / ilife 0.3.86 等已发布版本的 client.js 是 0.1.5 时代构建；以 npm 上各包实际 latest 为准）：插件下一次发版会带 0.1.7；由 **rollout 规格 `base-package-rollout` 票 14（仍 open）** 承接，票面已记录上游状态与剩余阻塞。
2. **base 工作树未提交**：`.scratch/base-package-rollout/` 票面与 `docs/HUMAN-GATE-…`（另一规格）；用户并行 WIP（label-colors.yaml、src/node/readme-sync.ts、renderers.ts 与其测试）。均不属于本规格，留给用户/对应会话。
3. **im-companion .git 为本次重建**：重建前备份在 `D:/Temp/im-git-backup-20261102`（1748 文件），确认后可由用户删除。
4. **ilife 根 `pnpm test` 为 origin 既有缺陷**（skill-bill 测试 import 已移动的 dist 路径），非本规格引入；plugin-manager 包测试 `npm test` 434/0 全绿，本规格相关 typecheck 已修（base-ui.ts 删掉默认参数引发的 TS2769）。
5. **npm 0.1.7 包含 tests/*.d.ts**：packaging 小瑕疵（不影响运行），下版可修；未单开票。
6. **临时工作区已清理**：删除 24 个中间工作根（lead-smoke-t05…、matt-b1-work、matt-freeze、rmv-audit、t15c-obs 等）；保留被票面/证据引用的目录（matt-batches2/3/4、matt-freeze2、matt-batch-home、matt-t21、matt-ui-t21、matt-smoke-t21、matt-si5、matt-concurrent-t21、rmv-smoke、t15c-stranger、lead-batch-*、lead-freeze-repo）与 im 备份。
7. **分支**：`feat/real-machine-verification` 与 `main` 同提交（db2a16c），无独有提交；保留作外部复核引用，可随时删除。无其它未合并的本任务分支。

## 7. 结论

规格承诺的 15 命令 / 22 检查 id / 15 profile 字段 / 四态+blockedReason / 隔离 / 证据 sha256 / 批次身份 / 发布门禁 / 场景 L3 / 文档即入口 均已实现并有测试与真机证据；交付提交在长期分支 main 且干净树检查全绿；遗留均有归属且无阻塞项。收口完成。

## 进度

- 2026-11-02：实施票 01–22 全部关闭。base 0.1.7 发布到 npm（latest；shasum 8de03dd147d86d31949b24d1938271d15c03c80d），五仓 `devDependencies` 精确钉 `0.1.7` 并重建产物；matt 仓旧通用真机台删除 41 个文件 9,591 行，保留插件特有 15 个文件 4,392 行。
- 能力代码在 `packages/base/src/real-machine-verification/`（独立导出子路径与独立 bin）；接入形态为每个插件仓一份 `verify/profile.ts` + 两条 npm script。
- 交付与门禁：base 分支 `feat/real-machine-verification` 已快进合入 `main`；matt `npm test` 全链 84 条门禁全绿；五仓 `self-check` 全绿；matt 真机 11 步全绿。
- 评审与偏离：两轴 code-review（Standards + Spec）与对抗式审计的修复见票 20；偏离与已知限制见 `docs/adr/0002-real-machine-verification-as-built.md`。
