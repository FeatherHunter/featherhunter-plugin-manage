<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 01 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-58f396e9-5978444 -->
<!-- DSH-CREATED: 2026-11-01T11:43:03.705Z -->
# 02: 02 self-check：运行时与装配体检

**What to build:** 插件仓只写一份声明（包名、默认 profile、客户端入口、构建命令等）就能跑 `dsh-verify self-check`：只读、约数秒，检查 DSH 运行时（可执行与 asar 入口）、node 版本、目标 profile 是否存在、插件是否已安装（版本 + 客户端入口 sha256）。输出人类可读的 `ok|fail` 行与 `--json` 单段 JSON，退出码 0/1/2（2 = 受阻），失败行必须写「期望 vs 实际 + hint」。这条票同时定下「计划 → 执行 → 报告」骨架与最小证据落盘（命令输出、文本证据），供后续所有命令复用。

**Blocked by:** 01

**Status:** resolved

- [x] 在真实插件仓跑 `self-check` 能正确报出上述四项的通过/失败
- [x] 未注入浏览器等可选能力时不产生 `fail`（应为 `skip` 或 `blocked`）
- [x] 测试走进程内 CLI 入口 + 注入替身，不依赖本机真实 home、不真起实例
- [x] README 有「安装 → 写声明 → 跑自检 → 读报告」的首段，足够一个新仓照着做



## Comments

### local — 2026-11-01T13:47:28.437Z
实施完成并经 Lead 独立复核。

### local — 2026-11-01T13:47:29.336Z
票 02 完成：self-check 可运行（计划→执行→报告 + 注入端口 + 证据落盘 + README），typecheck/test/build 全绿，真机与反例均实测。

## 交付
- 新增「计划 → 执行 → 报告」骨架：planSelfCheck() → executePlan() → RunReport（orchestration/{types,runner,self-check,report,run-directory}.ts），检查=数据+函数，后续票只需 append CheckModule 或组合新 plan。
- 内置自检 6 项（5 硬 + --screen 软）：profile-declaration / dsh-runtime / node-version / profile-present / package-installed / screen-present；dsh-runtime 读 app.asar 头定位 host CLI 条目，package-installed 报告安装版本与 clientEntry sha256。
- 声明加载：verify/profile.ts → .js → .mjs 自动发现，--declaration 覆盖；动态 import 绕开 esbuild 静态化；缺失=blocked+hint 模板，非法=fail。
- 本机 Node 原生 Ports（fs/clock/env/command/process/http/screen，browser=null）+ 最小证据 store（sha256/bytes/capturedAt，同名 -2/-3 永不覆盖）+ run.json/run.json.sha256（sha256sum 格式）。
- README 首段四步（安装 → 写声明 → 跑自检 → 读报告）+ 判据表。

## 契约面 additive 变更（Lead 裁决：接受）
- BUILT_IN_CHECK_IDS 19 → 20（+profile-declaration：声明加载是硬前置，必须作为可报告行出现）；GLOBAL_FLAGS 6 → 8（+--declaration/--work-root）；self-check 的 summary/usage/writes 改为真实行为。规格只要求 check id 稳定、未固定数量，故不回退。

## 复核中发现并修正的缺陷
- 声明 import 的**模块解析失败**此前被报成 fail +「move side effects out of it」hint（把正确声明判成作者写错）。已改为：缺包（Cannot find package / ERR_MODULE_NOT_FOUND·ERR_PACKAGE_PATH_NOT_EXPORTED·ERR_UNSUPPORTED_DIR_IMPORT）= blocked(prerequisite) +「在插件仓安装该包」hint；相对文件缺失仍为 fail（specifier 写错）。补了 loader 与 CLI 两条测试。

## 验证（packages/base 下，Lead 独立复跑）
- npm run typecheck exit 0；npm test → 42 passed | 1 skipped，566 passed | 6 skipped；npm run build → 六入口 ok。
- 真机冒烟（cwd=D:\dsh-plugin\dsh-opencode-palette，--work-root 到临时目录）：exit 0，5 项全 pass——dsh-runtime found D:/DeepseekHarness（asar 内 dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js，5607 bytes）、node 24.19 满足 22.6 floor、profile web 存在、package-installed dsh-opencode-palette 2.1.11 匹配 + clientEntry lib/client.js sha256 943af911c8d0985391d2453453ea0f65e031cb4e911b79055afb33961de1708e；run.json 哈希外部 Get-FileHash 一致；palette 仓 git status 干净。
- 未装 base 的仓（声明可解析失败）→ exit 2、blocked profile-declaration + 安装 hint（修复后复测）。
- 缺声明（cwd=packages/base）→ exit 2、blocked + 可复制模板；--screen → 6 项全 pass（2 displays; primary 2194x1234）。

## 留给后续票的接口
- 03：append CheckModule 即可；04/05/06：复用 Ports 与证据 store；07：接管 evidence manifest/archive；11：requires+onMissing 模式；12：executePlan 的 steps。
- 已知边界：--dry-run/--negative/--verbose 仍在 describe 未解析（带这些会 unknown option，建议 12/16 接线）；runtime/platform 的 command/process/http 真机副作用待 04 起实例时首验；darwin/linux 未验证。





## 进度

- 进度：100%（2026-11-01T21:47:27+08:00）：实现、独立复核、全量测试与真机冒烟均通过；已修模块解析失败分类缺陷；待提交
