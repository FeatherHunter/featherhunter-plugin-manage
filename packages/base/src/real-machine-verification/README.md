# 真机验证（real-machine-verification）

把 `dsh-featherhunter-plugin-base` 加进插件仓依赖 → 写 `verify/profile.ts` → 跑 `npx dsh-verify self-check` → 读报告（人话行 / `--json` / 退出码 / 证据目录）。这四步就是今天可用的全部入口；更远的 launch / model / isolation 等命令已在 `describe` 契约里，但尚未实现。

## 第一步：安装

```bash
npm install --save-dev dsh-featherhunter-plugin-base@^0.1.5
```

base 的核心零运行时依赖（只用 Node 内建模块，副作用全走可注入端口），装进任何插件仓都不会改变它的依赖树。也可以直接在插件仓的 `package.json` 里写：

```json
{
  "devDependencies": {
    "dsh-featherhunter-plugin-base": "^0.1.5"
  }
}
```

## 第二步：写 `verify/profile.ts`

在插件仓根目录创建 `verify/profile.ts`（Node 22.6+ 原生支持 TypeScript；更低的 Node 见下文的 `--declaration`）：

```ts
import { defineVerificationProfile } from "dsh-featherhunter-plugin-base/real-machine-verification";

export default defineVerificationProfile({
  id: "my-plugin",
  packageName: "my-plugin",
  defaultProfile: "web",
  clientEntry: "lib/client.js",
});
```

- `id`：检查报告里的能力 id，小写 kebab-case；
- `packageName`：要验证的 npm 包名（会拿它去对应 profile 的 `node_modules` 里找）；
- `defaultProfile`：用哪个 DSH profile（`--profile <name>` 可覆盖）；
- `clientEntry`：包内客户端入口的相对路径，self-check 会算它的 sha256。

工具会按 `verify/profile.ts` → `verify/profile.js` → `verify/profile.mjs` 的顺序自动发现，也可以用 `--declaration <file>` 显式指定（相对路径按当前目录解析）。声明只描述事实，不要在里面做副作用。

## 第三步：运行

```bash
# 作为依赖装好之后
npx dsh-verify self-check

# 或者直接跑构建产物（不依赖 PATH）
node dist/real-machine-verification/cli/main.js self-check
```

`dsh-verify self-check [--profile <p>] [--declaration <file>] [--work-root <dir>] [--screen] [--json]`

| 选项 | 作用 |
| --- | --- |
| `--profile <p>` | 覆盖声明里的 `defaultProfile` |
| `--declaration <file>` | 显式指定声明文件（相对路径按 cwd 解析） |
| `--work-root <dir>` | 报告与证据写到哪；默认 `<cwd>/.scratch/verify` |
| `--screen` | 额外做一次显示器探测（best-effort，失败是 blocked 不是 fail） |
| `--json` | stdout 只输出一段 JSON 报告，进度与人话行改走 stderr |

## 第四步：读报告

人话模式每个检查一行，`ok|fail|skip|blocked <检查id> <说明>`；fail 的行后面带缩进的 expected / actual / hint：

```text
ok profile-declaration loaded ts declaration C:\repo\verify\profile.ts (export default)
ok dsh-runtime found DSH at C:/DeepSeekHarness (executable C:/DeepSeekHarness/DeepSeek Harness.exe); app.asar contains dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js (5607 bytes)
ok node-version Node 24.19.0 satisfies the 22.6.0 floor for ts declarations
ok profile-present profile "web" is present under C:/Users/me/.dsh (manifest 0.0.1)
ok package-installed my-plugin 2.1.11 is installed in profile web and matches the checked-out repository; clientEntry lib/client.js sha256 <64 hex>
report: <work-root>/runs/<runId>/run.json
report-sha256: <64 hex>
evidence: <work-root>/runs/<runId>/evidence (<n> item(s))
```

