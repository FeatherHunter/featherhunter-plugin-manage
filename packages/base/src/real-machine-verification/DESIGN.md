# 真机验证能力 · 一次性完整设计（real-machine-verification）

> 本文是该能力的**唯一**规划：不分期、不留「第二期再说」的口子。所有能力在同一批交付。
> 规则的直接来源：用户 2026-11-01 的决策（base 掌控完整核心；使用方可选择；TS 化；自解释目录；完全解耦；对抗式审查；不过度发散）。

---

## 0. 边界（先说什么不做）

- **是**：把「一份确定的插件产物」在「可证明受控的 DSH 环境」里跑起来，产出「别人可复核的证据」。
- **不是**：通用测试框架（不做单测/快照/覆盖率）、不是 DSH 本身的功能、不是发布流水线（只提供发布前可调用的检查）。
- **不做**：DSL、DI 容器、反射、微内核插件系统、事件总线。场景就是普通 TS 文件。

## 1. 验收（DoD，全部可自动判定）

| # | 判据 | 判定方式 |
| --- | --- | --- |
| 1 | 能力闭环：任意已装插件可产出带身份的 evidence 包 + 归档 | 跑 `dsh-verify run` 后用 `sha256sum -c` 复核归档 |
| 2 | profile 任意性：同一场景跑 `web` / `desktop` / 自建 profile 全通过且四件套互不共享 | 断言 home/dir/userProfile/port 两两不同 |
| 3 | N 路并发：N=1,2,3,5 全通；中途杀掉一路，其余两路继续、被杀那路回收无残留 | 进程表/端口表/instance.json 三重断言 |
| 4 | 身份链：篡改候选字节 → 拒收；HEAD 前进 → stale；同版本不同提交 → 拒收 | 三个 fixture 必须红 |
| 5 | 模型：三件套 + 跨条目引用一致性 + 凭据三段查找；`--fix` 二次运行零写入 | 文件 mtime/hash 不变 |
| 6 | 技能：用**集合相等**判定，不受「模型可见数量」影响 | 造 27 里 16 个 hidden 的夹具 |
| 7 | 秘密：canary 密钥跑全流程，所有 stdout/stderr/JSON/计划/日志 grep 零命中 | 全局 grep 断言 |
| 8 | matt 迁移：删除 >85% 通用代码，既有门禁保持绿，能力不减反增 | `git diff --stat` + 门禁全绿 |
| 9 | 第二仓接入：palette ≤20 行 profile + 2 条 script 跑通 self-check | 实际提交 |
| 10 | **AI 未预置场景**：不改 base 写出并跑通一个我们没预置的场景 | 见 §14 |
| 11 | 反例矩阵：每条检查都有能把打红的夹具，且全部为红 | `--negative` 全量 |
| 12 | 架构门禁：依赖方向 / 无插件常量 / 零依赖 / describe 与文档一致 | 4 条扫描脚本 |
| 13 | **文档即入口**：一个只读 README 的新插件仓能自己完成接入并跑通 `self-check`，全程不问人 | 独立子代理只拿 README 在陌生仓执行；凡需要提问/猜测处一律记为文档缺陷（用户 2026-11-01 追加的硬要求） |

## 2. 三层能力模型（「可选择性」的落点）

| 层 | 使用者 | 形态 | 自由度 |
| --- | --- | --- | --- |
| **L1 预置编排** | 人、CI | `self-check` / `single-instance` / `concurrent` / `freeze` / `batch` / `run` | 固定形状，参数可选 |
| **L2 原语** | AI、脚本 | `harness.launch/stop/isolation/models/packages/logs/evidence/check/step` | 任意组合、任意顺序 |
| **L3 逃逸舱** | AI 遇到没预见的场景 | `InstanceHandle.page/.raw`、`harness.step()`、自定义 `check`、自写场景文件 | 封装的边界必须能被打穿 |

**判据**：随机 10 个 matt 现有命令，≥8 个必须能在**零改 base**的前提下表达；需要改 base 才能表达 = 扩展性缺陷 = bug。

## 3. 目录与文件清单（一个能力、一个目录、全部自包含）

