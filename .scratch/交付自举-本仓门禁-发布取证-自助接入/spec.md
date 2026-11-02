<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 交付自举：只服务 base 仓的门禁、发布取证与自助接入 -->
<!-- DSH-STATUS: closed -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-f9dc28e3-5978767 -->
<!-- DSH-CREATED: 2026-11-02T14:38:02.402Z -->

## Problem Statement

本仓（featherhunter-plugin-manage / dsh-featherhunter-plugin-base 发布仓）过去为“替五个消费仓做真机验证”建了一批运维工具与流程。边界已经改变：base 团队不再操作五个消费仓的接入与验证，五仓自助读我们发布的包与文档。留下的跨仓工具（matt 预检、六仓状态扫描、本地 dist 注入）不再有职责，却仍是维护面；而真正属于本仓的能力反而缺门禁——push / pull request 不跑任何检查，发布前靠人肉逐条敲 typecheck / vitest / docs:check / build；发布后没有自动的 tarball 取证；导航文档与作业经验只存在于一次会话复盘里，没有落进仓库。

具体痛点（来自一次 26 轮 / 约 2,799 步会话的复盘）：

- 同一套门禁手工组合了 155 次；3–4 MB 的测试日志手动读 / grep 了 23 次。
- 等待与轮询占掉大部分工具时间：等待型调用一次就是 162 秒级的空转；长命令因执行时限被截断 24 次。
- 发布依赖人工：曾把 registry 传播延迟误判成发布失败；发布物没有任何自动取证。
- 改核心真机验证代码时靠 30+ 次重复读文件找入口；导航靠记忆。
- 五仓转为自助后，“用我们的文档能不能接好”成为唯一的外部反馈面，而文档缺权威导航。

## Solution

把交付边界收敛为“只建设 base 自己”，把保留下来的 14 项能力落成仓库里的常态能力，分三层加一类规则：

1. **本仓门禁**：一个入口脚本按固定顺序跑 typecheck → tests → docs:check → 源码扫描 → build；CI 的 push / PR 触发直接调用同一个入口（不另抄一份 npm 命令）；测试日志用一条命令汇总成结构化门禁结果；新增源码 NUL / 二进制扫描。
2. **发布取证**：发布脚本保留“干净 worktree 发布 + 发布后从 registry 下载 tarball 全验”；publish workflow 在 npm publish 之后调用与本地完全相同的校验入口，不提供跳过校验的开关。
3. **自助接入与导航**：AGENTS.md 增加“改真机验证代码先读哪几份权威文档”的导航段与“本仓不再代跑五仓”的边界声明；五仓按发布包 + README / AGENTS-USAGE 自助接入。
4. **作业规则**：把等待、长命令后台化、多步操作落脚本、证据结构化四条写进 AGENTS.md；日常工具保留只提交指定路径的提交器与只读票面读取器；会话日志解压命令落进排查文档。

## User Stories

