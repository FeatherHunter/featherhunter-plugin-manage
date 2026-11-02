# 真机验证（real-machine-verification）

把插件装进一个**真实的 DSH 实例**，看它是不是真的活着：复制一份 profile 起实例、走 HTTP 与页面判据、把证据和身份链落盘，让下一个人能在自己机器上复核同一份结论。

接入是五步：**安装 → 声明 → 两条脚本 → 跑 `self-check` → 读报告**；每步末尾给完成判据。只读闭环跑通后，同一份声明还能驱动起停实例、并发隔离、打包冻结、批次身份、证据归档、场景执行与清理（冻结/批次要求插件仓是 git 工作树：有提交、`HEAD` 可解析）。

- 本文件是**人**的入口：怎么接入、怎么读结果。
- [AGENTS-USAGE.md](AGENTS-USAGE.md) 是 **agent** 的入口：命令选择、错误码、证据与身份链、扩展边界。
- 设计取舍与算法见 [DESIGN.md](DESIGN.md)；唯一权威表面是 `dsh-verify describe --json`，本文件末尾的参考段由它生成（改描述后跑 `npm run docs:sync`）。

## 第一步：安装

在插件仓里把 base 装成 devDependency，**钉精确版本**（`0.1.6` 起 `./real-machine-verification` 导出与 `dsh-verify` bin 随 npm 发布；当前 `0.1.8`）：

```bash
npm install --save-dev dsh-featherhunter-plugin-base@0.1.8
```

base 的核心零运行时依赖（只用 Node 内建模块，副作用全走可注入端口），装进任何插件仓都不会改变它的依赖树。要试**尚未发布**的本地 base 改动时，用 `file:` 链接本仓，只在本地开发期用，提交前改回精确版本：

```bash
npm install --save-dev file:D:/dsh-plugin/featherhunter-plugin-manage/packages/base
```

npm 会把绝对路径归一化成相对路径写进 `package.json`（例如 `file:../../dsh-plugin/featherhunter-plugin-manage/packages/base`）：它相对插件仓解析，仓不挪就仍指向同一份；挪仓/换机器后重跑一次即可。

### 完成判据：`--version` 第二行是 capability 行

装好后有两个 bin：`dsh-verify`（真机验证 CLI）与 `dsh-base`（base 自己的工具）。在插件仓根目录确认跑的是 base：

```bash
node_modules/.bin/dsh-verify --version         # 第二行必须是：capability real-machine-verification (schema 1)
node_modules/.bin/dsh-verify describe --json   # 应列出 15 条命令、schemaVersion 1
```

> ⚠️ **唯一判据是 `--version` 的 `capability` 行；包名与退出码都不算。**
>
> npm registry 上有一个**同名无关包** `dsh-verify@0.9.6`：bin 没装好时，裸 `npx dsh-verify` 会静默下载它、打印另一个工具的 usage 并 exit 0；`npx --no-install` 也挡不住——实测它会复用 npx 缓存里同名的包，同样以 exit 0 打印别的工具的 usage。
>
> 本文命令因此都用不经过 npx 的形式：`node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js <命令>`（不依赖 PATH，也不经过 npx 缓存）。想用短命令 `node_modules/.bin/dsh-verify <命令>`（Windows PowerShell：`.\node_modules\.bin\dsh-verify.cmd <命令>`）时，先按上面核对 capability 行；核对不过就是没装对，回第一步重装。bin 是旧 shim 时也会在这里暴露，而不是等到某个命令里抛 `MODULE_NOT_FOUND`。

## 第二步：写 `verify/profile.ts`

在插件仓根目录创建 `verify/profile.ts`（Node 22.6+ 原生支持 TypeScript；更低的 Node 用下面的 `--declaration` 配合预编译）：

```ts
import { defineVerificationProfile } from "dsh-featherhunter-plugin-base/real-machine-verification";

export default defineVerificationProfile({
  id: "my-plugin",
  packageName: "my-plugin",
  defaultProfile: "web",
  clientEntry: "lib/client.js",
});
```