```
packages/base/src/real-machine-verification/
├── README.md                     人读：边界、安装、三层用法、错误码
├── AGENTS-USAGE.md               AI 读：能力表、典型场景、错误码、反例清单（与 describe() 同步）
├── DESIGN.md                     本文
├── index.ts                      唯一出口，只 re-export
│
├── contracts/                    纯领域层：类型 + 判据（零 IO、零副作用、可被门禁直接 import）
│   ├── branding.ts               品牌类型与校验（CommitSha/Sha256Hex/BatchName/CheckId/ProfileName）
│   ├── result.ts                 Result/Failure/FailureCode
│   ├── check.ts                  CheckStatus/CheckResult/CheckRegistry
│   ├── run-state.ts              RunPhase + transition() 状态机
│   ├── verification-profile.ts   defineVerificationProfile() 与类型
│   ├── launch-plan.ts            LaunchPlan + 构造规则（纯）
│   ├── identity.ts               身份行格式化/解析、digestOfFiles、canonicalJson
│   ├── candidate-rules.ts        候选判据（12 条拒绝面）
│   ├── batch-rules.ts            批次判据 + 新鲜度（偏序）
│   ├── evidence-contract.ts      EvidenceItem/EvidenceManifest 结构判据
│   ├── profile-rules.ts          profile/模型一致性 + 跨条目引用一致性
│   ├── skills-rules.ts           技能集合判据（禁计数）
│   ├── ports.ts                  Spawner/Clock/FileSystem/Screen/Ticket/BrowserProbeFactory
│   └── scenario.ts               Scenario/Step/ScenarioContext
│
├── runtime/                      端口实现（真实副作用，全部经 ports 注入，可替换、可测）
│   ├── dsh-locator.ts            exe 与 asar cli.js 定位（环境变量覆盖 + 可操作报错）
│   ├── instance-launcher.ts      argv/env/流式抓 token/detached/instance.json
│   ├── instance-reaper.ts        回收 + 三重验证（pid/端口/记录）
│   ├── isolation-prober.ts       隔离自证（子进程探针 + 真实文件哈希前后）
│   ├── profile-materializer.ts   隔离 home 生成/复制 + profile 选择
│   ├── model-configurator.ts     三件套检查 + 幂等 CAS 写入 + 凭据三段查找
│   ├── package-installer.ts      extract/cli 两策略 + 逐文件核对 + 跨盘判断
│   ├── plugin-log-reader.ts      日志定位 + JSONL 解析 + 查询 + 等待
│   ├── workspace-seeder.ts       工作区注册表/夹具（后端可插拔）
│   ├── evidence-store.ts         内容寻址落盘 + 不可变清单
│   ├── diagnostics-bundle.ts     诊断包（一屏可定位）
│   └── platform/
│       ├── process-tree.ts       Windows taskkill /T；POSIX 进程组信号
│       ├── screen.ts             PowerShell / system_profiler / xrandr
│       ├── command.ts            .cmd/.bat 经 ComSpec；PATH 解析
│       └── volume.ts             跨盘判断（pnpm store 约束）
│
├── evidence/
│   ├── collector.ts              收集器（append-only，返回新对象）
│   └── archiver.ts               归档 + SHA256SUMS
│
├── orchestration/                L1 能力：都由 L2 原语组成
│   ├── harness.ts                createHarness()（L2 门面）
│   ├── self-check.ts             doctor / preflight
│   ├── single-instance.ts        单实例冒烟
│   ├── concurrent-instances.ts   N 路 + profile 矩阵
│   ├── candidate-freeze.ts       构建→打包→逐文件清单
│   ├── batch-lifecycle.ts        开批/巡检/收尾
│   └── scenario-runner.ts        DAG 调度器（L1 的 run）
│
├── adapters/                     可选增强：只实现 ports，缺省给 `adapter-missing` 而非崩
│   ├── browser/playwright-probe.ts   注入式（base 不 import playwright）
│   ├── ticket/github.ts, gitlab.ts   票面同步（读清单票/写评论）
│   ├── screen/                       默认跨平台实现，可被测试替身覆盖
│   └── sandbox/gitlab-project.ts     GitLab 沙箱项目（可选）
│
├── cli/
│   ├── main.ts                   分发 + 全局参数（--json/--dry-run/--negative/--verbose）
│   ├── render.ts                 JSON/人类双输出、退出码映射
│   └── commands/
│       ├── describe.ts · self-check.ts · launch.ts · stop.ts · isolation.ts
│       ├── model.ts · install.ts · skills.ts
│       ├── single-instance.ts · concurrent.ts · freeze.ts
│       ├── batch.ts · run.ts · evidence.ts · cleanup.ts
│
└── tests/                        自包含（含反例矩阵与架构门禁）
    ├── architecture.test.ts      四条门禁：依赖方向/无插件常量/零依赖/describe 同步
    ├── negative/*.test.ts        每条检查一个"必须红"夹具
    ├── contracts/*.test.ts       纯判据（不需要真机）
    ├── runtime/*.test.ts         端口替身驱动
    ├── e2e/*.test.ts             真机（默认跳过，`DSH_VERIFY_E2E=1` 才跑）
    └── fixtures/                 假 DSH/假 glab/假屏幕/假浏览器
```

**发布面**：`package.json` 增加 `exports["./real-machine-verification"]`、`bin: { "dsh-verify": "dist/real-machine-verification/cli/main.js" }`。构建管道已从 `build.mjs` 重写为 TypeScript 的 `scripts/build.ts`（旧 JS 已删除），入口表在文件顶部一处集中声明，当前六个 bundle：