1. 作为维护者，我想要 push 和 pull request 自动跑完整门禁，这样不用在合并前手动一条条敲命令。
2. 作为维护者，我想要本地一条命令跑出与 CI 完全相同的链，这样不会出现“本地全绿、CI 红”。
3. 作为维护者，我想要 CI 失败时直接看到失败步骤的结构化结果与日志路径，这样不用翻整份构建日志。
4. 作为实现者 agent，我想要只跑门禁子集（仅类型检查、仅测试、快速模式），这样改一处代码不用等整条链。
5. 作为维护者，我想要源码里混入 NUL 字节或二进制内容时门禁直接报出文件路径，这样不用等读取工具报 binary file 才发现。
6. 作为维护者，我想要几 MB 的测试日志一条命令汇总成“门禁数 / 断言数 / 失败门禁”，这样复盘时不用 grep 半小时。
7. 作为发布执行者，我想要发布后自动从 registry 下载 tarball 校验 sha1 / sha256 / integrity / 版本 / CLI 输出 / dist 标记，这样发布是否真的成功不再靠人肉查询注册表。
8. 作为发布执行者，我想要本地发布路径与 CI 发布路径使用同一份校验代码，这样不存在“本地验得松、CI 跳过”的分叉。
9. 作为发布执行者，我想要校验失败时保留结构化证据与下载物，这样能判断是传播延迟还是真的坏包。
10. 作为发布执行者，我想要传播延迟期不被 npm pack 的 notarget 误判，这样不会把成功发布当成失败再次发布。
11. 作为维护者，我想要这些脚本在任意克隆路径与 CI runner 上都能跑，这样不依赖某台机器的绝对路径。
12. 作为五仓开发者，我想要 README / AGENTS-USAGE 里有可复制的接入与升级示例，这样不用找 base 团队就能接好。
13. 作为五仓开发者，我想要文档明确写出“base 仓不代跑五仓验证、不帮装本地 dist”，这样我不必等一个不会发生的配合。
14. 作为实现者 agent，我想要 AGENTS.md 直接指向改真机验证代码要读的权威文档与章节，这样不用重复探索找入口。
15. 作为实现者 agent，我想要等待规则写清楚“只在必须拿到对方产物时才等”，这样不在超时上空转。
16. 作为实现者 agent，我想要超过 90 秒的命令一律后台跑并 Tee 日志，这样不再被执行时限截断重跑。
17. 作为实现者 agent，我想要三步以上的操作先落成脚本、只把编排留在执行层，这样不再反复踩内联程序的语法错误。
18. 作为实现者 agent，我想要一个只提交本票路径的提交器，这样无关改动不会被顺手带进提交。
19. 作为实现者 agent，我想要只读的票面读取器在跨 effort 同号时明确报歧义，这样不会把另一张票的内容当成自己的。
20. 作为验收者，我想要导航指针、CI 调用链、发布校验链都有测试守住，这样文档与配置不会悄悄漂移。
21. 作为维护者，我想要会话日志多帧压缩包有一条可直接复制的解压命令记录在排查文档里，这样不用试错。
22. 作为维护者，我想要门禁、发布、汇总的证据统一落在被 gitignore 的临时目录且可事后读取，这样交付复核有据可查。

## Implementation Decisions

### 边界与共性

- 运维工具箱集中在仓库根的 scripts/ops 下，只服务本仓；不进 npm 发布包（发布包文件清单保持 dist / data / README / LICENSE 不变）。
- 默认仓库路径解析不再硬编码某台机器的绝对路径：由脚本自身位置向上推导仓库根，使 CI 与任意克隆位置可用；其他仓条目不再被新能力使用（本次不删）。
- 所有脚本统一 CLI 契约：--help 退出 0；--json 时 stdout 只有 JSON、人类进度走 stderr；退出码 0 成功 / 1 失败 / 2 前置错误；日志默认落被 gitignore 的临时目录。写操作必须显式（--fix / --dry-run / --keep-* 等），默认只读；任何脚本不 git push、不改 DSH 配置、不碰五仓。

### 本仓门禁

- 门禁脚本是唯一入口：步骤固定为 typecheck → tests → docs:check → scan → build；快速模式只跑前两步；支持只跑指定步骤；失败默认停在第一步（可选继续跑完全部）。
- 新增 scan 步骤：扫描本仓源码、脚本、测试、ops 工具箱与文本类文档，检测 NUL 字节与不可读文本；命中时输出文件路径列表并失败，可单独运行。
- 新增 CI workflow：push 与 pull_request 触发；Node 22；在包目录安装依赖（用包内 lockfile 做缓存）后，从仓库根调用上述门禁入口；不允许在 workflow 内另抄一遍 npm 命令，保证本地与 CI 同链。CI 不接触五仓，不需要发布 secrets。
- 日志汇总器保持只读：识别测试输出中的门禁结果行与门禁汇总行，产出 {gates, assertions, failed}；支持只列失败；输入里没有任何门禁行时按“未发现门禁”失败（exit 2），不得假成功。

### 发布取证

- 发布脚本保留两种模式：默认发布（干净 worktree → 安装 → 构建 → 发布 → 校验），以及只校验已发布版本（不建 worktree、不发布）。
- 校验内容固定为：轮询 registry → 直接下载 tarball（不用 npm pack，规避传播延迟期 notarget 误判）→ 对齐 sha1 / sha256 / sha512 integrity → 解包核对包名与版本 → 校验 dist 入口存在且含约定的四个标记 → 运行 tarball 内 CLI 校验版本行与 capability 行 → 校验随包文档存在。
- publish workflow 在发布步骤之后新增校验步骤，调用与本地完全相同的入口（只校验模式），版本号从包目录的 package.json 读取；失败让 workflow 红灯。workflow 不提供跳过校验的输入参数、开关或条件分支。
- 发布不可回滚：校验失败时的处置（deprecate 旧版本 + 修版本重发）写进发布说明；workflow 保留校验 JSON 作为证据。