- 退出码：`0` 全过（允许 skip）/ `1` 有硬失败 / `2` 有 blocked（前置缺失，本次运行对插件什么也没证明）；
- `blocked` 不是 `fail`：没装 DSH、没有 profile、没注入可选适配器都属于 blocked，不会把一个环境缺失记成插件缺陷；
- `--json` 时 stdout 是**一段** JSON，包含 checks、步骤、退出码与 `artifacts.reportSha256`；人话渲染与逐项进度在 stderr；
- 报告落在 `<work-root>/runs/<runId>/run.json`，旁边有 `run.json.sha256`（`sha256sum -c` 可直接校验）；`evidence/` 下是命令输出、环境快照、客户端入口哈希等证据文件，同名证据加 `-2`/`-3` 序号、绝不覆盖。默认工作根在仓库内 `<cwd>/.scratch/verify`（仓库 `.gitignore` 已忽略），真机冒烟可指向系统临时目录。

## self-check 检查了什么

| 检查 id | 性质 | 通过条件 | 缺失/失败时 |
| --- | --- | --- | --- |
| `profile-declaration` | 硬 | `verify/profile.ts` 存在、可导入、字段合法 | 缺失 = blocked（hint 里带可直接复制的模板）；声明非法 = fail |
| `dsh-runtime` | 硬 | 找得到 DSH 可执行文件与 `resources/app.asar` 里的 host CLI 入口 | 没装 = blocked；装了但结构不完整 = fail（expected vs actual） |
| `node-version` | 硬 | 本次运行满足声明类型的 Node 下限（`.ts` 需 22.6+，`.js` 需 18+） | 不足 = fail，hint 给升级或用 tsc 预编译两条路 |
| `profile-present` | 硬 | `DSH_HOME`（或 `~/.dsh`）下有 `profiles/<profile>` 目录和 `package.json` | 缺失 = blocked |
| `package-installed` | 硬 | profile 依赖里声明了 `packageName`、已安装、`clientEntry` 存在且算出 sha256；cwd 是该插件仓时版本必须与声明一致 | 未装/入口缺失/版本不一致 = fail（hint 给安装命令） |
| `skills-set` | 硬 | 仓库侧与安装副本的技能集合都和声明的 `bundledSkills` 一致（逐个技能目录的 frontmatter `name` 必须等于目录名，`disable-model-invocation` 不影响判定；平铺 `.md` 若没有 frontmatter `name` 视为说明文档、不计入技能集合） | 任一侧掉技能、目录名与 frontmatter 名不一致 = fail（点名到目录）；安装副本没有技能目录 = blocked |
| `model-configured` | 硬 | profile 补丁层（`cordis.patch.yml`）逐字声明 provider / model / apiKeyEnv，且 models 列表包含该 model id | 任一字面不一致 = fail（expected/actual 给两处值）；补丁层缺条目 = blocked |
| `model-credential` | 硬 | `model.apiKeyEnv` 这个引用名能从真实 home 的凭据存储（`<DSH_HOME>/.credentials.yaml` 的 `refs`）或进程环境解析 | 都找不到 = blocked（hint 指向 env 变量与 DSH 设置）；报告只写来源与是否可用，不读值 |
| `screen-present` | 软 | 仅在 `--screen` 时计划，能枚举到显示器 | 探测失败 = blocked，绝不计 fail |

可选能力（browser / screen）没注入时，对应检查只会 blocked/skip，不会产生 fail——这是硬契约，有测试锁定。

技能检查只读文件树与 frontmatter，不数「模型可见技能数」，也不调用 `skills/list`：带 `disable-model-invocation: true` 的技能仍然会被宿主注册，从模型侧计数会得出错误的缺口。技能目录旁的 `README.md` 这类没有 frontmatter `name` 的平铺 markdown 是说明文档（宿主也不会注册），证据里记为 ignored；真正的技能目录掉一个仍会被声明数量与集合比对抓住。模型与凭据检查只消费引用名（provider / model id / apiKeyEnv / 凭据 ref 名），任何检查都不会读取、记录或打印密钥值。

## 当前实现边界

- 已实现命令：`describe`、`self-check`。`describe` 列出的其余命令是后续票的契约，运行时会明确提示「described but not implemented」并以 `2` 退出，不会假装成功。
- 证据归档/校验（`evidence add` 等）、launch、model、isolation、batch、freeze、run、cleanup 尚未实现，本文件只描述已经可跑的行为。