| bundle | 平台 | 契约 |
| --- | --- | --- |
| `core/index` | neutral | 自包含（无 import/require/动态 import） |
| `client/index` | neutral | 自包含 |
| `node/index` | node | 只许 `node:` 内建 |
| `node/cli` | node | 只许 `node:` 内建（shebang） |
| `real-machine-verification/index` | node | 只许 `node:` 内建 |
| `real-machine-verification/cli/main` | node | 只许 `node:` 内建（shebang） |

`files` 只含 `dist`，src 里的 md 不发布——README/AGENTS-USAGE 由 `describe()` 生成段落，避免文档漂移。契约检查是构建期的：新增入口忘了声明契约，构建就会红。

## 4. 依赖方向与架构门禁

```
cli → orchestration → runtime | evidence → contracts
adapters → contracts（仅接口）
contracts → （无）
```

四条硬门禁（`tests/architecture.test.ts`，任一红则整个能力不交付）：

1. **方向**：禁止 `contracts` import 上层；禁止 `adapters` 被 runtime 反向依赖；禁止本目录 import base 的 `core/`、`client/`；禁止 base 其他目录 import 本目录。
2. **无插件常量**：本目录（除 `tests/fixtures/`）禁止出现任何具体插件名、`.dsh-<插件缓存>` 字面量、profile 名常量；一切差异来自 `VerificationProfile`。
3. **零依赖**：esbuild metafile 里本入口的非相对 import 只能是 `node:` 前缀。
4. **文档同步**：`describe()` 的检查项/命令/退出码表必须与 `AGENTS-USAGE.md` 对应段落逐字一致（生成 + 校验）。

## 5. 对外 API（完整签名）

```ts
// index.ts
export function defineVerificationProfile(input: VerificationProfileInput): VerificationProfile
export function defineScenario(scenario: Scenario): Scenario
export function createHarness(options: HarnessOptions): Promise<Harness>
export type { /* 全部公开类型 */ }

export interface VerificationProfileInput {
  readonly id: string
  readonly packageName: string
  readonly defaultProfile?: string                 // 缺省值，任何调用都可覆盖
  readonly clientEntry?: string                    // 默认 'lib/client.js'
  readonly pluginCacheDir?: string                 // 插件日志/缓存目录名
  readonly bundledSkills?: { dir: string; expected: number } | false
  readonly model?: ModelSelection | false
  readonly workspaceBackends?: readonly ('github' | 'gitlab' | 'markdown' | 'none' | string)[]
  readonly build?: { command: string; timeoutMs?: number }
  readonly hooks?: {
    beforeLaunch?(ctx: LaunchContext): Promise<void>
    afterLaunch?(ctx: { instance: InstanceHandle }): Promise<void>
    beforeStop?(ctx: { instance: InstanceHandle }): Promise<void>
  }
  readonly checks?: readonly CustomCheck[]
}

export interface HarnessOptions {
  readonly profile: VerificationProfile
  readonly root?: string                           // 默认 <repo>/.scratch/real-machine-verification
  readonly dsh?: { exe?: string; cliJs?: string; realHome?: string }
  readonly ports?: Partial<Ports>                  // 测试注入；生产用默认真实实现
  readonly browser?: BrowserProbeFactory           // 可选，缺省 = 无浏览器能力
  readonly ticket?: TicketPort                     // 可选，缺省 = 不同步票面
  readonly defaults?: Partial<LaunchOptions>
  readonly onEvent?: (event: HarnessEvent) => void
}

export interface LaunchOptions {
  readonly profile?: string                        // ← 任意 profile
  readonly home?: string                           // 复用
  readonly sourceHome?: string                     // 复制 profile 的来源 home
  readonly dir?: string
  readonly port?: number                           // 默认 0（OS 分配）
  readonly model?: ModelSelection | false
  readonly envFile?: string
  readonly env?: Readonly<Record<string, string>>
  readonly keep?: boolean                          // 半自动化：不自动回收
  readonly timeoutMs?: number
}

export interface InstanceHandle {
  readonly id: string
  readonly profile: string
  readonly url: string
  readonly origin: string
  readonly home: string
  readonly dir: string
  readonly userProfile: string
  readonly pid: number
  readonly startedAt: string
  readonly readyMs: number
  readonly logFile: string | null
  readonly model: LaunchModelReport
  readonly page?: unknown                          // 仅当注入 browser 工厂
  readonly raw: { argv: readonly string[]; envNames: readonly string[]; secretEnvNames: readonly string[] }
  stop(options?: { timeoutMs?: number }): Promise<StopReport>
}

export interface Harness {
  readonly profile: VerificationProfile
  readonly root: string
  describe(): CapabilityDescription
  plan(options?: LaunchOptions): Promise<LaunchPlan>          // 纯计算，无副作用
  launch(options?: LaunchOptions): Promise<InstanceHandle>
  launchMatrix(specs: readonly LaunchOptions[]): Promise<InstanceHandle[]>
  readonly isolation: { probe(): Promise<IsolationReport> }
  readonly profiles: { materialize(o: MaterializeOptions): Promise<MaterializeReport>; inspect(name: string): Promise<ProfileInspection> }
  readonly models: { inspect(o?: ModelOptions): Promise<ModelReport>; apply(o?: ModelOptions): Promise<ModelReport>; credential(o?: ModelOptions): Promise<CredentialReport> }
  readonly packages: { inspect(o?: { profile?: string }): Promise<InstalledPackageReport>; install(o: InstallOptions): Promise<InstallReport> }
  readonly skills: { snapshot(o?: { cwd?: string }): Promise<SkillsSnapshot> }
  readonly logs: { query(o: LogQuery): Promise<LogEvent[]>; waitFor(o: LogWait): Promise<LogEvent> }
  readonly evidence: {
    file(path: string, note?: string): EvidenceItemRef
    text(name: string, content: string, note?: string): EvidenceItemRef
    json(name: string, data: unknown, note?: string): EvidenceItemRef
    command(name: string, run: CommandRun): EvidenceItemRef
    logSlice(name: string, file: string, lines: number): EvidenceItemRef
    finish(summary: RunSummary): Promise<EvidenceManifest>
  }
  check(id: string, title: string, fn: () => Promise<CheckResult> | CheckResult, opts?: { hard?: boolean }): Promise<CheckResult>
  step<T>(name: string, fn: () => Promise<T>): Promise<T>     // 自定义步骤（逃逸舱）
  diag(): Promise<DiagnosticsBundle>
  close(): Promise<CloseReport>
}
```

