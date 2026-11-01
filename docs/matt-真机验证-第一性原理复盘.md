# matt 插件真机验证工装的第一性原理复盘

> 目的：在把真机验证抽成「通用脚本」之前，先弄清 matt 插件那套东西到底在解决什么问题、哪些设计是不可省的、哪些是可替换的。
> 取证范围：`D:\dsh-plugin\dsh-mattpocock-skills-deck` 的 `scripts/real-machine/`（43 个 `.mts` + README 419 行）、`docs/agents/real-machine-verification.md`（202 行）、`tests/lib/real-machine-process.ts`（629 行）、`D:\Temp\handoff-real-machine-base-2026-11-01-v2.md`（839 行，HEAD 记录为 24b37cc7，实际 HEAD 已到 e2e1ac16）。
> 本文只写「学到了什么」，不写实施计划。

## 0. 一句话

真机验证的产物不是「通过的截图」，而是一条**别人可以复核的因果链**：

> 这份候选包（**身份**）→ 在这个隔离环境里（**上下文**）→ 用这个可证伪的方法（**方法**）→ 得到这个结论（**证据**）。

matt 那 43 个文件、五层结构，本质上都在维护这条链不被悄悄弄断。所有叫我拍大腿的设计，都是在补链上的漏洞。

## 1. 它到底在解决哪几个矛盾

真机验证天生要同时满足三对互相拉扯的东西：

1. **真实 vs 可控**：要验的是真实环境的行为，但要能重复就得受控。→ 用「隔离 + 隔离自证」解决：不是声称隔离了，而是用一个探针证明隔离真的生效（`lib/isolation.mts` 的 `probeSettingsIsolation`：子进程读 `os.homedir()` 落在临时 home、标记能写能读、真实 `settings.yaml` 前后 SHA256 不变）。
2. **结论要可回溯 vs 环境一直在变**：代码变、依赖变、机器变、时间变。→ 用「身份行 + 三重哈希 + 新鲜度判据」解决：批次有开始 HEAD 与基线 tip，候选有 commit/文件集/tgz 三层哈希，任何一层变了这条结论就作废（`lib/batch.mts` 的 `judgeBatchFreshness`）。
3. **人读得懂 vs 机器可判**：票面要人能读，门禁要机器能判。→ 用「逐字格式的票面协议 + 纯函数判据 + 命令只吐 JSON」解决：规则写在 `docs/agents/real-machine-verification.md`，判据是零 IO 的纯函数，命令行只有 stdin/argv → stdout JSON/exitCode。

**这是我学到的第一条：验证系统的复杂度不在「跑起来」，而在「让别人相信这个跑起来的结果」。**

## 2. 骨架：五层 + 一条主动脉

| 层 | 载体 | 职责 | 判据/契约 |
| --- | --- | --- | --- |
| 规则层 | `docs/agents/real-machine-verification.md`、清单票 | 定义什么叫「验证过」：场景块五段、身份行、结论三格式、收口关键词 | 逐字文本协议，`scripts/lib/checklist-consistency.mts` 核对 |
| 契约层 | `lib/batch.mts`、`lib/candidate.mts` 的身份与判据 | 什么候选能进批次、什么证据能进统计 | 纯函数，反例清单十余条 |
| 动作层 | `commands/*.mts`（24 个） | 一步一个命令，组合成流程 | stdout 一段 JSON、失败 exitCode≠0、stderr 一句中文 |
| 运行层 | `lib/launch.mts`、`home.mts`、`model.mts`、`isolation.mts`、`logs.mts`、`envfile.mts` | 把 DSH 进程起在受控环境里 | `resolveLaunch` 一处算出全部结论 |
| 门禁层 | `tests/lib/real-machine-process.ts` + `tests/verify-*.ts` | 证明上面四层自己是对的 | 进程接口 + 假 glab + `--negative` |

**主动脉（一条命令一条链）**：

```
freeze-candidate   构建→打包→逐文件 SHA256→装进隔离 home→核对安装目录与界面版本串
      ↓ candidate.json
prepare-batch      读基线→冻结→复读 HEAD→判候选→起实例→七项巡检→全绿才写 batch.json
      ↓ batch.json + 身份行
（人工/自动化跑场景，collect-evidence 收证据：四道闸）
      ↓ evidence.json（candidate 绑定在最后写，防 --extra 覆盖）
check-batch        收尾判新鲜度 → status: active|stale
      ↓
发布前五道 + 字节对账（publish-token.ps1 / wizard-release.sh 同一脚本，无跳过开关）
```

## 3. 九个「看着朴素、其实很硬」的设计决定