四个必填字段：

- `id`：检查报告里的能力 id，小写 kebab-case；
- `packageName`：要验证的 npm 包名（会拿它去对应 profile 的 `node_modules` 里找）；
- `defaultProfile`：用哪个 DSH profile（`--profile <name>` 可覆盖）。名字就是 `<DSH_HOME>/profiles/` 下的目录名（`ls ~/.dsh/profiles`；Windows：`Get-ChildItem $env:USERPROFILE\.dsh\profiles`）。一个包可能同时装在多个 profile 里：凡 `<profile>/package.json` 的 `dependencies` 声明了 `packageName`、且 `<profile>/node_modules/<packageName>/package.json` 存在，它就是可选目标；`self-check` 只对本次指定的 profile 下结论（一份报告只证明一个 profile），写错会在 `profile-present` 报 blocked，不会静默换一个；
- `clientEntry`：包内客户端入口的相对路径，self-check 会算它的 sha256。

其余字段全部可选，声明的是**事实**：`pluginCacheDir` / `pluginSettingsDir`（插件自己的状态目录，隔离探针用）、`bundledSkills`（随包发布的技能目录与数量）、`model`（插件要求的模型选择，或 `false` 表示不装模型）、`browser`（浏览器适配器模块）、`ticketFace`、`workspaceBackends`、`build`（候选冻结前要先跑的构建命令）、`instanceEnvAllowlist`（起实例时允许透传的环境变量）、`hooks`（起停前后钩子）、`checks`（插件特有的自定义检查）。字段清单与含义以 `describe --json` 为准。

工具按 `verify/profile.ts` → `verify/profile.js` → `verify/profile.mjs` 的顺序自动发现，也可以用 `--declaration <file>` 显式指定（相对路径按当前目录解析）。声明只描述事实，副作用留给命令本身。

**完成判据：** `self-check` 的 `profile-declaration` 检查为 `ok`（第四步会跑到；`describe --json` 能加载声明也是同一个信号）。

## 第三步：把两条命令写进 package.json

接入仓只需要两条 script：一条给人跑（逐项结果走 stderr），一条给 CI 或 agent 取 JSON。

```json
{
  "scripts": {
    "verify": "node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js self-check",
    "verify:json": "node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js self-check --json"
  }
}
```

不写 script、直接敲长命令也能跑；写进去是为了让接入仓自己的 README 可以只写 `npm run verify`，而且不必每个人记住 dist 路径。

打包白名单 0–1 行：插件仓的发布包通常不该带上 `verify/`（声明、场景、浏览器适配器是开发期验证资产）。仓里已有 `files` 白名单时不用改——白名单没列 `verify/` 就不会被打进包；没有白名单的仓加一行 `.npmignore`：

```text
verify/
```

**完成判据：** `npm run verify` 能启动到自检（下一步验证）；脚本写错通常立刻以 `MODULE_NOT_FOUND` 或 usage 行暴露。

## 第四步：运行

```bash
# 推荐：直接跑装好的构建产物（在插件仓根目录；不经过 npx，不依赖 PATH）
node node_modules/dsh-featherhunter-plugin-base/dist/real-machine-verification/cli/main.js self-check

# 短命令（先用上一步核对过 --version 的 capability 行）
node_modules/.bin/dsh-verify self-check

# 在 base 仓自己的 packages/base 目录里，路径相对当前包（仅限 base 仓）
node dist/real-machine-verification/cli/main.js self-check
```

`self-check` 是最小闭环：它只读不写（除了报告与证据），**8 项常驻检查 + 1 项 `--screen` 软检查**回答「这台机器、这个仓、这个 profile 能不能证明这个插件是活的」。完整用法（与 `describe` 输出一致）：

```text
dsh-verify self-check [--profile <p>] [--declaration <file>] [--work-root <dir>] [--screen] [--json] [--dry-run]
```

常用旗标：`--profile`、`--declaration`、`--work-root`、`--screen`、`--json`；写操作先 `--dry-run` 看计划。

