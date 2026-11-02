# AGENTS-USAGE：真机验证的 agent 使用说明

给「要验证一个 DSH 插件是不是真的活着」的 agent。人的接入步骤在 [README.md](README.md)；本文件给出四件事：**按什么顺序选命令、结果怎么判、证据与身份怎么复核、哪些事不用改核心就能做**。

权威表面是 `dsh-verify describe --json`；本文件末尾参考段由它生成。

## 0. 先取权威表面

```bash
node_modules/.bin/dsh-verify --version      # 第二行必须是 capability real-machine-verification (schema 1)
node_modules/.bin/dsh-verify describe --json
```

**capability 行是唯一判据。** npm 上有一个同名无关包 `dsh-verify@0.9.6`：bin 没装好时，裸 `npx dsh-verify` 与 `npx --no-install` 都可能复用 npx 缓存里同名的包、以 exit 0 打印别的工具的 usage。最稳的调用形式是 `node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js <命令>`（不依赖 PATH、不经过 npx）；安装与核对细节见 README 第一步。

`describe` 返回的 commands / profileFields / builtInCheckIds / exitCodes / globalFlags 就是全部契约（参考段是它的投影）。旗标问题都 exit 2，并打印具体原因与该命令的 `usage:` 行：未知旗标、缺值在解析期就拦下；某命令不接受的已知旗标由该命令自己拒绝（`option(s) not valid for this command: --flag`）；例外是 `describe`——它不解释旗标，同一条命令上带 `--profile` 之类也照常输出描述。

## 1. 命令选择：代价从低到高，前层不绿不进下层

| 层 | 命令 | 答什么问题 |
| --- | --- | --- |
| L1 | `describe` / `self-check` | 只读自检：这台机器能不能证明这个插件是活的 |
| L1 | `single-instance` | 一个实例的完整闭环：起、页面、日志、停干净 |
| L1 | `concurrent` | 两个实例并发，断言端口 / home / 缓存互不干扰 |
| L1 | `freeze` | 把当前提交打成候选包（tgz + candidate.json，带文件摘要） |
| L1 | `batch` | 把本轮验证绑定到一个候选与基线，后续证据都挂在这个身份上 |
| L1 | `evidence` | 证据登记、归档（SHA256SUMS）、复核 |
| L1 | `run` | 跑插件特有的端到端场景（含 L2 原语） |
| L1 | `cleanup` | 停残留实例、清理 work root |
| L2 | `launch` / `stop` / `isolation` / `model` / `install` / `skills` | 单点原语：自己控制起停、验证 home/设置隔离、修模型配置、装候选包、核对技能集合 |

- 所有命令支持 `--json`：stdout 只有一段 JSON，进度与人话行走 stderr。
- 写操作支持 `--dry-run`：零写盘、零 spawn、零 HTTP，计划与真实执行共用同一份结论。默认先 dry-run 看计划，再真跑。
- 默认工作根 `<cwd>/.scratch/verify`（仓内、应被 gitignore）；要留档时用 `--work-root` 指到仓外临时目录。

## 2. 结果怎么判：退出码 + 四态 + 错误码

**退出码 `2` 不是失败：blocked 什么都没证明。**

- `0`：全过（skip 不影响）；
- `1`：有硬失败（fail）——插件或仓的问题；
- `2`：有 blocked——前置缺失，本次运行什么都没证明。写报告时按 blocked 分型，不要用 1 的重试逻辑处理它；profile 不存在、没装 DSH、没注入浏览器适配器都属于这一类（`package-installed` 在 profile 目录缺失时也返回 blocked）。

`--json` 的检查状态是 `pass` / `fail` / `skip` / `blocked`；人话行固定 `ok|fail|skip|blocked <id> <detail>`，fail 追加缩进的 `expected:` / `actual:` / `hint:`，blocked 至少带 `hint:`（有的 blocked 没有 expected/actual）。解析日志按行首词判定。

run.json 里每一条 blocked 检查带结构化原因 `blockedReason: { code, message, hint? }`，`code` 三选一：`adapter-missing`（缺适配器）/ `prerequisite-missing`（缺前置）/ `platform-unsupported`（平台不支持）。机器判断「缺什么、能不能补」读这个字段；人话行不重复渲染它。