### 自助接入与导航

- AGENTS.md 增加导航段，给出“改真机验证代码 → 先读哪几份文档、哪几个章节”的映射：设计文档的 CLI 表面与证据身份链两节、记录已建成形态的 ADR、面向 agent 的使用说明的证据与身份一节。指针只给路径与章节，不复制内容。
- 所有指针目标必须真实存在且章节标题匹配，由测试保证。
- AGENTS.md 增加边界声明：本仓只建设 base；五仓按发布包与 README / AGENTS-USAGE 自助接入；本仓不代跑五仓验证、不向五仓安装本地构建产物。

### 作业规则（写进 AGENTS.md）

- 等待：等待类调用只在“必须拿到对方产物才能继续”时使用；子代理或后台任务在跑时先做独立工作；完成通知会主动到达，不轮询。
- 长任务：预计超过 90 秒的命令一律后台执行，输出 Tee 到被 gitignore 的日志目录；取结果用一次等待 + 结构化汇总，不反复拉同一份输出。
- 多步操作：三步以上先落成脚本，执行层只做编排与判定。
- 证据：门禁、发布、汇总一律产出结构化 JSON，供复核与归档。
- 规则只做文档约束，不加强制 hook。

### 日常工具

- 提交器：只提交指定路径；索引里已有无关暂存时拒绝（显式参数例外）；越界路径拒绝；提交消息从文件读取（规避 PowerShell here-string 把尖括号当重定向符）。
- 票面读取器：只读解析本地 markdown 票的关键字段、进度与评论；跨 effort 同号时报告歧义并给出候选，绝不猜测；任何情况下不写票。
- 会话日志排查文档：记录多帧压缩日志的解压命令（Node 内置压缩只解第一帧，需要能跨帧解压的 Python 库），写成可直接复制的一行命令。

## Testing Decisions

- 好测试的标准：只断言外部可见行为——进程退出码、stdout JSON 结构、stderr 文案、落盘 / 提交 / 删除效果、配置文件与文档的契约（调用的入口、指向的文件与章节必须存在）；不 import 脚本内部函数、不断言内部实现细节、不 mock 脚本内部逻辑。
- 单一测试缝（已与用户确认）：全部用例放在包内测试套件的新目录（ops 域），以子进程方式调用工具箱脚本；发布校验用本地假 registry + 合成 tarball，不联网；配置与文档契约在同一套件里做文件级断言。
- 具体用例：
  - 门禁入口：--help 退出 0；未知步骤退出 2；只跑 scan 时干净树通过、含 NUL 的临时文件失败并报出路径；--json 输出可解析且步骤顺序与约定一致。
  - 日志汇总：夹具日志汇总出门禁数 / 断言数 / 失败门禁；只列失败；无门禁行与文件缺失都退出 2。
  - 发布校验：本地 HTTP 假 registry 提供 manifest 与合成 tarball（含包清单、dist 入口与标记、CLI、文档），只校验模式退出 0 且 JSON 有 dist / download / entry / cli 字段；篡改 shasum → 退出 1 且文案含 mismatch；包版本不符 → 退出 2；未发布版本（404）→ 退出 2。
  - CI 契约：workflow 触发包含 push 与 pull_request；调用的门禁入口与本地同名；Node 版本与发布 workflow 一致；不含五仓路径。
  - 发布 workflow 契约：publish 步骤之后存在调用同一校验入口的步骤；不存在跳过校验的输入或条件。
  - 文档契约：AGENTS.md 含导航段与四条作业规则；每个指针目标存在且章节标题匹配；排查文档含可复制的解压命令。
  - 提交器：临时 git 仓里只提交指定路径、无关暂存拒绝、越界路径拒绝；成功提交的文件清单只含指定文件。
  - 票面读取器：临时票面夹具读取字段 / 进度 / 评论；跨 effort 同号报歧义（退出 1 且给候选）；key 不存在退出 1、repo 不存在退出 2。
  - 扫描：干净夹具通过；含 NUL 的夹具失败并给出文件；不可读文本给出明确错误。