**完成判据：退出码 `0`**（skip 允许），报告里的硬检查为 `ok`。退出码 `2` 是 blocked：前置没备好，本次什么都没证明，补齐前置再跑；退出码 `1` 才是插件/仓的硬失败。

跑通后按问题选命令，代价从低到高，前一层不绿不进下一层：

| 想回答的问题 | 命令 |
| --- | --- |
| 一个实例真的能起来、页面在、能停干净？ | `single-instance` |
| 两个实例同时起会不会互相踩（端口/home/缓存）？ | `concurrent` |
| 这个提交的产物能不能当候选包（版本、文件摘要、可安装）？ | `freeze` |
| 这一轮验证绑定的是哪个候选、基线有没有漂？ | `batch open` / `batch status` |
| 证据怎么归档、怎么复核？ | `evidence add` / `archive` / `verify` |
| 插件特有的端到端场景怎么跑？ | `run` |
| 起实例的细粒度控制（起/停/隔离/模型/安装/技能）？ | `launch` / `stop` / `isolation` / `model` / `install` / `skills` |
| 跑完怎么收尾？ | `cleanup` |

全部命令都支持 `--json`；写操作类命令都支持 `--dry-run`，dry-run 打印的计划与真实执行是同一份结论。冻结与批次身份要求插件仓是 git 工作树：`freeze` 用 `HEAD`、工作区状态与文件摘要定位候选。命令的完整 usage、写入物与退出码见文末参考段。

### 批次：先开、再冻、再封

批次身份要在候选存在之前开始，否则「候选早于批次」这条判据永远失败；候选也必须冻在批次目录里。`batch open` 因此分两段：

1. `batch open --name <批次名> --base-ref <ref>`：只写 `batch.json`（`candidate: null`），打印基线行与下一步提示；
2. `freeze --out <批次目录>/pkg`：把候选冻进批次目录（`freeze` 会在 `--out` 下建 `<提交前缀>-<时间戳>/` 子目录）；
3. `batch open --name <批次名> --candidate <批次目录内的候选目录>`：按固定九条顺序实测候选，通过才写候选身份并打印身份行；拒收 exit `1`，前置无法测量 exit `2`。

九条判定顺序、身份行/基线行的逐字格式、`--allow-stale` 的降级范围与 `batch status` 的 `candidate-identity` 重算规则，以 [AGENTS-USAGE.md](AGENTS-USAGE.md) 第 3 节为唯一真源。

## 第五步：读报告

人话模式每个检查一行，`ok|fail|skip|blocked <检查id> <说明>`；fail 行带缩进的 expected / actual / hint，blocked 至少带 hint：

```text
ok profile-declaration loaded ts declaration C:\repo\verify\profile.ts (export default)
ok dsh-runtime found DSH at C:/DeepSeekHarness (executable C:/DeepSeekHarness/DeepSeek Harness.exe)
ok node-version Node 24.19.0 satisfies the 22.6.0 floor for ts declarations
ok profile-present profile "web" is present under C:/Users/me/.dsh (manifest 0.0.1)
ok package-installed my-plugin 2.1.11 is installed in profile web; clientEntry lib/client.js sha256 <64 hex>
report: <work-root>/runs/<runId>/run.json
report-sha256: <64 hex>
evidence: <work-root>/runs/<runId>/evidence (<n> item(s))
```

- 退出码：`0` 全过（允许 skip）/ `1` 有硬失败 / `2` 有 blocked（前置缺失，本次运行对插件什么也没证明）；
- `blocked` 不是 `fail`：没装 DSH、没有 profile、没注入可选适配器都属于 blocked，环境缺失不会被记成插件缺陷；
- `--json` 时 stdout 是**一段** JSON（checks、步骤、退出码与 `artifacts.reportSha256`），人话渲染与逐项进度在 stderr；
- 报告落在 `<work-root>/runs/<runId>/run.json`，旁边有 `run.json.sha256`（`sha256sum` 格式的 `<64 hex>  run.json`）。POSIX 可 `sha256sum -c run.json.sha256`；Windows 没有 `sha256sum`，而 `Get-FileHash` 只输出 hash、不带文件名，所以取 sidecar 的**第一列**再比（整行比较必然假失败）：

  ```powershell
  $expected = ((Get-Content .\run.json.sha256 -Raw) -split '\s+')[0]
  $actual = (Get-FileHash .\run.json -Algorithm SHA256).Hash.ToLower()
  if ($expected -eq $actual) { "match" } else { "MISMATCH" }
  ```