## 6. 数据模型（关键几条）

```ts
type Brand<T, Tag extends string> = T & { readonly __brand: Tag }
export type CommitSha = Brand<string, 'CommitSha'>
export type Sha256Hex = Brand<string, 'Sha256Hex'>
export type BatchName = Brand<string, 'BatchName'>
export type CheckId   = Brand<string, 'CheckId'>

export type CheckStatus = 'pass' | 'fail' | 'skip' | 'blocked'
export interface CheckResult {
  readonly id: CheckId; readonly title: string; readonly hard: boolean
  readonly status: CheckStatus; readonly detail: string
  readonly expected?: string; readonly actual?: string      // 「期望 vs 实际」强制分开
  readonly hint?: string; readonly evidence: readonly EvidenceItemRef[]
  readonly durationMs: number
}

export type RunPhase = 'idle' | 'materializing' | 'launching' | 'ready'
                    | 'asserting' | 'collecting' | 'completed' | 'failed' | 'aborted'
export function transition(phase: RunPhase, event: RunEvent): RunPhase   // 非法转移抛错

export interface CandidateIdentity {
  readonly commit: CommitSha; readonly version: string
  readonly validity: 'release' | 'development'
  readonly sourceStable: boolean
  readonly tgzSha256: Sha256Hex
  readonly fileDigest: Sha256Hex; readonly manifestDigest: Sha256Hex
  readonly buildCommit: CommitSha
}
export interface BatchIdentity {
  readonly batchName: BatchName
  readonly candidate: CandidateIdentity
  readonly base: { ref: string; tip: CommitSha; expectedVersion: string } | null
  readonly startHead: CommitSha
  readonly status: 'active' | 'stale'
}
```

**为什么 blocked 必须独立于 fail**：依赖缺失（没有浏览器、没有 glab、没有屏幕）时结论是「未验证」，不是「产品坏」。混在一起会让门禁长期假红，最后被无视——matt 的 `preflight` 已经踩过这个坑。

## 7. 纯判据清单（零 IO，可单测）

`candidate-rules`（12 条拒绝面）、`batch-rules`（新鲜度 5 条 + 绑定 3 条）、`profile-rules`（模型三件套 + 跨条目引用一致性 + 凭据来源）、`skills-rules`（集合相等，禁计数）、`identity`（身份行逐字 + canonical JSON + digestOfFiles）、`evidence-contract`（结构合法性）。

## 8. 算法

