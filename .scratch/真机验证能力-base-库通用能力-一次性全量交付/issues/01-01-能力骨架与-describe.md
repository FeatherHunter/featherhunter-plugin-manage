<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-d2ea2319-5978444 -->
<!-- DSH-CREATED: 2026-11-01T11:43:03.443Z -->
# 01: 01 能力骨架与 describe

**What to build:** 真机验证能力在 base 包内自立门户：独立目录、独立导出子路径、独立 bin；`dsh-verify describe` 能一条命令说清本能力有哪些命令、19 个内置检查 id、profile 声明字段、退出码约定；构建期强制两条契约（非相对 import 必须以 `node:` 开头、自包含 bundle 里不许出现 import/require/动态 import），违反即构建失败。同时把仓里那份冻结原型定去留：保留的部分整理成这条票的骨架，不保留的删掉，不留「半成品既不是原型也不是产品」的状态。

**Blocked by:** 无（可立即开始）

**Status:** resolved

- [x] `dsh-verify describe` 与 `describe --json` 输出合法，且内容与实际注册的命令/检查一致
- [x] 构建通过两条契约检查；故意塞一个第三方 import 会让构建变红（自证有牙齿）
- [x] `npm run typecheck` / `npm test` / `npm run build` 全绿
- [x] 文档与 CLI 帮助读取同一份能力描述，不存在两处手写清单



## Comments

### local — 2026-11-01T12:21:25.373Z
**票 01 完成（集成提交 269d297）**

验收对照（Lead 复跑后提交）：
- 独立目录 / 导出子路径 `./real-machine-verification` / bin `dsh-verify`：已就位。
- `describe` 与 `describe --json`：15 条命令（L1 9 / L2 6）、19 个内置检查 id、13 个 profile 字段、退出码 0/1/2；describe 与 evidence 按规格归 L1。
- 构建期两条契约：抽成 `scripts/bundle-contract.ts` 纯函数（`test/bundle-contract.test.ts` 12 用例）；注入 `import "left-pad"` → 构建红；注入裸 `"fs"` → 契约自身红；还原 → 绿。旧 `build.mjs` 已删。
- 文档与 CLI 帮助同一来源：`capability-description.ts` 是唯一事实源，`docs.ts` 生成 Markdown；help / describe / markdown 的同源性与「无第二份手写清单」由 sentinel 注入测试锁定。
- 验证：`npm run typecheck` 0；`npm test` 484 passed / 6 skipped；`npm run build` 六入口 ok；dist CLI 的 --help / describe / --version 退出码符合契约，未实现命令仍为 2。
- 原型去向：DESIGN §16 W1 判据更新，§16.1 把 contracts（冻结）、runtime/evidence（未接线原型）逐文件映射到接管票，并写明接线规则；`tests/self-contained.test.ts` 门禁保证 RMV 不 import base core/client、base 其它源码不 import RMV。

留给后续票：README/AGENTS-USAGE 的正文由票 15 用 `renderCapabilityMarkdown()` 生成（本票只交生成器）；各命令实现票只往 `IMPLEMENTED` 加名字。

### local — 2026-11-01T12:21:25.604Z
票 01 七项验收全部满足：独立入口、describe 自省、构建期契约（注入即红）、三绿、文档同源、原型去向写死；已提交 269d297。





## 进度

- 进度：100%（2026-11-01T20:21:25+08:00）：自检三绿并提交 269d297；describe/help/markdown 同源、构建契约正反例锁定