- 先例：发布流程的既有测试展示了“对发布决策做可注入依赖的结构化断言”的风格；CLI 测试展示了 argv → 退出码 / 输出 的断言方式；产物契约测试展示了“对交付文件做契约断言”的方式。本规格沿用这三种风格，但统一走子进程边界。

## Out of Scope

- 四项跨仓能力（matt 预检、六仓状态扫描、本地 dist 注入、matt 仓钩子接线）：本规格不处置——不删、不改、不新增依赖；它们继续存在不算错误，新能力也不得依赖它们。
- 五仓的接入、升级、真机验证执行与排障；不修改五仓任何文件、不向五仓安装本地构建产物。
- 修复 deck 票务工具的历史故障（scope 歧义、进度被整份合并改写等）；已有独立交接文档。
- 把运维工具箱放进 npm 发布包；改动 base 库的对外 API、CLI 命令表或公开契约。
- 新增 CI 之外的门禁能力：覆盖率、依赖漏洞扫描、代码签名、发布自动化（发布仍需人工触发）。
- 对作业规则做自动强制（hook / lint 规则 / 拦截）。
- 重写消费者文档结构；本次只保证现有文档的示例、命令与导航准确。

## Further Notes

- 14 项的来源与分层：本仓门禁 5 项（门禁入口、日志汇总、CI、源码扫描、发布校验共享入口）、发布取证 2 项（发布脚本、workflow 校验）、自助与导航 1 项（AGENTS 导航与边界）、作业规则 4 项（等待、长任务、多步落脚本、证据结构化）、日常工具 3 项（提交器、票面读取器、日志排查文档）。
- 五仓自助的契约是“发布包 + 文档”，因此 README / AGENTS-USAGE 的可复制正确性是交付面的一部分：生成区块由既有 docs:check 守住，手写 prose 靠评审。
- 建议实施顺序：脚本路径可移植 + 扫描步骤 + 测试骨架 → CI → 发布后校验 → AGENTS 规则与导航 + 排查文档 → 日常工具测试。先写测试并确认旧行为会红，再实现。
- 风险：CI 首跑会暴露脚本对本地绝对路径的隐含依赖（这正是本规格要修的）；registry 传播慢时校验步骤需给足超时（workflow 内显式设置）；发布后校验失败意味着包已发布，只能人工处置。
- 门禁设计的一条纪律：任何“为了让测试通过而改测试预期”的做法不接受；测试的价值在于能在旧行为上红。

## Comments

### local — 2026-11-02T17:07:40.425Z
# 规格收口：交付自举（本仓门禁、发布取证与自助接入）

规格：`.scratch/交付自举-本仓门禁-发布取证-自助接入/spec.md`（票 00）。实施票 01–10 全部 closed。
交付：仓库 `FeatherHunter/featherhunter-plugin-manage`，长期分支 `main`，验收提交 `1a6e2f65d79db514552adcb9d7080f58ef21e994`（`origin/main` 同一提交）。仓库无 PR 约定（`gh pr list --state all` 为空），按既有惯例直接推送 main。收口时另有一个只改规格/票面 markdown 的 deck 记录提交随本次关闭产生。
验收时间：2026-11-03 01:05（Asia/Shanghai）。规格无单独验收标准，口径为 10 张实施票判据之和。

## 一、逐票核对（打开票对照判据，看最终代码与测试，不只看关闭状态）

