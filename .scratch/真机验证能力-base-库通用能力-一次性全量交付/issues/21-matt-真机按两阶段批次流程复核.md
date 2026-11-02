<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 20 -->
<!-- DSH-IDEMPOTENCY-KEY: audit-closeout-21 -->
<!-- DSH-CREATED: 2026-11-02T04:49:50.302Z -->
# 21: matt 真机按两阶段批次流程复核

**What to build:** 在新 base dist 上验证「matt 插件仓 → base 真机验证能力」仍然打通：刷新 matt 本地 base 快照，同步 matt 两处批次流程文档为两阶段（open 无候选 → freeze 进批次目录 → seal），用 matt 已有 verify:* 跑真机并记录证据。硬约束：matt 产品代码零改动、git 零写入。

**Blocked by:** 20

**Status:** resolved

- [ ] base 快照刷新（dist/package.json/README/LICENSE；不 pnpm install、不改 lockfile），版本与 base package.json 一致
- [ ] matt 两处流程文档的批次命令可按新流程照抄执行
- [ ] self-check / single-instance / concurrent / ui / smoke 全 exit 0，报告 sha256 记录
- [ ] 两阶段批次真机：prepare → freeze 进批次目录 → seal；身份行「候选包 sha256」等于候选 tgz sha；batch status 的 candidate-identity 为 pass
- [ ] matt 产品代码零改动、git 零写入；未跑项与偏差如实记录

## Comments

### local — 2026-11-02T04:58:46.386Z

### local — 2026-11-02T04:58:46.896Z
matt 真机按两阶段批次流程复核全绿：快照 a0ee9c5、7 项检查 exit0、身份行候选包 sha256=tgz sha、candidate-identity pass，零产品代码改动与零 git 写。
## matt 真机按两阶段批次流程复核：全部通过

### 1. base 快照刷新（未 pnpm install、未改 lockfile）
- base 仓 `feat/real-machine-verification` HEAD `a0ee9c5200b138d47407706f74c1fb19dbb8bd7f`，版本 0.1.6；删掉 `node_modules/.pnpm/dsh-featherhunter-plugin-ba_6a81d913…/node_modules/dsh-featherhunter-plugin-base` 后整份拷入 `dist/`、`data/`、`package.json`、`README.md`、`LICENSE`。
- 两侧哈希逐字相同：`dist/real-machine-verification/index.js` D992E97F…BBC025（578,473 B）、`cli/main.js` CA0A9127…E2F0A6（676,041 B）、`package.json` 11E799A9…D12E5（2,627 B）。
- 新 dist 里检索到 `candidate-identity`、`findWriteUnderRealHome`、`allowOutdatedBase`、`base-version-unreadable`（证明两阶段批次与 home 守卫已进快照）。

### 2. 文档同步为两阶段（`verify/README.md`、`docs/agents/real-machine-verification.md`）
- 顺序改为：① `batch open --name <批次名> --base-ref HEAD`（prepare，写 `batch.json`、打基线行）→ ② `freeze --out <批次目录>/pkg`（候选必须冻进批次目录；freeze 会在 pkg 下建 `<提交前缀>-<时间戳>/`）→ ③ 用该子目录 `batch open --candidate $candidateDir`（seal，实测九条判定，通过才出身份行）→ ④ install（`--tgz $tgz --candidate $candidateDir`）。README 里的编号已顺延到 9 步；agents 文档把「批次身份与候选」拆成 1/2/3 三段并补了 `candidate-identity` 漂移检查与 `--allow-stale` 只降级两项的口径。所有命令按文档即可照抄执行。

### 3. 真机结果（`D:/Temp/matt-t21/*.log`；DSH_HOME=D:/Temp/matt-batch-home）
| 步骤 | 退出码 | 结果 | 报告 sha256 |
|---|---|---|---|
| typecheck（`node scripts/typecheck.mts`） | 0 | 全绿：17 配置 / 805 源码 / 手写 JS 3 份 | — |
| prepare | 0 | 批次 matt-audit1，baseLine `本地 HEAD d1f9186148e4；目标版本 1.9.0-beta.34` | — |
| freeze | 0 | 候选 `d1f9186148e4-20261102T125425`，tgz sha `fd489e0d…100d`，fileDigest `f835f3cd…0edaa`，validity=development（dirty 工作树） | — |
| seal | 0 | phase=sealed，candidateProblems=[]，身份行候选包 sha256 = tgz sha（见下） | — |
| install | 0 | 685/685 文件；package-installed/version/client-entry/version-constant/files 全 pass | — |
| self-check | 0 | 11 pass / 2 skip / 0 fail / 0 blocked（skip 为 profile model:false） | 3ca58d48c169d61e1e7dcc36229cd9fffa1124fe596bd3981e8e88cae4259735 |
| single-instance | 0 | 4/4；屏 2194x1234；页面渲染、日志可读、teardown 干净 | 6cbebe3522083e18e84f753caa2f9ee99850823a960b777b8aa8b20ef1182ca2 |
| concurrent | 0 | 2/2；两实例 home/端口/日志目录互不相同 | 6a1a25d029beaaf1b2046e02f90ebba02ca2fbd9d334b70ba84109e554f3ec48 |
| ui 场景 | 0 | 18/18，截图 28,311 B（3 项证据） | 52284a252dc1596f82214e010d3342b74073b27f59d81241aa0997b952aeaeb9 |
| smoke 场景 | 0 | 10/10；两实例 home/port/pid 不同，stop 无 id 停全部、0 残留 | 34bf22e772ffd0b35e38a36c7de150225207be0dcad9776e667c71cd3dbdf056 |
| batch status | 0 | freshness=active；batch-head-fresh / batch-baseline-fresh / candidate-identity 全 pass；evidence-bound skip（批次目录尚无 evidence.json） | — |

身份行逐字（seal 与 status 一致）：
`- 验证身份：批次 matt-audit1；候选提交 d1f9186148e444b10e71f286d09207eae207b3bd；候选包 sha256 fd489e0db632b25fc959906a4f541f3c3bf1be96cd0496828027c27210bc100d`
基线行：`- 验证基线：本地 HEAD d1f9186148e444b10e71f286d09207eae207b3bd；目标版本 1.9.0-beta.34`
candidate-identity 的 detail：`candidate d1f9186148e4 is intact (manifest 57f9ed922de7, tarball fd489e0db632)`。

### 4. 边界核对
- matt 产品代码零改动：只改了 `verify/README.md` 与 `docs/agents/real-machine-verification.md` 两处文档；未动 `src/`、`deck/`、`package/`、业务/构建脚本。
- git 零写入：任务前后 `git status --porcelain` 完全一致（`M docs/agents/real-machine-verification.md`、`M verify/README.md`、`M scripts/gate-map.mts`、`M tests/gate-map.json` 均为任务开始前既有；`?? assets/video/…mp4` 为用户文件），未执行 add/commit/checkout/stash。
- 未做：cleanup（保留现场证据）；matt 自己的提交由用户决定。

## 进度

- 进度：100%（2026-11-02T12:58:45+08:00）：快照刷新+两处文档同步+7 项真机全 exit0；两阶段批次身份行与 candidate-identity 实测通过；零产品代码改动/零 git 写