- 证据在 `evidence/` 下（命令输出、环境快照、客户端入口哈希等），同名证据加 `-2`/`-3` 序号、绝不覆盖。默认工作根在仓库内 `<cwd>/.scratch/verify`（应被仓库 `.gitignore` 忽略），真机冒烟可指向系统临时目录。

**完成判据：** sidecar 第一列等于 `Get-FileHash`（或 `sha256sum -c` 通过），报告路径与 sha256 随结论一起记录。

## 真实 home 只读

所有跑实例的命令都支持 `DSH_HOME` 覆盖：指向一份**复制出来的 profile**（例如 `<work-root>/home`），命令就只动副本，真实 `~/.dsh` 一个字节都不写。批次（batch）把这件事做成语义：批次 home 就是本轮验证的隔离环境，报告里的 `dshHome` 指向批次 home 是正确结论而不是缺陷。第一次接入建议先复制一份真实 profile 再跑 `single-instance`，确认「真实 home 前后 sha256 不变」这条证据。

关键文件清单：`<DSH_HOME>/.credentials.yaml`、`<DSH_HOME>/profiles/<profile>/package.json`、`<DSH_HOME>/profiles/<profile>/cordis.patch.yml`、`<DSH_HOME>/profiles/<profile>/node_modules/<packageName>/package.json`。只对这份固定清单做前后 sha256——整目录哈希会假阳性（宿主常驻时 `~/.dsh/storages` 空闲也会自己变）：

```powershell
$files = @("$env:USERPROFILE\.dsh\.credentials.yaml", "$env:USERPROFILE\.dsh\profiles\web\package.json")
$before = $files | ForEach-Object { (Get-FileHash $_ -Algorithm SHA256).Hash }
# …跑命令…
$after = $files | ForEach-Object { (Get-FileHash $_ -Algorithm SHA256).Hash }
Compare-Object $before $after   # 无输出 = 未变
```

`install`（和 `model --fix`）的默认目标是 `DSH_HOME` 指向的 profile。命令按**解析后的目标 DSH home** 判断隔离：只要它等于或**落在**真实 home（`~/.dsh`）里面（含 `DSH_HOME` 被指到真实 home、其子目录或指向它的 junction 的情况），真实安装/写盘会直接**拒绝**（exit 2、`[prerequisite]`，hint 指向复制成批次 home 再装）；`--dry-run` 仍会出计划但只警告、不写盘。不能只看 `DSH_HOME` 有没有设。

显式写目标同样受这条纪律约束：`--work-root`、`--out`、`--archive-root` 解析后落在真实 home 里面时，非 dry-run 在命令开始前就**拒绝**（exit 2、`[prerequisite]`，错误里点名是哪个 flag），dry-run 只警告。

## self-check 检查了什么