- **01 可移植性与 ops 测试骨架**（`7184482`，合入 `6c2d6ec`）：`scripts/ops/lib/common.mjs` 用 `fileURLToPath(import.meta.url)` 推出 `OPS_DIR`/`REPO_ROOT`，`DEFAULT_REPOS.base = REPO_ROOT`；新增冻结夹具 `packages/base/test/ops/support/ops-fixtures.ts`（`runOps` 子进程、临时目录/复制工具箱/写文件/git 夹具，文件头写明冻结）；`test/ops/portability.test.ts` 3 例。核对：把工具箱复制到无 `packages/base` 的临时目录运行入口→exit 2 且 stderr 指向该临时目录（旧代码 exit 0）；真实仓任意 cwd 跑 `--only docs --json` 回执 `repo`=本仓根；跨仓脚本 `--help` 全部 exit 0。
- **02 门禁源码扫描**（`13101d9`，合入 `aaa8340`）：`scripts/ops/scan-sources.mjs`（流式读、NUL 字节、`TextDecoder` fatal 判非法 UTF-8、不可读/过大，跳过 node_modules/.git/dist/.tmp/.local/.scratch 与非文本扩展）；`base-verify.mjs` 加入 scan 步骤（固定序 typecheck→tests→docs→scan→build，scan 进程内执行、summary `{scanned,issues}`）并同步 `--help` 与 `scripts/ops/README.md`；`test/ops/scan.test.ts` 10 例。核对：`node scripts/ops/base-verify.mjs --only scan` 真实仓 318 文件 0 issue exit 0；含 NUL 夹具 exit 1 并报文件路径。
- **03 日志门禁汇总钉行为**（`177dc87`，合入 `63d8e3a`）：`scripts/ops/gate-summary.mjs` 无门禁行 exit 2 并说「未发现门禁行」，坏行（JSON 坏/字段缺失/负数/非整数）exit 1 且逐条列行号与原文，`--failures-only` 只列失败，JSON 字段 `{log,bytes,gates,resultLines,totalAssertions,failed,unparsed,ok}`，只读不改日志；`test/ops/gate-summary.test.ts` 8 例。核对：旧实现 2 红（无门禁行 exit 1；坏行 exit 0 自称全绿）→ 新实现 8/8。
- **04 CI 门禁接入**（`2b12bb5`，合入 `04ee6d3`）：新增 `.github/workflows/ci.yml`（push 与 pull_request、Node 22、包目录 `npm ci` 用包内 lockfile 缓存、从仓库根调 `node scripts/ops/base-verify.mjs --json`；无逐条 npm 命令、无五仓路径、无 secrets、concurrency 取消旧跑）；`test/ops/ci-workflow.test.ts` 9 例。核对：本地用同一入口退出 0（见三）。
- **05 发布后 tarball 校验接入**（`c116f96`，合入 `1b6050c`）：`publish-base.yml` 在 `npm publish` 后新增 verify 步骤（`working-directory: .`、`timeout-minutes: 20`、版本从 `packages/base/package.json` 读、调 `scripts/ops/base-release.mjs --skip-publish` 同一入口、JSON 写 `$RUNNER_TEMP`）与 upload-artifact（`if: always()`）；verify 步骤无 NODE_AUTH_TOKEN、无 `if`/continue-on-error/跳过输入；`test/ops/publish-verify.test.ts` 5 例（本地假 registry）、`publish-workflow.test.ts` 7 例。核对：5/5、7/7 绿。
- **06 AGENTS.md 导航、边界与作业规则**（`86d2789`，合入 `f348c5a`）：AGENTS.md 16→53 行，导航 4 条指针（DESIGN.md `## 10. CLI 表面`、`## 11. 证据与身份链`；`docs/adr/0002-real-machine-verification-as-built.md` `## 决定`；AGENTS-USAGE.md `## 3. 证据与身份：先冻、再绑、再归档`）、边界三条、作业规则四条固定标题；`test/ops/agents-doc.test.ts` 5 例（指针目标存在且章节标题匹配、四条规则都在）。
- **07 提交器**（`4254769`，合入 `d6b4353`）：`scripts/ops/commit-paths.mjs` 只提交指定路径、无关已暂存默认拒绝（`--include-staged` 放行）、越界路径拒绝、`--dry-run` 不写索引、消息 `git commit --cleanup=verbatim -F` 字节保真；`test/ops/commit-paths.test.ts` 9 例（临时 git 仓，`git show --name-only` 只含指定文件）。
- **08 票面读取器**（`d4f04b4`，合入 `127fb01`）：`scripts/ops/tickets.mjs` 只读；跨 effort 同号 exit 1 且在 stderr 逐个列候选（effort/state/title/file），`--json` 给结构化 `candidates`；key 不存在 exit 1、repo 不存在 exit 2；`--effort` 改精确优先（修掉真实仓 base-package 与 base-package-rollout 的假歧义）；`test/ops/tickets.test.ts` 14 例（运行前后目录哈希一致，不写文件）。
- **09 会话日志排查文档**（`cf48476`，合入 `aedfb30`）：`docs/排查-会话日志解压.md` 说明多帧 zstd 与 Node 只解第一帧（含 30MB 实测：218B/1 行 vs 12,314 帧/约 120MB/28,401 行），给出 Python `zstandard` `read_across_frames=True` 的复制即用命令与完整性验证；`test/ops/log-unzip-doc.test.ts` 4 例；`96b8b51` 在 AGENTS.md 加 `## 排查` 链入。核对：文档无真实凭据/个人绝对路径。
- **10 消费者文档示例核对**（`c5abc15`，合入 `073b557`）：`packages/base/README.md` 与 `AGENTS-USAGE.md` 共 +11/−5（`node_modules/.bin/dsh-base` 可复制示例、`readme:init`、等价长命令、旗标分层与 `option(s) not valid for this command: --flag`、参数解析错误措辞）；未改文档结构与章节标题。核对：`npm run docs:check` 绿。说明：本票原实现子代理失败无收尾消息，由 Lead 接管完成并提交，此事实如实记录。