命令层失败用 `FailureCode` 词表：`invalid-input` / `prerequisite` / `identity-mismatch` / `not-found` / `io` / `timeout` / `conflict` / `unsupported` / `internal`，渲染为 `[code] message — hint`；复述失败时保留 code 与 hint 原文。

参数解析错误（未知旗标、缺值、多余位置参数）不走 `FailureCode`：有命令时输出 `dsh-verify <command>: <问题>` 再跟 `  usage: <usage>`；没有命令时输出 `dsh-verify: <问题>` 加整页 help；两种都 exit 2。`<问题>` 的措辞：未知旗标是 `unknown option(s): ...`，多余位置参数是 `unexpected argument(s): ...`，缺值是 `<flag> needs a value`。`--json` 时 stdout 是同一形状的失败 JSON（`stage: "usage"`；没有命令时 `command` 是空字符串，问题写在 `error.message`）。

## 3. 证据与身份：先冻、再绑、再归档

真机结论靠三层绑定，不靠「我跑过了」：

1. **候选（freeze）**：`freeze` 产出 `candidate.json`，含候选提交、包名/版本、tgz sha256、文件摘要（`fileDigest`）与稳定性判定（`validity` / `sourceStable`）。工作区 dirty 默认拒绝冻结；明确接受「这是开发候选」时用 `--allow-dirty`，并如实记录 `validity=development`。
2. **批次（先开、再冻、再封）**：`batch open --name <n> --base-ref <r>` 只写 `batch.json`（`startHead` + 基线 tip 与目标版本，`candidate: null`）并打印基线行——批次必须在候选生成之前开始；接着 `freeze --out <批次目录>/pkg`，再 `batch open --name <n> --candidate <批次目录内的候选目录>`。封存按固定顺序逐条实测：不在批次目录 → 早于批次 → HEAD 不一致 → 构建提交不一致 → 源码不稳定 → 基线包含关系未判定/不成立 → 版本与基线不等 → 包缺失/哈希不符 → 文件摘要重算不符。通过才写候选身份并打印身份行；拒收 exit 1，前置无法测量 exit 2。
3. **证据（evidence）**：`evidence add` 登记、`evidence archive` 归档（`SHA256SUMS`，最后一行也带换行）、`evidence verify` 复核；同名证据加序号不覆盖，更正只写旁注（notes）不改原件。

身份行与基线行是逐字契约（出现在批次记录与票面里）：

```text
- 验证身份：批次 <批次名>；候选提交 <40位小写hex>；候选包 sha256 <64位小写hex>
```

```text
- 验证基线：本地 <ref> <tip>；目标版本 <version>
```

**Cookie-cutter 规则（最容易混的两个 sha）**：身份行里的「候选包 sha256」是候选 tgz 的 sha256（`candidate.json` 的 `package.tgzSha256`）；证据绑定用的是**另一个值**——`evidence.json` 的 candidate 块记录 `candidate.json` 文件本身的摘要，防的是清单被改写。

其余判据：

- `--allow-stale` 只降级「HEAD 已移动」与「基线不是候选祖先」两项；没有基线仍 blocked，版本不等仍 fail。
- `batch status` 的 `candidate-identity` 每次重算清单与 tgz 的 sha256、文件摘要：候选被替换或清单被改写就 fail，不沿用开批时的旧结论。
- 文件摘要算法（跨语言可复核）：拒绝反斜杠与坏 sha；路径按 UTF-16 排序；每行 `<sha256>  <path>`；行间 join 后再整体 sha256；无尾换行；路径不做归一化。

## 4. 隔离纪律：真实 home 只读

- 一切跑实例的命令用 `DSH_HOME=<批次 home>` 指向**复制出来的 profile**；真实 `~/.dsh` 只读，报告里的 `dshHome` 指向批次 home 是正确语义。
- 批次 home 的标准做法：复制真实 `profiles/<name>` 到批次目录，再把候选包装进副本；证据里记录真实 home 关键文件运行前后的 sha256 不变。固定清单、取哈希与比对写法见 README「真实 home 只读」（含 PowerShell 片段）。
- `install`（以及 `model --fix`）按**解析后的目标 home** 判隔离：等于或落在真实 home（含子目录、junction）内就拒绝（exit 2、`[prerequisite]`，hint 指向复制成批次 home 再装）；`--dry-run` 只警告、不写盘。先复制 profile、把 `DSH_HOME` 指到副本再装。同一判定覆盖显式写目标 `--work-root` / `--out` / `--archive-root`。
- `isolation` 探针证明子进程的 userprofile / 插件设置目录落在 work root 下；声明没写 `pluginSettingsDir` 时它 blocked 并给出补字段 hint——这是声明缺口，不是 bug。
- `cleanup` / `stop` 收尾；`--keep` 保留现场时在结论里注明「teardown 记 skip，不是通过」。

