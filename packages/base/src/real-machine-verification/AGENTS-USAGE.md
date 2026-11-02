# AGENTS-USAGE：真机验证的 agent 使用说明

给「要验证一个 DSH 插件是不是真的活着」的 agent。人读的接入步骤在 [README.md](README.md)；本文件回答四件事：**按什么顺序选命令、结果怎么判、证据与身份怎么复核、哪些事情不用改核心就能做**。

## 0. 先取权威表面，不要背文档

```bash
node_modules/.bin/dsh-verify --version      # 第二行必须是 capability real-machine-verification (schema 1)
node_modules/.bin/dsh-verify describe --json
```

**先核对 `--version` 的 capability 行，再信任何短命令**：npm 上有一个同名无关包 `dsh-verify@0.9.6`。裸 `npx dsh-verify` 在 bin 没装好时会静默下载它；`npx --no-install` 也不是保险——实测 npx 会复用缓存里同名的包，同样以 exit 0 打印别的工具的 usage。最稳的调用形式是 `node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js <命令>`（不依赖 PATH、不经过 npx）。

返回的命令表、`profileFields`、`builtInCheckIds`、`exitCodes`、`globalFlags` 就是全部契约；本文件末尾的参考段是它生成的。Flag 问题在解析期统一拦下：未知旗标、缺值、该命令不接受的旗标都会 exit 2，并打印具体原因与该命令的 `usage:` 行，不会静默忽略。

## 1. 命令选择：从只读到动真实进程

按「代价从低到高」推进，前一层不绿不要进下一层：

| 层 | 命令 | 什么时候用 |
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

- 所有命令都支持 `--json`；`--json` 时 stdout 只有一段 JSON，进度与人话行走 stderr。
- 写操作类命令都支持 `--dry-run`：零写盘、零 spawn、零 HTTP，打印的计划与真实执行共用同一份结论。先 dry-run 看一眼计划，再真跑，是默认习惯。
- 默认工作根在 `<cwd>/.scratch/verify`（仓内、应被 gitignore）；要留档时用 `--work-root` 指到仓外临时目录。

## 2. 结果怎么判：退出码 + 检查状态 + 错误码

退出码只有三种含义（见参考段）：

- `0`：全过（skip 不影响）；
- `1`：有硬失败（fail）——插件或仓的问题；
- `2`：有 blocked——**前置缺失，本次运行什么都没证明**。不要把 2 当失败写进报告，也不要用 1 的重试逻辑处理它。profile 不存在、没装 DSH、没注入浏览器适配器都属于这一类（包括 `package-installed` 在 profile 目录缺失时返回 blocked）。

用 `--json` 时的三种结果词：`pass` / `fail` / `skip` / `blocked`。人话行格式固定为 `ok|fail|skip|blocked <id> <detail>`，fail 行追加缩进的 `expected:` / `actual:` / `hint:`，blocked 至少带 `hint:`（有的 blocked 没有 expected/actual）；解析日志时按行首词判定，别按位置。

命令层的失败（参数、声明、路径、前置命令）用 `FailureCode` 词表，稳定可编程：

`invalid-input` / `prerequisite` / `identity-mismatch` / `not-found` / `io` / `timeout` / `conflict` / `unsupported` / `internal`，渲染为 `[code] message — hint`。给用户复述失败时保留 code 与 hint 原文。

参数解析错误（未知旗标、缺值、多余位置参数）**不走** `FailureCode`，也不要去找 `[code]` 前缀：有命令时输出 `dsh-verify <command>: unknown option(s): ...` 再跟一行 `  usage: <usage>`；没有命令时（例如 `dsh-verify --bogus`）输出 `dsh-verify: unknown option(s): ...` 加整页 help；两种情况都 exit 2。`--json` 时 stdout 仍是那一段失败 JSON（`stage: "usage"`）。

## 3. 证据与身份：先冻结，再绑定，再归档

真机结论要能被别人复核，靠的是三层绑定而不是「我跑过了」：

1. **候选**：`freeze` 产出 `candidate.json`，含候选提交、包名/版本、tgz sha256、文件摘要（`fileDigest`）与稳定性判定（`validity` / `sourceStable`）。工作区 dirty 时默认拒绝冻结；只有明确接受「这是开发候选」时才用 `--allow-dirty`，并如实标注 `validity=development`。
2. **批次**：`batch open` 把批次名 + 候选 + 基线（`--base-ref` 的 tip 与目标版本）写成 `batch.json`，并给出批次的身份行。之后的证据都挂在这个批次的目录下。
3. **证据**：`evidence add` 登记、`evidence archive` 归档（`SHA256SUMS`，最后一行也带换行）、`evidence verify` 复核；同名证据加序号而不覆盖，更正只写旁注（notes）不改原件。

身份行是逐字契约，出现在批次记录与票面里：

```text
- 验证身份：批次 <批次名>；候选提交 <40位小写hex>；候选包 sha256 <64位小写hex>
```

基线行同样是逐字契约：

```text
- 验证基线：本地 <ref> <tip>；目标版本 <version>
```