## 二、逐条用户故事 → 实现或测试证据（22/22）

1. push/PR 自动跑完整门禁：`.github/workflows/ci.yml`；`test/ops/ci-workflow.test.ts` 9 例（触发含 push/pull_request、调用本地同一入口、Node 版本）。
2. 本地一条命令 = CI 同一条链：`scripts/ops/base-verify.mjs` 固定 `ALL_STEPS`；ci.yml 只调该入口；测试断言入口同名（ci-workflow 9 例）与步骤顺序（scan.test.ts 10 例含全链 JSON）。
3. 失败即见失败步骤的结构化结果与日志路径：`base-verify --json` 输出 `steps[{id,ok,exitCode,logFile,summary}]`，默认失败即停（`--keep-going` 才继续）；本次 gate JSON 见三。
4. 只跑子集：`--quick`（仅 typecheck+tests）、`--only <ids>`、`--filter`（help/README 已同步）；`portability.test.ts`（`--only docs`）、`scan.test.ts`（`--only scan`）。
5. 源码 NUL/二进制报路径：`scripts/ops/scan-sources.mjs` + `scan.test.ts` 10 例（NUL 夹具 exit 1 报路径、非法 UTF-8、超大文件、跳过目录、干净树 exit 0）。
6. 大日志一条命令汇总：`scripts/ops/gate-summary.mjs` + `gate-summary.test.ts` 8 例（门禁数/断言数/失败门禁、`--failures-only`、无门禁行 exit 2、坏行必须失败并列坏行）。
7. 发布后下载 tarball 全验：`base-release.mjs` verify 链（轮询 registry→直接下载 tarball→sha1/sha256/sha512→包名/版本→dist 入口四标记 prepareHome/findWriteUnderRealHome/candidate-identity/runReleaseGate→tarball 内 CLI `--version`/capability→随包文档）；`publish-verify.test.ts` 5 例（本地假 registry，成功 JSON 含 dist/download/entry/cli）。
8. 本地与 CI 同一份校验代码：`publish-base.yml` verify 步骤调 `scripts/ops/base-release.mjs --skip-publish`；`publish-workflow.test.ts` 7 例（publish 之后存在调用同一入口的步骤、无跳过开关/输入/条件、token 只在发布步骤）。
9. 失败保留结构化证据与下载物：脚本失败分支保留 download/worktree 目录；workflow 用 `if: always()` 上传校验 JSON artifact；`publish-verify.test.ts` 覆盖 404/版本不符的失败回执。
10. 传播延迟不被 npm pack notarget 误判：直接 fetch tarball（不用 npm pack）+ registry 轮询；`publish-verify.test.ts`「waits through registry propagation lag instead of failing the publish (exit 0)」（manifest 前 2 次 404，期望 exit 0 且请求≥3）。
11. 任意克隆路径与 runner 可跑：`common.mjs` 从脚本位置推仓库根；`portability.test.ts` 3 例；`da9c3a3` 给 `runCommandLine` 加 POSIX `/bin/sh -c` 分支，使 ubuntu runner 不再依赖 ComSpec；ci.yml 从仓库根调用。
12. README/AGENTS-USAGE 可复制示例：票 10 的 `c5abc15`；`npm run docs:check` 绿。
13. 文档写明 base 不代跑五仓、不装本地 dist：AGENTS.md「边界：只建设 base」三条；`agents-doc.test.ts` 断言。
14. AGENTS.md 指向权威文档与章节：AGENTS.md 导航段 4 条指针；`agents-doc.test.ts` 断言每个目标存在且章节标题匹配。
15. 等待规则：AGENTS.md「### 等待规则」；`agents-doc.test.ts`。
16. >90 秒后台跑并 Tee 日志：AGENTS.md「### 长任务规则」（`.tmp/ops-logs/<ticket>/` 被 gitignore）；`agents-doc.test.ts`。
17. 三步以上先落脚本：AGENTS.md「### 多步操作规则」；`agents-doc.test.ts`。
18. 只提交本票路径的提交器：`commit-paths.mjs` + `commit-paths.test.ts` 9 例（只含指定文件、无关暂存拒绝/显式放行、越界拒绝、dry-run、消息字节保真）。
19. 只读票面读取器与跨 effort 歧义：`tickets.mjs` + `tickets.test.ts` 14 例（exit 1 候选、`--json candidates`、repo 不存在 exit 2、目录哈希前后一致）。
20. 指针/CI 调用链/发布校验链都有测试守住：`agents-doc.test.ts` 5、`ci-workflow.test.ts` 9、`publish-workflow.test.ts` 7、`publish-verify.test.ts` 5。
21. 多帧日志解压命令进排查文档：`docs/排查-会话日志解压.md` + `log-unzip-doc.test.ts` 4 例 + AGENTS.md `## 排查` 链入。
22. 证据统一落 gitignore 临时目录且可事后读：`base-verify.mjs` 默认 `<repo>/.tmp/ops-logs`（`.gitignore` 的 `.tmp/`）、`--no-log` 可关；`base-release.mjs --download` 目录；workflow 校验 JSON 写 `$RUNNER_TEMP` 并以 artifact 留存；测试见 publish-workflow 与 portability 的「--help 不写日志」断言。