## 5. 扩展边界：场景、钩子、自定义检查

插件特有的端到端场景写成仓内场景文件（`verify/scenarios/*.mjs` 或 `.ts`），用 `run` 跑；场景原语：`launch` / `stop` / `logs` / `page` / `model` / `install` / `skills` / `check` / `evidence` / `expect` / `sleep` / `instances` / `lastInstance` / `dispose`，另加自定义步骤。声明里的 `checks` 挂插件特有的自定义检查（与内建检查同一份报告词表）。

场景可以声明三个起停钩子，时机不同：`beforeLaunch` 时隔离 home 还不存在（只能准备 home 外路径）；`prepareHome` 时 home 刚复制完、进程还没启动，是种 workspace 注册表/设置这类「宿主启动时读进内存」状态的唯一可靠时机（启动后写会被宿主覆盖）；`afterLaunch` 时实例已就绪，适合观察或种宿主按需从磁盘读的状态。

边界按「需要改核心就记为扩展性缺陷」判断：

- 需要**有头**浏览器（真全屏、多窗口预设）时，`run` 的场景原语固定 headless；这类检查留成仓内有头脚本。
- 自定义检查与内建检查同一套四态：返回 `{ status: "blocked", blockedReason: { code: "adapter-missing" | "prerequisite-missing" | "platform-unsupported", message, hint? } }` 记 blocked（不是 fail）；`{ status: "skip" }` 表示不适用；旧的 `ok: true/false` 仍兼容。
- 插件特有的状态目录、技能目录、模型要求通过声明字段表达；声明表达不了才提契约扩展。

## 6. 退出前自检（每条都要能拿出证据）

- `describe --json` 跑过；用到的旗标与 check id 来自它，不凭记忆。
- 写操作先 `--dry-run`，且 dry-run 与真跑结论一致。
- 退出码 2 已分型（`adapter-missing` / `prerequisite-missing` / `platform-unsupported` 或命令层 `FailureCode`），并写明缺什么、怎么补。
- 真实 home 前后 sha256 不变，证据已随报告归档。
- 报告、证据、身份行/基线行已归档，sha256 能按 README 第五步复核。
- 改了声明或能力描述后跑过 `npm run docs:check`。
## 参考（自动生成，勿手改）

本段由 `dsh-verify describe` 生成。改完能力描述后运行 `npm run docs:sync`。

<!-- dsh-verify:reference:begin -->
<!-- 本段由 `dsh-verify describe` 生成：不要手改；改完能力描述后运行 `npm run docs:sync`。 -->

## real-machine-verification

Run a plugin build inside a provably isolated DSH instance, check falsifiable claims, and keep evidence that another machine can re-verify.

### Layers

| Layer | Audience | Use |
| --- | --- | --- |
| L1 | people and CI | fixed-shape orchestration: one command per intent |
| L2 | agents and scripts | composable primitives in any order |
| L3 | agents facing an unforeseen case | break-glass: pages, raw handles, custom steps |

### Commands (15)