| 问题 | 算法 | 为什么不用朴素做法 |
| --- | --- | --- |
| 场景执行 | Kahn 拓扑排序 + 信号量限流 + 确定性同层排序（按 id） | 手写串行无法表达分支并发；无序执行导致输出不可复现 |
| 失败传播 | `fail-fast` / `collect-all` 两种策略，blocked 不算 fail | 一刀切 fail-fast 会让「多检查一次到底」失效 |
| 幂等写入 | 内容哈希 CAS：读旧哈希 → 算新内容 → 临时文件 → rename → 复算哈希校验 | 「写完即成功」会把半截文件当成结果 |
| 证据去重 | 内容寻址（sha256 路径）+ append-only | 时间戳命名会覆盖（matt 真出过证据被覆盖丢了） |
| 技能判定 | 集合相等 / 子集 / 差集 | 计数会被 hidden 技能骗（11 vs 27） |
| 新鲜度 | 偏序：`isAncestor(baseTip, candidateCommit)` + tip 等值 | 比时间戳不可靠；只比 HEAD 会漏「集成分支不动、main 前进」 |
| 回收 | 三重复核：pid 存活 → 端口释放 → 记录落盘 | 只看 pid 会漏孤儿；只看端口会漏僵尸 |
| 轮询 | 截止时间 + 指数退避（上限）+ 每次发事件 | 固定 sleep 慢且不可诊断；无上限会挂死 |
| 清理 | 所有权标记（`.ownership.json`）+ 最后修改时间排序 + 保留 N | 路径前缀猜测会误删用户数据 |
| 并发安全 | 每实例独立目录 + 原子 `mkdir` 锁（仅兜底路径用） | 共享 home 会串台 |
| 确定性 ID | `sha256(canonicalJson({scenario, step, params}))` 前 16 hex | 随机 uuid 无法复跑对齐 |

## 9. 设计模式与反模式

用：六边形（Ports & Adapters）、Strategy（install/screen/ticket/credential 来源）、Builder（LaunchPlan，`--dry-run` 与真跑同源）、Registry（检查项，可选即缺省）、Command（CLI 薄壳）、State Machine（run 生命周期）、Result（跨边界不抛异常）、Template Method（Scenario 步骤骨架）。

禁用：DI 容器、反射、DSL 解释器、事件总线、通用插件系统、装饰器魔法、全局单例、隐式配置。

## 10. CLI 表面

```
dsh-verify describe [--json]                     能力自省（给 AI 的入口）
dsh-verify self-check [--fix] [--screen] [--json]
dsh-verify launch [--profile <p>] [--keep] [--json]
dsh-verify stop [--id <id>] [--all] [--dir <d>]
dsh-verify isolation [--json]
dsh-verify model [--profile <p>] [--provider --model --api-key-env] [--fix] [--json]
dsh-verify install --tgz <file> [--method extract|cli] [--profile <p>]
dsh-verify skills [--profile <p>] [--expect <n>] [--json]
dsh-verify single-instance [--profile <p>] [--json]
dsh-verify concurrent --count <N> [--profiles a,b,c] [--json]
dsh-verify freeze [--out <d>] [--allow-dirty] [--json]
dsh-verify batch open|status [--name <n>] [--base-ref <r>]
dsh-verify evidence add|archive|verify ...
dsh-verify run <scenario.ts> [--concurrency <n>] [--json]
dsh-verify cleanup [--yes] [--keep-batches 2]
```

全局：`--json`（stdout 只一段 JSON）、`--dry-run`（只出计划）、`--negative <case>`（只跑反例）、`--verbose`（stderr 追加）。
**退出码**：`0` 全过；`1` 有硬检查 fail；`2` blocked/前置缺失（DSH 未安装、适配器缺失、无权限）。stdout 与退出码永远一致；stderr 只放人类可读诊断。

## 11. 证据与身份链

- 候选：`candidate.json`（文件集 + fileDigest + manifestDigest + buildCommit + validity + sourceStable）。
- 批次：`batch.json`（startHead + base{ref,tip,expectedVersion} + candidate + preflight + instance + status）。
- 身份行：`批次 X；候选提交 <40>；候选包 sha256 <64>`，逐字契约，`parseIdentityLine` 只认这一种；发布前检查从**候选文件**读、不读本机 batch.json（跨机器可复核）。
- 证据：`evidence.json` = 检查项 + 证据项 + 身份绑定；**绑定的 candidate 由命令层注入，`--meta` 不得覆盖**。
- 归档：整批复制到 `<root>/evidence-archive/<批次名>-<时间戳>/` + `SHA256SUMS.txt`；**不可变**，更正写旁注文件。

## 12. 安全与秘密

- 环境文件白名单（默认 `PATH`、`GITLAB_TOKEN`、`GLAB_CONFIG_DIR`，可按 profile 扩展但必须显式声明）。
- 凭据三段查找（批次 home → 真实 home → 进程环境），**只注入子进程**；所有输出只报来源名。
- 报错只给文件/行号/变量名，永不回显原行内容。
- 计划（`--dry-run`）/instance.json/回执里**零秘密值**。
- 门禁：canary 密钥全流程 grep 零命中（DoD #7）。

## 13. 对抗式审查矩阵（每条检查必须回答「它怎么撒谎」）