## 三、检查命令与结果（在 1a6e2f6 上，2026-11-03 01:05 +08:00 复跑）

- `git rev-parse HEAD` = `git ls-remote origin refs/heads/main` = `1a6e2f65d79db514552adcb9d7080f58ef21e994`。
- 仓库规定检查（CI 用的同一入口，先删 `.tmp/ops-logs`）：`node scripts/ops/base-verify.mjs --json` → **exit 0**。步骤明细（`.tmp/gate-final-1a6e2f6.json`）：typecheck exit 0（1.45s）；tests exit 0（`80 passed | 1 skipped (81)` 文件、`1080 passed | 6 skipped (1086)` 用例、32.4s）；docs exit 0（`docs ok: README.md and AGENTS-USAGE.md match describe`）；scan exit 0（318 文件、0 issue、238ms）；build exit 0（1.68s，`build ok: core/index, client/index, node/index, node/cli, real-machine-verification/index, real-machine-verification/cli/main`）。日志在 `.tmp/ops-logs/`（gitignored）。
- 复现：`git checkout 1a6e2f6` → `cd packages/base && npm ci` → 回仓库根跑 `node scripts/ops/base-verify.mjs --json`。
- 备注：CI 首跑属远端外部状态，见五。

## 四、交付证明

- 长期分支 `main`，验收提交 `1a6e2f6`（`origin/main` 同一提交）。实施整合提交 `800556d`（`git show --stat`: 31 files changed，`feat/delivery-bootstrap` 以 `--no-ff` 合入），其后 `96b8b51`（docs 收尾）与 `1a6e2f6`（票面收口评论）。
- 票级提交与合入：01 `7184482`→`6c2d6ec`；02 `13101d9`→`aaa8340`；03 `177dc87`→`63d8e3a`；04 `2b12bb5`→`04ee6d3`；05 `c116f96`→`1b6050c`；06 `86d2789`→`f348c5a`；07 `4254769`→`d6b4353`；08 `d4f04b4`→`127fb01`；09 `cf48476`→`aedfb30`；10 `c5abc15`→`073b557`。
- 非票提交（收口时修复跨票缺陷/遗留，未新开票）：`607edf5`（dist 自举：干净克隆无 dist 时 dist-contract 先构建）、`da9c3a3`（`runCommandLine` POSIX 分支 + portability 日志快照只指纹被测脚本）、`a251531`（verify 模式轮询 registry，票 05 遗留）、`4544225`（spec 票面读取器退出码文字，票 08 遗留）、`96b8b51`（AGENTS 排查链入，票 09 遗留）。
- 推送记录：`83e2b0a..800556d`、`800556d..96b8b51`、`96b8b51..1a6e2f6`（均 `main -> main`）。
- 提交信息不含 `Closes #` 等自动关闭关键词；规格关闭只由本次 `deck_issue_patch` 执行。

