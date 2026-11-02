# ADR-0002 真机验证能力（real-machine-verification）实现与 DESIGN.md 字面不一致处的裁决

- 状态：已接受（2026-11-02，能力交付收口时补记）
- 相关：`.scratch/真机验证能力-base-库通用能力-一次性全量交付/spec.md`、`packages/base/src/real-machine-verification/DESIGN.md`、`docs/真机验证能力-独立验收记录-第三轮.md`
- 上位规格：spec.md 的行为要求是**准绳**；本文只记录 DESIGN.md（开工前的完整规划）里被现实取代、且不会改回去的部分。

## 背景

真机验证能力按 spec.md 实现并交付。DESIGN.md 自称「该能力的唯一规划」，写于动手之前；实现过程中有若干处**规划的字面写法与实际约束冲突**，或规划只写了目标而没写对现实更有利的手段。这些选择不是顺手偏离：每一处都保留在代码与测试里（架构门禁 `src/real-machine-verification/tests/architecture.test.ts` 会拦住回退），但需要一个集中记录，避免后来者把它们当成 bug 重新「修回去」，也避免下一次评审再次把它们当成未完成的计划。

本 ADR 只记录**与 DESIGN.md 字面不一致、且不会改回去**的决定；DESIGN.md 中已实现的部分（三层模型、四态、身份行、证据不可变、端口注入、四条门禁等）不在此列。

## 决定

### 1. L2 以导出原语交付，不建 `createHarness()` 门面

DESIGN.md §5 声明 `createHarness(options): Promise<Harness>` 与一个含 `launch/stop/isolation/models/packages/skills/logs/evidence/check/step/close` 的 `Harness` 对象。实际交付没有 `orchestration/harness.ts`：L2 是`index.ts` 直接导出的原语——`orchestration/primitives.ts`（`launch`/`stop`、`InstanceHandle`、`PageHandle`）、`orchestration/instance.ts`（`executeInstance` 与隔离 home/进程生命周期）、`orchestration/scenario-run.ts`（`ScenarioDefinition` 执行器）、`contracts/scenario.ts`（`defineScenario`）以及 runtime/evidence 的具名函数。

理由：`Harness` 门面会把「每个原语一个方法」与「命令层已经编排好的流程」变成第二套并行 API，而实际使用方（matt 的 `verify/scenarios/ui.ts`、`smoke.ts`）需要的是**组合**：起实例 → 拿页面句柄 → 自定义断言 → 停实例。用导出的原语组合比先造门面再穿出去更薄；`run` 命令 + `defineScenario` 已覆盖「场景即普通 TS 文件」这个 L3 承诺。

验收影响：DoD #10「AI 未预置场景不改 base」**已达成**，但达成方式是场景文件（matt `verify/scenarios/ui.ts` 577 行、`smoke.ts` 201 行，零改 base），而不是 `createHarness`。需要命令式 L2 的第三方照 `orchestration/primitives.ts` 的导出组合即可；若将来出现第二个消费方且组合代码重复，再补门面，不预先造。

### 2. 反例矩阵内联在各门禁测试里，不建 `tests/negative/*.test.ts` 目录

DESIGN.md §13 写「每条在 `tests/negative/*.test.ts` 里，CI 要求这些用例必须失败」，§16 W9 把 `tests/negative/**` 列为交付物。实际交付的 tests/ 是扁平结构（`tests/*.test.ts` + `tests/support/`），每条检查的「必须红」夹具作为**合成输入**内联在对应门禁测试里，测试断言「门禁拒绝了它」——测试本身是绿的，因为它验证的是拒绝行为。

已落位的反例（举例，均已在 vitest 链上）：
- 架构四门禁：各带 synthetic violation 夹具（`tests/architecture.test.ts` 的 "the gate has teeth" 用例）；
- 依赖方向：`tests/self-contained.test.ts` 的 5 条合成越界；
- 候选/批次/模型/技能/证据：`tests/freeze.test.ts`、`tests/batch.test.ts`、`tests/model-configurator.test.ts`、`tests/skills-*.test.ts`、`tests/evidence-archive.test.ts` 等各自的反例组；
- 启动钩子失败：`tests/launch-orchestration.test.ts`「beforeStart throws → prerequisite，且没有 spawn」；
- 文档漂移：`test/docs-sync.test.ts` 用临时根造 stale/missing 块。