| 检查 id | 通过条件 | 缺失/失败时 |
| --- | --- | --- |
| `profile-declaration` | `verify/profile.ts` 存在、可导入、字段合法 | 缺失 = blocked（hint 带可直接复制的模板）；声明非法 = fail |
| `dsh-runtime` | 找得到 DSH 可执行文件与 `resources/app.asar` 里的 host CLI 入口 | 没装 = blocked；装了但结构不完整 = fail（expected vs actual） |
| `node-version` | 本次运行满足声明类型的 Node 下限（`.ts` 需 22.6+，`.js` 需 18+） | 不足 = fail，hint 给升级或用 tsc 预编译两条路 |
| `profile-present` | `DSH_HOME`（或 `~/.dsh`）下有 `profiles/<profile>` 目录和 `package.json` | 缺失 = blocked |
| `package-installed` | profile 依赖里声明了 `packageName`、已安装、`clientEntry` 存在且算出 sha256；cwd 是该插件仓时版本必须与声明一致 | 未装/入口缺失/版本不一致 = fail（hint 给安装命令）；profile 目录不存在 = blocked（环境问题，不算插件缺陷） |
| `skills-set` | 仓库侧与安装副本的技能集合都和声明的 `bundledSkills` 一致（逐个技能目录的 frontmatter `name` 必须等于目录名） | 任一侧掉技能、目录名与 frontmatter 名不一致 = fail（点名到目录）；安装副本没有技能目录 = blocked |
| `model-configured` | profile 补丁层（`cordis.patch.yml`）逐字声明 provider / model / apiKeyEnv，且 models 列表包含该 model id | 任一字面不一致 = fail（expected/actual 给两处值）；补丁层缺条目 = blocked |
| `model-credential` | `model.apiKeyEnv` 这个引用名能从真实 home 的凭据存储（`<DSH_HOME>/.credentials.yaml` 的 `refs`）或进程环境解析 | 都找不到 = blocked（hint 指向 env 变量与 DSH 设置）；报告只写来源与是否可用，不读值 |
| `screen-present` | 仅在 `--screen` 时计划，能枚举到显示器 | 探测失败 = blocked，绝不计 fail |

可选能力（browser / screen）没注入时，对应检查只 blocked/skip，不产生 fail——这是硬契约，有测试锁定。技能检查只读文件树与 frontmatter（带 `disable-model-invocation: true` 的技能仍会被宿主注册，从模型侧计数会得出错误的缺口；平铺 `.md` 没有 frontmatter `name` 时是说明文档，不计入技能集合）。模型与凭据检查只消费引用名（provider / model id / apiKeyEnv / 凭据 ref 名），任何检查都不读取、记录或打印密钥值。

## 常见卡点

| 现象 | 说明与修法 |
| --- | --- |
| `blocked profile-declaration` | 仓根没有 `verify/profile.ts`；hint 里有十行模板，复制后把四个字段改成自己包的 |
| `fail package-installed`，actual 版本与仓内版本不同 | 先把**当前代码**装进隔离 profile：`dsh-verify install --tgz <候选包>`（先用 `freeze` 打包），或在 profile 副本里 `npm install`；profile 里装的是旧版本时 self-check 会拒绝证明新代码 |
| `fail node-version` | 用 Node 22.6+ 跑，或者把声明预编译成 `.js`（`--declaration verify/profile.js`） |
| `blocked model-configured` | profile 的 `cordis.patch.yml` 里没有对应 provider/model 条目——`model --fix` 只改已有条目不新建；插件不装模型时在声明里写 `model: false` |
| `blocked instance-pages` / 页面检查 | 没注入浏览器适配器；声明 `browser: { module: "verify/browser.mjs" }`，模块默认导出 `{ launch({ headless }) }` 工厂 |
| `fail package-installed` 还点名「installed copy is missing N skill(s)」 | 发布包的 `bundledSkills` 目录掉了技能；宿主自己的技能树不算包带上了它，重建包再装（`skills-set` 的 hint 给了要重建的目录） |
| 退出码 2 但检查全绿感 | 2 是 blocked：本次运行有前置缺失，什么都没证明；修前置再跑，不要把它当成插件的失败 |

更细的失败分型、错误码词表、证据与身份链、以及「哪些场景不用改核心就能表达」见 [AGENTS-USAGE.md](AGENTS-USAGE.md)。
## 参考（自动生成，勿手改）

本段由 `dsh-verify describe` 生成：命令、内建检查 id、profile 字段、退出码与全局选项都以那段为准。改完能力描述后运行 `npm run docs:sync`，`docs:check` 与测试会拦住漂移。

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