1. **直接起 exe + asar 里的 `cli.js`，`ELECTRON_RUN_AS_NODE=1`**（`lib/launch.mts:143`、`lib/candidate.mts` 的 `resolveDshRuntime`）。不走 `dsh.cmd`：批处理包装多一层 shell，参数转义与退出码都更难控。argv 固定 `['--expose-internals', cli, '--profile', p, '--port', '0', '--no-open']`。
2. **端口 0 + 从 stdout 正则抓 `?token=`**（`launch.mts:52` 的 `URL_RE`，150ms 轮询）。不猜端口、不读配置文件；URL 抓不到就代表「没起来」，这正是要判的事实。
3. **`detached: true` + `unref()` + `instance.json`**（`launch.mts:154/159/189`）。命令退出不带走实例；回收靠 `instance.json` 里的 pid，`taskkill /T /F` 连子进程一起杀，停不掉就报错而不是假装停掉。
4. **隔离要自证，不是宣称**（`lib/isolation.mts` 探针四条件）。这条最值钱：它把「我以为隔离了」变成「我测到隔离了」。
5. **模型「配好」= 三件事同时成立**（`lib/model.mts`）：`agent-default-model` 的 provider+model、`llm-pi-ai.providers[provider].apiKeyEnv`、`models[]` 里有该 model id；凭据按「批次 home → 真实 home → 进程环境」三段查找，**值只进子进程环境**，回执/日志/instance.json/计划输出只报来源名。这是「MiniMax-cn 都配置好的」这句话唯一可验证的定义。
6. **装包默认解 tgz 覆盖，而不是 `dsh plugin add`**（`lib/candidate.mts` 的 `installCandidateByExtract` / 文件头注释）。原因是真机踩到的坑：pnpm 记录着 store 在哪块盘，home 换盘就 `ERR_PNPM_UNEXPECTED_STORE`。解包法不依赖 pnpm 与网络，且解完用 `hashTree` 逐文件对清单——装没装对是算出来的。
7. **工作区夹具用插件自己的渲染器生成**（`lib/workspaces.mts` 的 `repoModules()` 动态 import 插件的 `map-render`/`create-render`/`workspace.js`）。手抄夹具形状，插件一改夹具就假红；用同一份渲染器，形状自动跟随。
8. **日志位置是运行时事实，不是配置**（`lib/logs.mts`）：插件日志写在 **DSH 进程 cwd** 下 `.dsh-mattskillsdeck-cache/logs/<日期>.log`，每行一条 JSON；工具靠 `instance.json.pluginLogFile` 定位，再按 event/level/fields 查询。所以「启动目录」必须是隔离维度之一。
9. **`batch.json` 不写盘 = 这一批还没准备好**（`prepare-batch.mts` 注释）。用「文件不存在」表达状态，避免巡检失败的半成品以 `active` 留在盘上被下游当成真的。

## 4. 身份与证据链：这套东西最完整的部分

**三层身份，环环相扣：**

- `candidate.json`（`freeze-candidate.mts` 的 `FrozenManifest schemaVersion: 2`）：`validity: release|development`、`sourceStable`（构建前后 HEAD 与脏文件集合都没变）、`package.fileDigest`（逐文件内容指纹，不含版本与提交，发布前对账用）与 `package.manifestDigest`（含版本与提交，回答「是不是同一次冻结」）、`buildCommit`（产物里的 `DSW_BUILD_COMMIT` 必须等于 `git.commit`）。
- `batch.json`（`BatchRecord schemaVersion: 1`）：`startHead`/`startBranch`、`base{ref,tip,expectedVersion}`、`candidate`、`preflight`、`instance`、`status`。
- 票面身份行（`batchIdentityLine`）：`批次 <名>；候选提交 <40位>；候选包 sha256 <64位>`，逐字契约，发布前检查会解析它。

**判据全是纯函数，且反例清单长得吓人。** `judgeCandidateForBatch` 我数到 12 条拒绝面：候选不在本批次目录、`generatedAt` 早于批次开始、`schemaVersion≠2`、`commit≠HEAD`、`buildCommit≠HEAD`、`sourceStable≠true`、validity 非法、摘要格式不对、tgz 不存在或哈希不符、`digestOfFiles(files)` 重算≠`fileDigest`、候选提交不含基线 tip、版本≠基线 `package.json` 的 `expectedVersion`（后两条是 #1777 加的，任何开关都绕不过版本那条）。

**三个「不信任自己」的动作，是我最想抄的：**

1. `judgeBatchCandidateFile` 从磁盘**重算**候选文件 sha 与 tgz sha，再和 `batch.json` 比——注释写「不直接拿 batch.json 的字段回填，这样 collect-evidence 再比一次才有两边独立算过的意义」。
2. 版本身份从 `git show <ref>:package.json` 读（`readVersionAtRef`），不用集成分支自己的工作树版本自证。
3. 界面核对比的是「宿主合成请求里**我们插件 client 那一段**加载内容的版本常量 + 插件名」，不拿 `/plugins/??a/client.js,b/client.js` 的整段响应哈希当身份（会假红）。