理由：一个「必须失败」的测试文件无法直接接进 vitest 链（需要一个元跑器把期望失败翻转），而「断言门禁拒绝了坏输入」是同一副牙齿，且失败信息直接指出哪条判据没拦住。CI 仍要求它们全绿；「坏输入必须被拒」这一不变量没有降级。

### 3. 环境白名单以 spec 与实现为准，DESIGN.md §12 的默认名单作废

DESIGN.md §12 写「环境文件白名单默认 `PATH`、`GITLAB_TOKEN`、`GLAB_CONFIG_DIR`，可按 profile 扩展」。实现（`contracts/launch-plan.ts`）按 spec.md 的「父进程环境不得整体下传：子进程只收白名单 + 声明值 + 解析出的模型密钥」分层：

1. `BASE_ENV_ALLOWLIST`：18 个宿主管道变量（`PATH`、`PATHEXT`、`SystemRoot`、`windir`、`ComSpec`、`SHELL`、`TERM`、`LANG`、`LC_ALL`、`LC_CTYPE`、`TEMP`、`TMP`、`TMPDIR`、`HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME`）；
2. profile 声明的 `instanceEnvAllowlist`（插件特有的名字由插件仓在 `verify/profile.ts` 里声明，例如 matt 声明 `GLAB_CONFIG_DIR`/`GITLAB_TOKEN`/`GLAB_BIN`）；
3. 固定实例变量（`ELECTRON_RUN_AS_NODE`、`DSH_HOME`、`USERPROFILE`、`HOME`）；
4. 模型密钥最后注入并可覆盖同名值。

理由：`GITLAB_TOKEN`/`GLAB_CONFIG_DIR` 是**插件特有**名字，写进核心默认名单会直接违反门禁 2（无插件常量）。plugins 白名单必须由声明给出，这也正是 spec「只收白名单 + 声明值」的字面要求。

### 4. 门禁 2（无插件常量）保留宿主 schema key 例外

`llm-pi-ai` 与 `agent-default-model` 在 `contracts/profile-rules.ts`、`orchestration/checks/model-configured.ts` 等生产代码里出现。它们不是目标插件身份，而是 **DSH 宿主的 profile 配置 schema key**：模型最小 patch（spec Implementation Decisions「模型只最小编辑 patch」）必须按这两类条目定位，换成 profile 字段反而会扩大声明面。

裁决：门禁 2 禁止的是「具体插件名 / `.dsh-<插件缓存>` 字面量 / profile 名常量」，宿主 schema key 不在其列；`tests/architecture.test.ts` 的 token 表刻意不含这两个名字，并用一条「允许宿主 key、注释与模板文本」的正向用例把边界锁住。新增任何目标插件名仍会红。

### 5. DoD #8 的迁移比例实测低于计划的 >85%

DESIGN.md DoD #8 写「删除 >85% 通用代码」。matt 迁移实测：旧工具台 `scripts/real-machine/{commands,lib,README}` 合计 13,664 行，删除 41 个跟踪文件 9,591 行（**70.2%**）；保留 15 个文件 4,073 行，全部为插件特有（GitLab 沙箱、deck 票面写入/读回、种子数据、日志查询、报告索引）；新增 22 个文件 4,180 行（其中 verify/ 树 2,225 行、场景与门禁测试）；净 **−5,752 行**。

理由：规划时的 85% 把旧台当成「几乎全通用」，实测其中约 4,000 行是服务本插件发布流程的 GitLab/deck/report-index 工具，通用化会违反「能力归属：核心归 base，插件仓负责验证什么」。保留项在票 13 的票面逐条写明理由；迁移后 matt 的 `npm test` 85 条门禁 / 9,020 条断言全绿，真机 11 步全绿，能力不减反增。

