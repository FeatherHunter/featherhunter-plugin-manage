<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 08 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-98234e2e-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:47:18.894Z -->
# 09: deck 仓接入 base 包

**What to build:** deck 仓接入 base 包：设置面板加入口与作者插件卡、README 三个文件迁移四块、已有 star-history.yml / thanks.yml 挂 readme:sync、删除旧 assets/contact-*.png，deck 构建与测试通过。

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] 依赖钉精确版本，产物可被 deck 构建链吃下（重新内联 dist/client/index.js 并提交）
- [ ] 设置面板入口与推荐卡接入；旧实现删除
- [ ] README.md、package/README.md、docs/README.en.md 四块迁移（英文页移除 dsh-chinese-skill-patch、保留 --- 之后 footer）
- [ ] 已有 workflow 挂 readme:sync，不新增 workflow 文件
- [ ] readme:sync --check 与 doctor 对本仓全绿；本仓构建与测试通过
- [ ] 其他仓零改动

## 进度