**两个新鲜度维度**（`judgeBatchFreshness`）：`currentHead !== startHead` → stale；基线 tip 前进 → 也 stale。理由写在源码里：在集成分支上开批时 HEAD 是合并提交、可能长期不动，而 main 已经前进几十个提交，只比 HEAD 会漏。**「读不到基线」也判 stale，而不是判通过**——不确定时向危险侧倒。

**证据三条硬规矩**（规则层）：每批结束整批归档到 `<工作根>/evidence-archive/<批次名>-<时间戳>/` 并带 `SHA256SUMS.txt`；证据不可变（更正写旁注，不改原件）；每批开始记录宿主显示状态。起因都是真事故：批次重跑覆盖了 `measure-banner.json`、手改副本 commit 字段导致「测量当刻的原件」不存在。

**发布前五道 + 字节对账**：清单票恰好一张、已关闭、正文与评论内部一致、本版批次评论都带身份行且与 `--candidate` 一致（**不读本机 batch.json**，因为发布可能不在做验证的机器上）、候选提交必须是发布提交的祖先或有差异审计。字节对账拿 `package.fileDigest` 比，`validity=development` 直接拒发，没有跳过开关。

## 5. 方法论上的八条教训

1. **验证方法本身要被验证。** 2026-10-29 那次「关闭浮层被盖住、确认键点不到」，真实原因是工具用 `setViewportSize` 假装全屏（真实窗口 1083 宽）——是验证方法错，不是产品错。现在必须 CDP `setWindowBounds({windowState:'fullscreen'})` 并核对 inner/outer == screen ±2px，判据抽成纯函数 `judgeFullscreen`，门禁 `tests/verify-real-machine-fullscreen.ts`。**每扇门禁带 `--negative` 自证会红**，也是同一个思想。
2. **「看起来对」有三种典型假象**：路径对了但身份不对（装的是旧包）、版本对了但提交不对（同版本不同提交，界面串分不清，所以要 `DSW_BUILD_COMMIT`）、界面加载了但不是这一版（合成响应整段哈希会假红/假绿）。
3. **别用被测物自证**：版本从 git 引用读、哈希从磁盘重算、身份由命令层从 `batch.json` 注入且 `--meta candidate` 直接报错。
4. **环境是无名输入**：门禁夹具会删掉宿主上的 `MINIMAX_CN_API_KEY`、所有 `DSH_REAL_MACHINE_MODEL*`、`NODE_OPTIONS` 等，并重定向前后快照 13 个 `HOST_ENV_KEYS`——否则断言会随机器变化（`tests/lib/real-machine-process.ts`）。
5. **秘密的流动面要最窄**：环境文件只认 3 个变量（`GLAB_CONFIG_DIR`/`PATH`/`GITLAB_TOKEN`），报错只带路径/行号/变量名、**永不回显该行原文**（`lib/envfile.mts`）；模型密钥只进子进程环境。
6. **失败要一屏可定位**：`formatFailure` 打命令/cwd/退出码/信号/耗时/stdout/stderr 前 40 行/假 glab 调用前 10 条/工作根文件前 40 个；preflight 每项 `reason` 必须写「期望 vs 实际」；每个硬检查自己 catch，不让一项把整段回执打没。
7. **防手滑三件套**：`assertWritableTarget` 只许写工作根/临时目录/显式目录（刻意不含真实 home）；`rmrf` 拒删盘符根、仓库根、cwd、少于 3 段的路径；装包先解到 `<pluginDir>.extract-<ts>` 再 rename（失败不留半成品）。`cleanup` 对未知类别只报账、绝不猜着删。
8. **熵要主动管**：工作根 ≤15GB、批次 ≤20、单批 ≤2GB，写进 `guidance` 字段；2026-10 真堆到 4.3GB/4.9 万文件。证据归档与「只保留到下一版发布结束」也是熵管理。

## 6. 对我们三个诉求的直接回答

### 6.1 web profile 的多实例并发

matt 的成品只有 **2 路**：`commands/two-instance-smoke.mts` 用 `Promise.all([startInstance(homeA, run-a, port:0), startInstance(homeB, run-b, port:0)])`，断言「端口不同、菜单各含自己工作区、cwd 指各自工作区、日志目录不同、启动目录不同、两实例插件版本一致」。**没有 N 路并发器**（`--launch-plan`/`--env-file` 只出现在计划文档里）。

N 路要补的是：端口全为 0 由 OS 分配、每实例 4 件套（home / 启动目录 / USERPROFILE+HOME / 浏览器 context）、失败隔离（一路起不来不影响其它路回收）、回收顺序与兜底（先按记录停，再扫 instance.json）、资源上限（每实例约 270–295MB/3 进程，N 路要按内存定上限）、以及**别让并发用真实 home**（global lock 只用于「不得不碰真实 home」的兜底路径）。