结论：DoD #8 的数字部分**未达标**，但它的意图（删掉重复造轮子的通用代码、留下插件特有部分、能力不减）已达成；不为了凑比例删掉仍需的插件工具。

### 6. 四条架构门禁集中在两个文件，且是「扫描 + 反例」双段式

DESIGN.md §4 的四条门禁现在都由 `src/real-machine-verification/tests/architecture.test.ts`（方向、无插件常量、零依赖）与 `test/docs-sync.test.ts`（文档同步：`scripts/docs.ts` 的 `checkDocs` 对 README/AGENTS-USAGE 逐字校验）覆盖。

为什么文档同步门禁不在同一个文件：`tsconfig.build.json` 的 `rootDir` 是 `src`，`scripts/docs.ts` 在 `src` 之外，`src` 下的测试**静态 import 它会让声明构建失败**（TS6059）。把这条门禁放在 `test/` 下是对构建约束的让步；四条门禁的扫描器与反例组织方式仍一致（扫描 + synthetic violation 双段）。

方向与零依赖此前已在 `tests/self-contained.test.ts`、`test/bundle-contract.test.ts`、`test/dist-contract.test.ts` 有覆盖；集中版刻意**再实现一遍**（手写字符扫描器，跳过注释/字符串/模板，不用 TS compiler API——仓库依赖的 TypeScript 7 原生包不提供稳定的 parser 入口），并让每条扫描各带合成反例。重复的扫描不是冗余：它们读的是不同层（源码 vs 构建产物），且失败时指向不同修复动作。

### 7. `candidate` 缺失在发布门禁里记 skip，不记 blocked

DESIGN.md §11 只定义候选必带。发布门禁实现（`orchestration/release-gate/plan.ts`、`run.ts`）在调用方没有提供候选清单时，`release-candidate-valid` 记 `skip` 并在报告里写明「no candidate manifest was supplied」，其余票面检查照常执行。

理由：发布门禁有两条使用路径（发布流水线与人工预检）。人工预检可以先跑票面一致性、候选身份稍后补；把缺候选当成 blocked 会让「票面检查」永远无法单独跑。缺候选时**不能**给 pass，skip 正是「未验证」的语义（四态里已定义）。

### 8. 会话建立只发 `token`，不显式带 `interactions=none`

spec.md:87 写字面形式 `GET /connect?token=…&interactions=none`；实现（`runtime/dsh/http-session.ts:96`）只发 `token`，`tests/http-session.test.ts:70` 还断言 URL 里没有 `interactions`。

依据：宿主调研文档 `docs/DSH宿主可观测面-真机验证调研.md:81-82` 明确纠正过这一点——宿主代码是 `declarations = url.searchParams.getAll("interactions"); interactions = declarations[0] ?? "none"`，**省略即 none**，而重复声明或非法值会直接 400。显式带上参数反而把一个合法默认值写成了必须逐字匹配的协议，且给「重复声明」留了错误面。spec 的这句是调研前的旧写法，实现按宿主事实执行；不改代码。

### 9. 自定义技能根（rank 300）在只读枚举里是声明字段，不参与观察

spec.md:91 写「六个根 × 已知 rank 100/200/300/400/500/600」。`orchestration/checks/skills-observation.ts:78-83` 的 `planSkillRoots` 把 rank 300（custom）声明为 `path: null` 并注明 `customSkillDirs` 无法在只读条件下枚举：它在宿主配置里，不在文件系统固定位置。

实现保留「六根」这个模型（证据里仍列 300 这个 rank，标 ignored），实际观察 project-dsh 100 / project-agents 200 / user-dsh 400 / user-agents 500 / bundled-env 600 五个可观察根；插件若必须证明 custom 根，可在 `verify/profile.ts` 的 `checks` 里注入一个读宿主 HTTP API（`skills/list` 或插件自开只读端点）的自定义检查，把结果作为补充证据。spec 的「六根」是模型完整性，不是「六个都能只读取到」。