| 检查 | 可能的假绿 | 必备反例夹具 |
| --- | --- | --- |
| 候选身份 | 版本对、字节换了 | 同版本重打包；改一个文件重算清单 |
| 构建身份 | 产物来自上一次构建 | 缓存不强制重建，断言必须红 |
| 隔离 | 以为隔离了，其实写了真实 home | 把探针默认为真实 home，必须红 |
| 实例可达 | 进程在、页面 500 | token 失效 / 端口被占 |
| 技能注册 | 数模型可见数量 | 造 16 hidden 夹具，断言必须用集合 |
| 模型一致性 | 三件套对、vision-router 引用不同 | 造引用不一致，必须红 |
| 凭据可用 | ref 存在但值为空 | 空值/缺值两种夹具 |
| 并发 | 两实例连同一个 home | 交换 home 顺序，断言必须红 |
| 回收 | pid 死、端口占着 | 强杀父进程留子进程 |
| 证据绑定 | 证据来自上一批 | 跨批复制证据文件 |
| 新鲜度 | HEAD 不动但 main 前进 | 造基线前进夹具 |
| 归档 | 归档后又被重跑覆盖 | 同批重跑两次，断言归档不变 |

**执行**：每条在 `tests/negative/*.test.ts` 里，CI 要求「这些用例必须失败」，失败即门禁红。

## 14. 「AI 未预置场景」的验收（这条要讲清楚）

含义：**给 AI 一个我们没提前做成命令的验证场景，它只写一个场景文件就能跑，不需要改 base 一行代码。**

反例（今天的世界）：matt 能做到的每个场景，都是有人**提前写成 `.mts` 命令**的。想验证「3 个实例、绑定不同工作区后端、中途杀掉一路」，只能新写一个命令文件、改工具台、再跑——这就是「未预置场景做不了」。

验收做法：
1. 由人（不在写代码的会话里）先写下一个具体场景，不给技术方案：
   > 「起 3 个实例：一个绑 GitHub 工作区、一个绑 markdown 工作区、一个冷启动（无工作区）。确认三路菜单各自正确、互不串台；然后强杀第 2 路的进程树，断言第 1/3 路仍可操作、第 2 路回收干净（无残留进程/端口/记录）、证据里能看出发生了什么。」
2. AI 只允许新增 `verify/scenarios/three-backends.ts`（调 `createHarness` 的 L2 原语 + `defineScenario`），**不许改 base 源码、不许新增 CLI 命令**。
3. 跑通并产出证据包；若跑不通，判定为**扩展性缺陷**（去修 base 的扩展点），不是「AI 不行」。

这条验收的真正作用：证明我们的封装没有把路堵死。类比：Excel 的价值不是提供了几个预设表格，而是用户能自己写公式——我们交付的是「公式引擎 + 函数」，场景是用户写的「表格」。

## 15. 平台差异

| 能力 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| 进程树回收 | `taskkill /T /F` | 进程组 `kill -TERM`→`-KILL` | 同上 |
| 屏幕探测 | PowerShell `Screen::AllScreens` | `system_profiler` | `xrandr` |
| 命令执行 | `.cmd/.bat` 经 `ComSpec /d /c` | 直接 spawn | 直接 spawn |
| 跨盘判断 | `path.parse().root` 小写比较 | 同 | 同 |
| 首期真机验证 | 必验 | 接口通过、真机可选 | 接口通过、真机可选 |

## 16. 工作包（一次性交付，按依赖排序；可并行）

| # | 包 | 主要文件 | 完成判据 |
| --- | --- | --- | --- |
| W1 | 构建管道 | `scripts/build.ts`（原 `build.mjs` 重写为 TS 后删除）、`scripts/bundle-contract.ts`、`package.json` exports/bin/scripts、`scripts/run-ts.mjs` externals | `npm run typecheck` / `npm test` / `npm run build` 三条全绿；两条构建契约由 `scripts/bundle-contract.ts` 纯函数执行、`test/bundle-contract.test.ts` 正反例覆盖，并用「往 node 入口注入第三方 import → 构建红 → 还原 → 构建绿」实机自证 ✅（已完成） |
| W2 | 契约层 | `contracts/**` | 单测覆盖率 100% 分支（纯函数）；品牌类型编译期生效 |
| W3 | 端口与平台 | `contracts/ports.ts`、`runtime/platform/**` | 三平台替身测试 + Windows 真机测 |
| W4 | 进程与隔离 | `dsh-locator`、`instance-launcher`、`instance-reaper`、`isolation-prober`、`profile-materializer` | DoD 2/3 |
| W5 | 产物与模型 | `model-configurator`、`package-installer`、`plugin-log-reader` | DoD 5 + 装包逐文件核对 |
| W6 | 证据与身份 | `evidence/**`、`identity`、`candidate/batch-rules` | DoD 1/4/11 |
| W7 | 编排与 CLI | `orchestration/**`、`cli/**` | L1 全部命令可用；`describe` 与文档同步 |
| W8 | 适配器 | `adapters/**` | 缺省时 `blocked`，注入时生效 |
| W9 | 反例与门禁 | `tests/negative/**`、`tests/architecture.test.ts` | DoD 11/12 |
| W10 | 文档 | `README.md`、`AGENTS-USAGE.md`（生成） | 与 `describe()` 一致 |
| W11 | matt 迁移 | matt 仓：profile + 场景 + 删除通用代码 | DoD 8 |
| W12 | 四仓接入 | palette / im / prompt / ilife：各一份 profile + script | DoD 9（palette 实际跑通） |

