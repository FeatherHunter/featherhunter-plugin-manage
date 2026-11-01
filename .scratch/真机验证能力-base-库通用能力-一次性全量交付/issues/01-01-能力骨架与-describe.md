<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-d2ea2319-5978444 -->
<!-- DSH-CREATED: 2026-11-01T11:43:03.443Z -->
# 01: 01 能力骨架与 describe

**What to build:** 真机验证能力在 base 包内自立门户：独立目录、独立导出子路径、独立 bin；`dsh-verify describe` 能一条命令说清本能力有哪些命令、19 个内置检查 id、profile 声明字段、退出码约定；构建期强制两条契约（非相对 import 必须以 `node:` 开头、自包含 bundle 里不许出现 import/require/动态 import），违反即构建失败。同时把仓里那份冻结原型定去留：保留的部分整理成这条票的骨架，不保留的删掉，不留「半成品既不是原型也不是产品」的状态。

**Blocked by:** 无（可立即开始）

**Status:** ready-for-agent

- [ ] `dsh-verify describe` 与 `describe --json` 输出合法，且内容与实际注册的命令/检查一致
- [ ] 构建通过两条契约检查；故意塞一个第三方 import 会让构建变红（自证有牙齿）
- [ ] `npm run typecheck` / `npm test` / `npm run build` 全绿
- [ ] 文档与 CLI 帮助读取同一份能力描述，不存在两处手写清单

# 01: 能力骨架与 describe





## 进度
