<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: hac2-t2 -->
<!-- DSH-CREATED: 2026-10-31T10:35:02.338Z -->
# 02: base 预清理与最后一天文案修正

**What to build:** 删除 base 0.1.1 中永不命中的分段控件残留：7px 内切圆角规则、发丝分隔线规则、对应注释与 README 两处「分隔线」描述，统一表述为「一个容器 + N 个独立按钮」。组 aria-label 改为不写死三项名的泛称。修正弹窗二维码有效期文案：最后一天（days=0）不再显示「该二维码 0 天内…」，改为「今天（M 月 D 日前）有效」类中英文案；补最后一天/前一天/已过期/无有效期的单测。base vitest 与 typecheck 绿。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [ ] 全仓搜索不再出现 7px 内切圆角、hairline divider、分隔线等分段控件表述
- [ ] 组 aria-label 为泛称，不随按钮数量写死
- [ ] 最后一天文案有中英两条，单测覆盖四个边界
- [ ] base vitest / typecheck 全绿

## Comments

### local — 2026-10-31T11:08:47.230Z

### local — 2026-10-31T11:08:48.773Z
已删除永不命中的分段控件残留规则与文档表述，组 aria-label 改泛称，最后一天文案与四个边界单测补齐；typecheck/vitest 全绿（manage main 6be5500）
## 票 02 完成（base 预清理 + 最后一天文案）

**改动**（manage 仓 main 6be5500）：
- packages/base/src/client/styles.ts：删掉永不命中的 `.dsh-base-actions--group>.dsh-base-icon-action{border-radius:7px}` 与 `...+.dsh-base-icon-action{box-shadow:inset 1px 0 0 …}` 两条，注释从「1px frame + hairline dividers」改为「one container, N independent buttons：托盘只归组，不切段」；容器规则保留（1px 外框 + 内衬 + 圆角 10），按钮各自 6px 圆角。
- packages/base/src/client/actions.ts：ActionGroup 注释改为「one 1px tray frame；buttons stay independent」。
- packages/base/src/client/texts.ts：组 aria-label 改泛称——zh `快捷操作`、en `Quick actions`（不再写死三项名）。
- packages/base/src/core/index.ts：`formatValidity` 在 days<=0（最后一天）时输出「该二维码今天（M 月 D 日前）有效，重新进入将更新」/ `Valid today (until M/D), refreshed on re-entry`；其余天数文案不变。
- packages/base/README.md：两处「1px 边框 + 细分隔线 / 内部分隔线」改为「1px 外框的容器托住 N 枚独立按钮（容器只表达归组，不分区、不切段）」。
- 新增 packages/base/test/client/validity.test.ts：最后一天（zh+en）、次日（days=1，zh+en）、过期（isExpired=true，formatValidity=null）、无有效期（永不过期/null）四个边界；actions.test.ts 组 label 断言改为「快捷操作」。

**验收**：仓库内 `分隔线`/`hairline`/`segmented` 均 0 处（README 仅剩「不分区、不切段」的正面描述）；7px 只剩行内边距（row padding 7px 4px，非内切圆角）。`npm run typecheck` exit 0；`npx vitest run` 26 files passed / 1 skipped，326 tests passed / 6 skipped（跳过的 6 个是 CDN 网络 smoke）。

## 进度

- 进度：100%（2026-10-31T19:08:46+08:00）：预清理、泛称 aria-label、最后一天中英文案与四个边界单测完成；typecheck 0、vitest 326 passed