### 16.1 原型资产去向（契约已冻结；runtime/evidence 是未接线原型）

票 01 开工时，仓里已有同一能力的半成品骨架。不写清楚归属，后续票会各自重写一遍；所以这里一次写死：

- **契约层已冻结**：`contracts/**`（14 个文件）的导出签名与语义是票 01 的交付物，被 97 条单测覆盖；后续票只消费，不改签名，确需扩展走票面/adr。
- **`runtime/**` 与 `evidence/**` 是原型**：未接线、无测试、不在 `index.ts` 的 re-export 面里。票 01 对它们的唯一要求是 typecheck 通过；行为正确性由下表接管票负责，接管票接线前它们不得被其他模块 import（`tests/self-contained.test.ts` 门禁保护）。
- **票 02 已接线第一批**：`runtime/types.ts`、`runtime/paths.ts`、`runtime/dsh/discover.ts`（扩展）、新建 `runtime/platform/**`、`runtime/dsh/asar.ts`、`evidence/store.ts`、`declaration/`、`orchestration/`、`cli/args.ts`、`cli/commands/self-check.ts`，`self-check` 已进 `IMPLEMENTED`。本票未动 `runtime/dsh/{home,launch,logs,http-session,isolation}.ts` 与 `evidence/{paths,manifest}.ts`，它们继续按表归 04/05/06/07。

| 原型资产（当前文件） | 现状 | 接管票 | 接管后的验收 |
| --- | --- | --- | --- |
| `contracts/branding.ts`、`result.ts`、`check.ts`、`run-state.ts`、`verification-profile.ts`、`ports.ts` | 冻结，97 测试 | 02 | 02 仅消费；runtime 接线时用端口替身驱动，不改契约签名 |
| `contracts/launch-plan.ts` | 冻结 | 04 | `launch/stop` 命令复用构造规则；单测已覆盖 |
| `contracts/identity.ts`、`contracts/candidate-rules.ts` | 冻结 | 08 | `freeze` 命令实现；候选 12 条拒绝面逐条有反例 |
| `contracts/batch-rules.ts` | 冻结 | 09 | `batch` 命令实现；新鲜度偏序有反例 |
| `contracts/evidence-contract.ts` | 冻结 | 07 | `evidence add/finish` 的清单校验 |
| `contracts/profile-rules.ts` | 冻结 | 10 | `model --fix` 的一致性规则 |
| `contracts/skills-rules.ts` | 冻结 | 03 | `skills-set` 检查（禁计数） |
| `contracts/scenario.ts` | 冻结 | 12 | 场景 DAG 与 L3 逃逸舱 |
| `contracts/ports.ts` 的 `BrowserProbeFactory` / `Ticket` | 冻结 | 11 / 16 | 11 注入 Playwright 适配器（缺省 `blocked`）；16 注入票面适配器 |
| `runtime/types.ts`、`runtime/paths.ts` | **已接管（02）** | 02 | RuntimeFacts/ResolvedPaths 与路径拼写被 self-check 使用；`tests/support/fake-fs.ts` 与 self-check 系列测试全替身驱动 |
| `runtime/fs-utils.ts`（`deleteGuardReason` / `removeTree`） | 原型 | 17 | `cleanup` 用删除守卫验收（盘根/家目录/cwd 拒删） |
| `runtime/dsh/discover.ts` | **已接管（02，已扩展）** | 02 | `dsh-runtime` 检查；新增 PATH wrapper 发现源与 exe-missing/structure-missing 分级（exe 在但 asar 缺 = fail），失败带完整候选列表 |
| `runtime/dsh/home.ts` | 原型 | 04（profile 物化/复制）、12（workspace registry seeding） | 04 补 home 复制与清理单测；12 接 seeder |
| `runtime/dsh/launch.ts` | 原型 | 04 | `launch/stop` 命令 + `instance.json` 生命周期 |
| `runtime/dsh/logs.ts` | 原型 | 04（启动链路的日志定位）、12（日志查询原语） | `logs-readable` 检查接真机日志；坏行计数不致命 |
| `runtime/dsh/http-session.ts` | 原型，**多通道 `POST /api/<channel>/<endpoint>` 写法已被规格纠正** | 04 | 接管时改为规格的单通道 `POST /api/<endpoint>`，并用真机会话冒烟验收 |
| `runtime/dsh/isolation.ts` | 原型 | 05 | `settings-isolated` 探针：子进程真实解析 home + 真机设置文件前后哈希对比 |
| `evidence/paths.ts`、`evidence/manifest.ts` | 原型 | 07 | 内容寻址落盘 + 不可变清单 + `SHA256SUMS` |
| `runtime/platform/**`（02 新建：fs/command/clock/env/process/http/screen/defaults） | 已接线 | 03+ 复用 | 真实 Node 端口（process=detached spawn/taskkill，screen=PowerShell 等 best-effort），失败返回 `Result` 不 throw；测试只用 `tests/support/fake-*` |
| `runtime/dsh/asar.ts`（02 新建） | 已接线 | 02 | 读 Electron asar 头的 pickle 布局定位 host CLI 条目；真实安装实测格式由 `tests/asar.test.ts` 锁定 |
| `evidence/store.ts`（02 新建） | 已接线 | 07 | 02 的最小证据落盘（`runs/<id>/evidence`，同名 `-2`/`-3` 绝不覆盖）；07 在它之上加归档/manifest/`SHA256SUMS`，不重写落盘 |
| `declaration/loader.ts`、`orchestration/**`、`cli/args.ts`、`cli/commands/self-check.ts`（02 新建） | 已接线 | 03/04/11/12/16 扩展 | planSelfCheck → executePlan → report 三阶段；后续票只加 `CheckModule`/命令，不加 DSL/事件总线 |
| `capability-description.ts`、`cli/main.ts`、`docs.ts`（票 01 新建） | 事实源已就位；02 已接线 self-check | 01 冻结；15 使用；02–12 接线 | 15 用 `renderCapabilityMarkdown()` 生成 README/AGENTS-USAGE；各命令实现票只往 `IMPLEMENTED` 加名字，`describe` 一致性测试保持绿。02 增了 `profile-declaration` 检查 id、`--declaration`/`--work-root` 全局参数，并把 `self-check` 的 usage/writes 改成实际行为 |