### 10. 发布门禁不新增 CLI 命令

spec.md:166 把票面协议的实现划给适配器层，Out of Scope 也写「具体实现属适配器层，另有规格」。ticket 16 因此在 base 交付：`contracts/ticket-face.ts`（`TicketFaceAdapter` 四方法）、`contracts/release-gate.ts`（报告/发现/检查 id）、`orchestration/release-gate/{plan,run,report}.ts`（纯规则 + 编排）、`adapters/ticket-face/loader.ts`（校验并加载适配器），由 `index.ts` 导出，但 **不增加 `dsh-verify gate` 命令**（`describe` 的 15 条命令不含它）。

理由：门禁消费的是发布仓自己的票面协议（GitHub/GitLab 的清单票与评论格式）和候选清单，没有与插件无关的通用 CLI 形态；强行做成命令会把「读哪个仓的哪张票、用 gh 还是 glab」的接线塞进核心。实际形态是接入仓写一个组合根（matt 的 `scripts/lib/release-preflight-gate.mts` 是全仓唯一 `import { runReleaseGate }` 的地方）+ 自己的适配器（`verify/ticket-face.mts`），再把「缺适配器/缺环境」映射成 `PREFLIGHT-BLOCKED`。ticket 16 的验收（同一个组合根、两条发布路径同一份代码、无跳过开关）就是在这个形态下证明的。

### 11. 技能重复在文件树路径下端到端不可达，只作为纯规则与 registry 路径能力保留

spec.md:126 要求技能集检查能识别「重复」，`contracts/skills-rules.ts` 的 `compareSkillSets` 也确实统计重复；但在文件树路径上，`orchestration/checks/skills-set.ts` 先把各根观察 `mergeSkillObservations` 再比较，而每个根只枚举第一层目录、目录名天然唯一——因此端到端夹具造不出重复，重复检测只在 HTTP registry 数据路径上有意义（`tests/skills-observation.test.ts` 用合成 registry 条目覆盖了规则本身）。

裁决：不为此在文件树路径硬造一条不可达的夹具，也不删规则；把限制写进本文。插件若真需要证明重复技能，用 `verify/profile.ts` 的 `checks` 注入一个读宿主 `skills/list` 的自定义检查（与决定 9 的 custom 根处理同一条路）。

## 对抗审计复核补记（2026-11-02）

交付前的对抗式审计提出「测试只断言纯函数、没有 CLI 级反例」「自定义技能根不可观察」等意见。复核结论：#9（custom 根）与 #2（反例内联）已经覆盖前两项的取舍，不重开决定；同时补了三条真正的缺口—— `tests/capability-description.test.ts` 新增「每个 advertised check id 必须在源码里被 emit / 每个字面 `checkId("…")` 必须 advertised」门禁；`tests/batch.test.ts` 新增进程内 CLI 级的 ghost 候选反例（不在批次目录、tgz 缺失/被换、文件摘要不符、HEAD/版本不符、基线不包含、包含关系 unknown）与两阶段 open 的 prepare/seal 流程；`tests/real-home-guard.test.ts` 补「真实 home 子目录」「junction」「DSH_REAL_HOME 不再生效」三条真实写盘反例。

## 影响

- 这些决定都写进了代码、测试或本 ADR；回退其中任何一条都会改变对外行为或让门禁变红，需要新 ADR 覆盖本文件。
- 已知限制（#9、#11）：custom 技能根与文件树路径下的技能重复都无法端到端观察，需要时用自定义检查补证。
- DESIGN.md 在相应小节加了 as-built 注记并指向本文；`§3`/`§5`/`§16` 的**文件名清单**是开工计划，实际模块布局以 `src/real-machine-verification/` 的源码树为准。
- 五仓接入形态与 base 发版节奏不属于设计偏离：开发期各仓用 `file:` 指向本地 base 验证，发布前需先发布含本能力的 base 版本（0.1.6+）再钉精确版本——这是 spec「依赖钉精确版本」的交付约束，不是对 DESIGN.md 的偏离。
