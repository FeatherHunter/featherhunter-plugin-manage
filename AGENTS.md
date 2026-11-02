# AGENTS.md

## Agent skills

### Issue tracker

Local markdown via deck tools (`backendId: markdown`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

single-context: one repo shares one root `GLOSSARY.md`, architecture decisions live in `docs/adr/`. See `docs/agents/domain.md`.

## 导航：改真机验证代码先读什么

改 `packages/base/src/real-machine-verification/` 之前，按需读这几份权威文档的对应章节，不要靠反复读文件找入口：

- **命令表面（有哪些命令、参数、退出码）**：`packages/base/src/real-machine-verification/DESIGN.md` → `## 10. CLI 表面`
- **证据与身份链（冻、绑、归档怎么串起来）**：`packages/base/src/real-machine-verification/DESIGN.md` → `## 11. 证据与身份链`
- **已建成形态与 DESIGN.md 字面不一致处的裁决**：`docs/adr/0002-real-machine-verification-as-built.md` → `## 决定`
- **面向 agent 的取用顺序与证据纪律**：`packages/base/src/real-machine-verification/AGENTS-USAGE.md` → `## 3. 证据与身份：先冻、再绑、再归档`

指针只给路径与章节；正文以被指向的文档为准，本文件不复述。

## 边界：只建设 base

- 本仓只建设 base：`packages/base` 是唯一实施与交付物。
- 五个消费仓（dsh-prompt / palette / im / ilife / matt）按发布包 + 各自的 README / AGENTS-USAGE 自助接入。
- 本仓不代跑五仓验证，不向五仓安装本地构建产物；五仓的问题由五仓自己复现与排障。

## 排查

- 会话日志被多帧压缩、只能解出第一帧时，按 `docs/排查-会话日志解压.md` 的复制即用命令解压与核对。

## 作业规则

以下四条只做文档约束，不加强制 hook。

### 等待规则

等待类调用只在「必须拿到对方产物才能继续」时使用；子代理或后台任务在跑时先做独立工作；完成通知会主动到达，不轮询、不空转。

### 长任务规则

预计超过 90 秒的命令一律后台执行，输出 Tee 到被 gitignore 的日志目录（本仓为 `.tmp/ops-logs/<ticket>/`）；取结果用一次等待 + 结构化汇总，不反复拉同一份输出。

### 多步操作规则

三步以上的操作先落成脚本，执行层只做编排与判定；不把大段内联程序写在执行层。

### 证据规则

门禁、发布、汇总一律产出结构化 JSON，供复核与归档。