接线规则：一张票接管一个原型文件时，同时删掉它的「原型」标记（若代码里已有）并把对应检查/命令从 `blocked` 变成可执行；没有接管的原型文件保持无导出、无消费者。

## 17. 风险与显式不做

| 风险 | 处理 |
| --- | --- |
| DSH 内部行为漂移（RPC/目录结构） | 所有访问经契约层；版本探测 + 兼容断言；不兼容给 `prerequisite` 而非崩 |
| Playwright 版本冲突 | 工厂注入，base 不持有；版本由插件仓决定 |
| 跨盘 pnpm store | 默认 extract 策略；cli 策略先判同盘 |
| Windows 屏幕/进程差异 | 单独 platform 层 + 可注入替身 |
| 长跑不稳（端口/时序） | 轮询有截止、失败给诊断包；E2E 单独开关 |
| 过度抽象 | 禁用清单（§9）+ 场景即普通 TS |
| 秘密泄漏 | 白名单 + canary grep 门禁 |
| 文档漂移 | `describe()` 生成文档并校验 |

不做：发布流水线编排（只提供检查）、票面模板生成（只读写）、浏览器以外的 UI 自动化框架、非 DSH 程序的真机验证。

## 18. 迁移映射（matt 现有文件 → 新能力）

| matt 文件 | 去向 |
| --- | --- |
| `launch.mts` / `paths.mts` / `home.mts` / `isolation.mts` / `model.mts` / `logs.mts` / `envfile.mts` / `util.mts` / `presets.mts` | 进 base（泛化 + 参数化），matt 删除 |
| `candidate.mts` / `freeze-candidate.mts` | 进 base（`build.command` 由 profile 提供） |
| `batch.mts` / `preflight.mts` / `prepare-batch.mts` / `check-batch.mts` / `collect-evidence.mts` / `cleanup.mts` | 进 base；检查项注册表化，matt 只保留自己的检查 |
| `two-instance-smoke.mts` | 被 `concurrent-instances` + 场景替代 |
| `browser.mts`（插件 DOM 断言） | 留在 matt，实现 `BrowserProbeFactory` |
| `workspaces.mts`（GitHub/markdown 夹具） | 后端进 base；matt 特有渲染器留在 matt 的 seeder 扩展 |
| `gitlab-sandbox` / `seed-gitlab` / `report-index` / `deck-write` | 留在 matt（可选适配器或纯项目侧） |
| 票面协议（清单票/身份行/收口词汇） | base 的 `adapters/ticket` + 规则文档；词汇由 profile 声明 |