## 五、遗留处置

- 票 05 登记的「--skip-publish 预检在传播窗口立即退 2」：已修 `a251531`（预检改轮询，超时才退 2）并新增传播窗口用例；`docs/base包-发布与回滚.md` §5 补「发布后自动校验失败」处置（deprecate 旧版本 + 修版本重发，不对同一版本重试 publish）。已合入 main。
- 票 08 登记的 spec 文字与实现冲突：`4544225` 已改 spec.md:108 为「key 不存在退出 1、repo 不存在退出 2」。
- 票 09 登记的可选后续「排查文档未链入」：`96b8b51` 已在 AGENTS.md 增加 `## 排查`。
- CI 首跑（外部状态）：`ci.yml` 已有运行记录——`41484849326`（head `800556d`）被后续 push 的 concurrency 取消（cancelled，非失败）；`41486384986`（head `96b8b51`）同样被取消；head `1a6e2f6` 的 run `41487810450` 已触发、收口时 GitHub runner 仍 queued（job `base gates`，ubuntu-latest）。本地用 CI 同一条命令复跑全绿（见三）；配置内容由 `ci-workflow.test.ts` 9 例守住。远端首次真实执行结果需在 runner 分配后看 run 页。
- 未合并分支（均为本次实施前既有、未触碰）：`prototype/header-action-cluster`（独有 `9e1ac64` 四方向原型、`253b0ff` 图标样张、`108b3c9` 图标样张 v2；一次性原型，不进产品）；`ticket/11-sync-doctor`（独有 `5bbfd8a`、`88f0948`；其实现已被 `5ff50de` 取代、未合入 main）。按「未合并分支保留并列出独有提交」处置，保留供审阅。
- 未提交改动：无本次实施产生的未提交改动。工作区仅 `.scratch/base-package-rollout/issues/14-human-gate-真机与真实页面证据.md`（前一规格既有脏文件）与未跟踪 `docs/证据义务-业界机制调研.md`（非本次交付、来源待用户确认；均未提交、未触碰）。
- 临时工作区与临时分支：t01–t10 共 10 个 worktree 已 `git worktree remove`，`D:\Temp\fh-wt` 已空（`git worktree list` 只剩主工作树）；`ticket/01`–`ticket/10` 与 `feat/delivery-bootstrap` 均以 `--merged main` 删除。
- 临时文件：本次的 `.tmp/` 下 gate 结果/日志/任务书（gitignored）保留为证据，可整目录删除后再生成；`.tmp/ops-logs/` 保留最终 gate 的 5 个日志。
- 新票：无。

## 六、关闭前自检

- 本评论写的提交 = 跑检查的那棵树：`1a6e2f6`，`origin/main` 同提交；工作树无本次实施产生的未提交改动（其后仅有本次关闭产生的规格/票面 markdown 记录提交）。
- 检查结果来自本次会话（2026-11-03 01:05 +08:00）当场复跑，不是记忆：gate exit 0，JSON 明细在 `.tmp/gate-final-1a6e2f6.json`。
- 10 张实施票均 closed，本次逐张复核了代码、测试与命令结果；关闭规格表示实施与收口证据齐备。仍交给用户/外部的两项：CI 远端首跑结果（排队中）、未跟踪 `docs/证据义务-业界机制调研.md` 的归属。

## 进度