### 6.2 「技能都装上」怎么保证

不需要装进用户目录。技能随 npm 包发在 `bundled-skills/`，宿主启动时注册只读 provider（`src/host/bootstrap.ts`，provider 名 `bundled-mattpocock`、rank 350，日志 `[bundled] provider registered ... rank 350 (27 skills expected)`）。零写盘、天然幂等。

**判定不能数「模型可见技能」**：DSH 只把 model-invocable 写进目录，27 个里 16 个 `disable-model-invocation: true`，本机只显示 11 是正常的。可靠判据三条：①包自洽（`files` 含 `bundled-skills`、27 目录与 `MATT_SKILL_PROBE_NAMES` 双向差集空、frontmatter `name` == 目录名）；②活注册表 `ctx.skills.snapshot({cwd})` 过滤 `source==='bundled'` 恰 27 个且名字集合相等；③真机进程日志那一行。

### 6.3 「MiniMax-cn 都配好」怎么保证

就是 `lib/model.mts` 那三件套（profile 两处 + `models[]` 一条 + 凭据三段查找 + 只注入只报来源）。另外我今天在桌面 profile 里修的坏点说明还需要**跨条目一致性**检查：`vision-router` 引用的 `minimax-cn/M3.1-Flash` 与 `llm-pi-ai` 声明的 `Minimax-M3.1-Flash` 必须逐字一致，否则日志报 `pi-ai provider "minimax-cn" has no configured model "M3.1-Flash"`、实时模型发现 HTTP 404。matt 的工具只检查 `agent-default-model` + `llm-pi-ai`，**没有检查 vision-router 这类第三方引用**——这是我们要补的一类检查。

## 7. 通用化的接缝：什么能搬、什么不能

| 类别 | 内容 | 处理 |
| --- | --- | --- |
| 与插件无关，直接通用 | `paths`（DSH 定位、工作根、可写根断言）、`util`（parseArgs/printJson/runCli/sha256/rmrf 防呆）、`launch`（argv/env/URL 抓取/detached/instance.json）、`isolation`（探针+锁+备份恢复）、`envfile`（白名单+不回显）、`logs`（定位+JSONL 查询）、`evidence`（收集器+schema）、`cleanup`（报账式清理）、`preflight` **骨架**、`batch` **判据**、`collect-evidence` 四道闸 | 抽到 base 库；把插件常量变成 manifest 字段 |
| 需参数化（每插件不同） | DSH exe/cli 定位、profile 名、包名、插件缓存目录名、日志文件名、安装目录断言（`lib/client.js`）、UI 文案/选择器、工作区后端、清单票标签与收口关键词、屏幕预设 | 写进每仓一份 manifest（声明式），不复制脚本 |
| 不该搬 | `browser.mts`（插件 DOM 断言）、`gitlab-sandbox`/`seed-gitlab`、`report-index`（绑特定断言分组）、`deck-write`/`deck-readback`（绑 deck 的票格式） | 留在插件仓，通过钩子挂接 |

**matt 这套的通用化短板**（正是「复制式同步」漂移的根源）：43 个文件里插件专属常量是**硬编码**而不是声明（`launch.mts:128` 的 `profile='web'` 出现 6 处、`paths.mts:22` 的 `D:/DeepseekHarness/...`、`logs.mts` 的 `.dsh-mattskillsdeck-cache`、`candidate.mts` 的 `lib/client.js`、preflight 的 `PLUGIN_NAME`）；`scripts/tsconfig.json` 只登记 30/43 个文件；real-machine 不进 npm 包。所以「一处修改到处生效」在 matt 里只是**它一个仓内部**成立，跨仓仍然是复制。

## 8. 如果只记十条

1. 验证的产物是**可复核的因果链**，不是截图。
2. 隔离要**自证**：探针 + 真实文件哈希，不是声明。
3. 身份要**三层**：候选包（文件集/tgz/构建提交）、批次（开始 HEAD/基线 tip/期望版本）、票面身份行。
4. 判据要**纯函数 + 反例清单**，并且从磁盘重算、不用被测物自证。
5. 不确定时**向危险侧倒**（读不到基线判 stale、读不到构建提交判失败）。
6. 秘密只走**最窄的通道**，回执只报来源不报值。
7. 方法本身要被验证（真全屏事件、`--negative` 自证会红）。
8. 环境是**无名输入**，门禁要清宿主同名变量、断言语义不随机器变。
9. 状态用**文件系统**表达（没有 `batch.json` = 没准备好），别让半成品冒充 active。
10. 熵要**主动管**：清理只报账不猜删、上限写进 guidance、证据归档且不可变。
