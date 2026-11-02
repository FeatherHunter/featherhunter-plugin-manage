# scripts/ops — 会话运维工具箱

这一组脚本来自一次 26 轮 / 2,799 步 / 约 400 分钟工具用时的交付会话复盘（见
`docs/会话复盘-工具用时与运维脚本-2026-11-02.md`）。它们只做两件事：

1. 把**重复且容易出错**的手工操作收敛成可重复的命令；
2. 把**只读检查**从“读日志/读票面/逐仓敲命令”变成一条命令 + 结构化输出。

零依赖（Node 20+ 自带模块），不改 DSH，不安装任何包，不替调用方做 `git push`。

## 命令一览

| 脚本 | 解决什么 | 是否写盘 |
| --- | --- | --- |
| `repos-status.mjs` | 六仓 base 钉版/安装形态/lock/verify/banner 偏差扫描 | 只读 |
| `tickets.mjs` | 直接读 `.scratch` 本地票面，绕过 deck 的 scope 歧义 | 只读 |
| `refresh-base.mjs` | 把消费仓已安装的 base 换成本地 dist（pnpm 硬链接安全） | 是（`--check`/`--dry-run` 除外） |
| `base-verify.mjs` | base 的 typecheck / vitest / docs / scan / build 一条链 | 只读（build 写 dist） |
| `scan-sources.mjs` | 源码 / 脚本 / 测试 / 文档的 NUL 字节与 UTF-8 解码扫描（门禁 scan 步骤的实现） | 只读 |
| `matt-verify.mjs` | matt 预检：生成源码、gate-map、typecheck，可选 ui/smoke/npm test | 只读（`--fix` 才会重生成） |
| `base-release.mjs` | 干净 worktree 发布 + registry tarball 校验（也支持只校验已发布版本） | 是（发布/下载） |
| `commit-paths.mjs` | 只提交指定路径，提交消息从文件读 | 是 |
| `gate-summary.mjs` | 从 3–4 MB 测试日志汇总 GATE-RESULT | 只读 |

所有脚本都支持 `--help`；失败统一 `OPS-ERROR ...` 到 stderr，退出码 0 成功 / 1 失败 / 2 前置错误。
`--json` 时 stdout 只有 JSON，人类进度全部走 stderr。

## 常用流程

### 1. 检查六仓是否仍然真实钉住 base 版本

    node scripts/ops/repos-status.mjs
    node scripts/ops/repos-status.mjs --json > status.json
    node scripts/ops/repos-status.mjs --strict-git      # git dirty/ahead/behind 也算偏差

默认仓库表在 `lib/common.mjs` 的 `DEFAULT_REPOS`；用 `--repo name=path` 追加。
退出码 1 表示存在 drift（钉版缺失、非精确、安装版本不符、lock 指向非 registry、verify 缺失等）。

### 2. 用未发布的本地 base 验证消费仓

    # 先 build 发布仓
    node scripts/ops/base-verify.mjs --quick
    # 看计划（不写）
    node scripts/ops/refresh-base.mjs --repo matt --dry-run
    # 真正替换（pnpm 硬链接：删除后整份拷贝，绝不覆盖写）
    node scripts/ops/refresh-base.mjs --repo matt
    # 只核对现状
    node scripts/ops/refresh-base.mjs --check

验证完记得用各仓自己的包管理器恢复钉版安装；刷新后的安装与 `package.json` 的 pin 不一致时脚本会告警。

### 3. base 的提交前门禁

    node scripts/ops/base-verify.mjs                 # typecheck -> vitest -> docs:check -> scan -> build
    node scripts/ops/base-verify.mjs --quick         # typecheck + vitest
    node scripts/ops/base-verify.mjs --only scan     # 只跑源码扫描
    node scripts/ops/base-verify.mjs --only typecheck,tests --json

日志落在 `<repo>/.tmp/ops-logs/`（仓库已 gitignore `.tmp/`）。