| Layer | Usage | Writes |
| --- | --- | --- |
| L1 | dsh-verify describe [--json] | nothing |
| L1 | dsh-verify self-check [--profile <p>] [--declaration <file>] [--work-root <dir>] [--screen] [--json] [--dry-run] | run.json and evidence files under the work root (nothing with --dry-run) |
| L2 | dsh-verify launch [--profile <p>] [--keep] [--port <n>] [--dry-run] [--json] | an isolated home, a working directory, instance.json (nothing with --dry-run) |
| L2 | dsh-verify stop [--id <id>] [--dir <d>] [--all] [--json] [--dry-run] | stopped.json in the instance directory (nothing with --dry-run) |
| L2 | dsh-verify isolation [--profile <p>] [--work-root <dir>] [--json] [--dry-run] | probe artifacts under the work root (nothing with --dry-run) |
| L2 | dsh-verify model [--profile <p>] [--provider <p>] [--model <m>] [--api-key-env <ENV>] [--fix] [--json] [--dry-run] | nothing unless --fix is given |
| L2 | dsh-verify install --tgz <file> [--method extract\|cli] [--profile <p>] [--declaration <file>] [--work-root <dir>] [--json] [--dry-run] | the isolated profile's node_modules (nothing with --dry-run) |
| L2 | dsh-verify skills [--profile <p>] [--declaration <file>] [--json] | nothing |
| L1 | dsh-verify single-instance [--profile <p>] [--declaration <file>] [--work-root <dir>] [--keep] [--dry-run] [--json] | a run directory under the work root: report, evidence, logs |
| L1 | dsh-verify concurrent --count <N> [--profiles a,b,c] [--dry-run] [--json] | the batch directory: evidence, summary, logs (nothing with --dry-run) |
| L1 | dsh-verify freeze [--out <dir>] [--allow-dirty] [--json] [--dry-run] | candidate.json and the tgz under the given output directory (nothing with --dry-run) |
| L1 | dsh-verify batch open\|status [--name <n>] [--base-ref <r>] [--candidate <dir>] [--allow-stale] [--work-root <dir>] [--json] [--dry-run] | batch.json under the work root, the baseline line at open and the identity line once sealed |
| L1 | dsh-verify evidence add\|archive\|verify [--file <p>]... [--check <id>=pass\|fail] [--archive-root <dir>] [--dir <batch-or-archive-dir>] [--name <batch-name>] [--work-root <dir>] [--json] [--dry-run] | evidence/files, evidence.json, the archive directory (nothing with --dry-run) |
| L1 | dsh-verify run <scenario.ts> [--concurrency <n>] [--fail-fast\|--collect-all] [--profile <p>] [--declaration <file>] [--work-root <dir>] [--json] [--dry-run] | a run directory under the work root: report, evidence, logs (nothing with --dry-run) |
| L1 | dsh-verify cleanup [--yes] [--keep-batches <n>] [--keep-homes <n>] [--include-pkg] [--json] [--dry-run] | the work root, only with --yes (nothing with --dry-run) |

### Built-in check ids (22)

These ids are a stable contract: reports, comments and gates cite them.

- `dsh-runtime`
- `node-version`
- `profile-declaration`
- `profile-present`
- `isolation-home`
- `settings-isolated`
- `package-installed`
- `package-files`
- `skills-set`
- `model-configured`
- `model-credential`
- `instance-reachable`
- `instances-distinct`
- `instance-pages`
- `logs-readable`
- `teardown-clean`
- `candidate-identity`
- `batch-head-fresh`
- `batch-baseline-fresh`
- `batch-evidence-bound`
- `batch-record`
- `screen-present`

### Profile fields (15)

- `id`
- `packageName`
- `defaultProfile`
- `clientEntry`
- `pluginCacheDir`
- `pluginSettingsDir`
- `bundledSkills`
- `model`
- `browser`
- `ticketFace`
- `workspaceBackends`
- `build`
- `instanceEnvAllowlist`
- `hooks`
- `checks`

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | all checks passed; a skipped check is allowed and is reported as skipped |
| 1 | a hard check failed; the report says which claim was falsified |
| 2 | blocked: a prerequisite or adapter is missing, so the run proved nothing about the product |

### Global options

| Option | Meaning |
| --- | --- |
| --json | Print exactly one JSON document on stdout and nothing else. |
| --declaration <file> | Load the verification declaration from this file instead of discovering verify/profile.ts. |
| --work-root <dir> | Write run reports and evidence under this directory (default: <cwd>/.scratch/verify). |
| --dry-run | Print the plan that would run; touch nothing. |
| --help | Print usage. |
| --version | Print the base package version and the capability fingerprint. |

### Documents

- `README.md` — how to install and run this capability.
- `AGENTS-USAGE.md` — the agent-facing capability table and error codes.
<!-- dsh-verify:reference:end -->