Cookie-cutter 规则：身份行里的「候选包 sha256」绑定候选 manifest 的摘要，tgz 的 sha256 不参与；没有基线时 batch 不会假装通过（新鲜度判 blocked），`--allow-stale` 只降级「HEAD 已移动」这一项，不豁免「没有基线」。

文件摘要算法（跨语言可复核）：拒绝反斜杠与坏 sha；路径按 UTF-16 排序；每行 `<sha256>  <path>`；行间 join 后再整体 sha256；无尾换行；路径不做归一化。

候选判定顺序是「先根因后衍生」，按顺序答：不在批次目录 → 早于批次 → HEAD 不一致 → 产物构建提交不一致 → 源码不稳定 → 基线包含关系未判定/不成立 → 版本与基线不等 → 包缺失/哈希不符 → 文件摘要重算不符。

## 4. 隔离纪律：真实 home 只读

- 一切跑实例的命令都要用 `DSH_HOME=<批次 home>` 指到**复制出来的 profile**；真实 `~/.dsh` 只读，报告里的 `dshHome` 指向批次 home 是正确语义。
- 批次 home 的标准做法：复制真实 `profiles/<name>` 到批次目录，再把候选包装进副本；证据里记录真实 home 关键文件运行前后的 sha256 不变。
- 真实 home 的证据按**固定文件清单**取（整目录哈希会假阳性：宿主常驻时 `~/.dsh/storages` 空闲也会变）：`<DSH_HOME>/.credentials.yaml`、`profiles/<p>/package.json`、`profiles/<p>/cordis.patch.yml`、`profiles/<p>/node_modules/<packageName>/package.json`。Windows 用 `Get-FileHash <file> -Algorithm SHA256` 与运行前值比对（没有 `sha256sum`）。
- `install` 默认目标是 `DSH_HOME` 的 profile；它会按**解析后的目标 home**判断隔离——只要等于真实 home（包括 `DSH_HOME` 被显式指到真实 home），就在 stderr 打印警告。先复制 profile、把 `DSH_HOME` 指到副本再装。
- `isolation` 探针同理：它证明子进程的 userprofile / 插件设置目录落在 work root 下，而不是真实 home。声明没写 `pluginSettingsDir` 时它会 blocked 并给出补字段的 hint——这是声明缺口，不是 bug。
- `cleanup` / `stop` 收尾；`--keep` 保留现场时要在结论里注明「teardown 记 skip，不是通过」。

## 5. 不用改核心能表达什么（扩展边界）

插件特有的端到端场景写成仓内场景文件（`verify/scenarios/*.mjs` 或 `.ts`），用 `run` 跑；场景里可用的原语：`launch` / `stop` / `logs` / `page` / `model` / `install` / `skills` / `check` / `evidence` / `expect` / `sleep` / `instances` / `lastInstance` / `dispose`，另加自定义步骤。声明里的 `checks` 还能挂插件特有的自定义检查（与内建检查同一份报告词表）。

边界（判断标准：需要改核心就记为扩展性缺陷，不要私改核心）：

- 需要**有头**浏览器（真全屏、多窗口预设）时，`run` 的场景原语固定 headless；这类检查应留成仓内有头脚本，不要塞进场景硬跑。
- 自定义检查无法表达 `blocked`（只能 pass/fail）：环境类检查放进场景，用 `ScenarioObservation.status` 表达 blocked。
- 插件特有的状态目录、技能目录、模型要求都应通过声明字段表达；声明表达不了才提契约扩展。

## 6. 给 agent 的硬规矩

- 先 `describe --json` 再动手；不要凭记忆写旗标。
- 先 `--dry-run` 再真跑写操作。
- 退出码 2（blocked）不是失败，不要重试到绿；补齐前置后重跑，并在结论里说明是什么缺失。
- 不要读、打印或落盘任何密钥值：模型与凭据检查只消费引用名，报告里也只有来源与是否可用。
- 真实 home 零写入是硬要求；报告要带「真实 home 前后 sha256 不变」的证据。
- 改动后跑 `npm run docs:check`：本文件与 README 的参考段必须和 `describe` 一致；手改生成段会被测试拦下。

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
| L1 | dsh-verify batch open\|status [--name <n>] [--base-ref <r>] [--candidate <dir>] [--allow-stale] [--work-root <dir>] [--json] [--dry-run] | batch.json under the work root, plus the identity and baseline lines |
| L1 | dsh-verify evidence add\|archive\|verify [--file <p>]... [--check <id>=pass\|fail] [--archive-root <dir>] [--dir <batch-or-archive-dir>] [--name <batch-name>] [--work-root <dir>] [--json] [--dry-run] | evidence/files, evidence.json, the archive directory (nothing with --dry-run) |
| L1 | dsh-verify run <scenario.ts> [--concurrency <n>] [--fail-fast\|--collect-all] [--profile <p>] [--declaration <file>] [--work-root <dir>] [--json] [--dry-run] | a run directory under the work root: report, evidence, logs (nothing with --dry-run) |
| L1 | dsh-verify cleanup [--yes] [--keep-batches <n>] [--keep-homes <n>] [--include-pkg] [--json] [--dry-run] | the work root, only with --yes (nothing with --dry-run) |

### Built-in check ids (20)

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
- `batch-freshness`
- `evidence-bound`
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
