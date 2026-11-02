<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: audit-closeout-20 -->
<!-- DSH-CREATED: 2026-11-02T04:49:43.387Z -->
# 20: 对抗审计修复收口：全量验证与 base 提交

**What to build:** 把工作树里已落地的对抗审计修复变成一次可复核的 base 提交：六组修复（P0 两阶段批次与候选准入、P1-2 真实 home 包含判定、P1-3 model 四态与 dry-run 预测、P2-4 检查 id 与 emit 对齐、P2-5/P2-6/P3-9/P3-10 状态与原因码、docs 参考段同步），外加 P2-7/P3-11/P2-8 的取舍写入 ADR-0002。交付物是：全量验证绿 + 只含本票路径的提交。

**Blocked by:** None (can start immediately).

**Status:** resolved

- [ ] ADR-0002 增记：custom 技能根只读不可观察、registry 重复技能端到端不可达、反例测试策略口径
- [ ] npm run docs:sync / build 后 docs:check 绿，README/AGENTS-USAGE 参考段与 describe 一致
- [ ] npm run typecheck exit 0；全量 vitest 绿（含新增 batch 反例、custom 四态、真实 home 守卫、emit 对齐门禁）
- [ ] 提交只暂存本票路径；票面与用户并行 WIP 不提交
- [ ] 票面记录全量数字与提交哈希

## Comments

### local — 2026-11-02T04:52:27.641Z
收口完成：对抗审计修复全部落地并提交。

**提交** a0ee9c5200b138d47407706f74c1fb19dbb8bd7f（25 files +1732/−417），六组修复：
1. P0 两阶段批次：`batch open` 拆 prepare/seal；seal 实测候选并跑完整九条判定（位置、先后、HEAD、构建提交、源码稳定、基线包含、版本、包哈希、文件摘要重算），status 新增 candidate-identity 漂移检查；`orchestration/batch.ts` +809/−…，`contracts/candidate-rules.ts` 支持 `allowOutdatedBase` 与 `base-version-unreadable`。
2. P1-2 真实 home 守卫：`runtime/dsh/home.ts` 用 realpath + 包含关系判定（子目录与 junction 都拒），移除未文档化的 DSH_REAL_HOME 覆盖；install、model --fix、cli/main 的显式 `--work-root/--out/--archive-root` 共用。
3. P1-3 model：受检项改四态（pass/fail/skip/blocked）并带 blockedReason；dry-run 用预测 checks 算退出码，不再固定 0。
4. P2-4：`BUILT_IN_CHECK_IDS` 改为实际 emit 的 22 条，新增两条门禁（每个 advertised id 必须在源码出现；每个字面 checkId 必须 advertised）。
5. P2-5/P2-6/P3-9/P3-10：batch 检查自动带 blockedReason（reason 保留为过滤码）；自定义检查支持 status/blockedReason（pass/fail/skip/blocked）；screen-present 无显示器记 platform-unsupported；`--allow-stale` 提示统一。
6. 文档：AGENTS-USAGE 两阶段批次与自定义检查四态、README 新增「批次：先开、再冻、再封」段、DESIGN §10/§11、capability-description 的 batch 描述。

**ADR-0002**：新增决定 #11（技能重复在文件树路径端到端不可达，只保留纯规则与 registry 路径能力）与「对抗审计复核补记」（#2/#9 已覆盖的取舍不重开，补 CLI 级候选反例、emit 门禁、真实 home 三条写盘反例）。

**全量验证（提交前，工作树同提交内容）**：`npm run typecheck` exit 0；`npx vitest run` → 70 passed | 1 skipped files，1005 passed | 6 skipped（6 skip 为 cdn-smoke 网络）；`npm run docs:check` → “docs ok: README.md and AGENTS-USAGE.md match describe”；`npm run build` → 六入口 + docs ok。

**未提交**：票面 `.scratch/**` 与用户并行 WIP（docs/agents/label-colors.yaml、base 的 package.json/package-lock/data/manifest/baseline/readme-sync/renderers 及其测试、HUMAN-GATE 清单）。

### local — 2026-11-02T04:52:29.269Z
六组审计修复落地：typecheck/vitest 1005 passed/docs:check/build 全绿，提交 a0ee9c5；ADR 增记 P2-7/P3-11/P2-8 取舍。

## 进度

- 进度：100%（2026-11-02T12:52:26+08:00）：审计修复全量绿并提交 a0ee9c5；ADR 增记 #11 与复核补记；票面数字已记录