`scan` 步骤走 `scan-sources.mjs`：扫描 `packages/base/{src,scripts,test,demo}`、`scripts/`
（含 ops）、`docs/` 与仓库根目录的文本文件，跳过 `node_modules`、`.git`、`dist`、`.tmp`、
`.local`、`.scratch` 与非文本扩展名。命中 NUL 字节或无法按 UTF-8 解码的文件时，列出文件路径并
exit 1；干净树 exit 0。`--json` 时问题列表在 scan 步骤的 `summary.issues`（绝对路径、仓库内
相对路径、原因与说明），stdout 只有 JSON。`base-verify.mjs --help` 列出固定步骤顺序与
`--only scan` 的用法。

### 4. matt 真机验收前的预检

    node scripts/ops/matt-verify.mjs                 # 只读：生成源码 / gate-map / typecheck
    node scripts/ops/matt-verify.mjs --fix           # 合并后表/生成源过期时重生成
    node scripts/ops/matt-verify.mjs --ui            # 真机跑 verify/scenarios/ui.ts
    node scripts/ops/matt-verify.mjs --smoke --ui
    node scripts/ops/matt-verify.mjs --npm-test      # 全链（约 20 分钟，建议后台跑）

真机场景默认 `DSH_HOME=D:/Temp/matt-batch-home`、`--work-root D:/Temp/matt-ops-work`，可用
`--dsh-home` / `--work-root` 覆盖。脚本会对比运行前后的 `git status --porcelain` 并打印差异。

### 5. 发布 base 新版本并取证

    # 只校验已发布版本（不发布）
    node scripts/ops/base-release.mjs --version 0.1.8 --skip-publish

    # 发布新版本：先 bump 四个文件并提交，再执行
    node scripts/ops/base-release.mjs --version 0.1.9

发布路径：detached worktree → `npm ci` → `npm run build` → `npm publish` → 轮询 registry →
直接下载 tarball（`npm pack` 在传播延迟期会报 notarget）→ 校验 sha1/sha256/integrity、
tarball 内 `package.json` 版本、`--version` 两行、dist 标记（prepareHome / findWriteUnderRealHome /
candidate-identity / runReleaseGate）→ 删 worktree。成功才清理证据目录；失败保留 worktree 供诊断。

### 6. 只提交本票路径

    node scripts/ops/commit-paths.mjs --message-file D:/Temp/msg.txt \
      packages/base/src/real-machine-verification/cli/main.ts packages/base/src/.../tests/foo.test.ts

索引里已有别的暂存改动时会拒绝（除非 `--include-staged`）；提交消息从文件读，避免 PowerShell
把 `<field>` 当重定向符。

### 7. 汇总测试日志里的门禁

    node scripts/ops/gate-summary.mjs --log D:/Temp/matt-npm-test.log
    node scripts/ops/gate-summary.mjs --log ... --json --failures-only

识别 `GATE-RESULT {...}` / `GATE-SUMMARY {...}`，输出门禁数/断言数/失败门禁；0 失败 exit 0。

## 安全模型

- 默认只读；`base-verify` 的 scan 步骤与 `scan-sources` 只读。写盘只发生在 `refresh-base`
  （删目标副本再拷）、`base-verify --build`（dist）、`matt-verify --fix/--ui/--smoke/--npm-test`、
  `base-release`、`commit-paths` 这些明确动作上。
- `refresh-base` 拒绝替换解析到发布仓内或不在 `node_modules` 下的目标；不 `pnpm install`、不改 lockfile。
- `base-release` 在版本已发布、commit 内 package.json 版本不符、npm 未登录、worktree 已存在时直接 exit 2。
- `commit-paths` 拒绝越界路径与已暂存的无关改动。
- 任何脚本都不调用 `git push`、不改 DSH 配置、不改会话环境。

## 已知限制

- `base-release` 的发布路径本身没有在复盘里端到端跑过（会真的发版）；只验证了 `--skip-publish`
  校验路径（0.1.8 实测 sha1/sha256/CLI/marker 全对）与全部前置拒绝分支。
- `refresh-base` 的删除-拷贝路径在合成仓上验证过（含 junction 拒绝），未在五仓真实安装上执行，
  以免把钉版状态改成“本地预览”。
- `tickets.mjs` 只解析本地 markdown 后端（`DSH-*` 头、`## 进度`、`## Comments`）；不写任何票。
