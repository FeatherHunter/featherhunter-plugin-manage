<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-98234df0-5978045 -->
<!-- DSH-CREATED: 2026-10-31T02:26:30.708Z -->
<!-- DSH-BLOCKED-BY: 01 -->
# 02: deck 仓接入 base 包

**What to build:** deck 仓接入 base 包：设置面板加入口与作者插件卡、README 三个文件迁移四块、已有 star-history.yml / thanks.yml 挂 readme:sync、删除旧 assets/contact-*.png，deck 构建与测试通过。

**Blocked by:** #01

**Status:** resolved

- [ ] 依赖钉精确版本，产物可被 deck 构建链吃下（重新内联 dist/client/index.js 并提交）
- [ ] 设置面板入口与推荐卡接入；旧实现删除
- [ ] README.md、package/README.md、docs/README.en.md 四块迁移（英文页移除 dsh-chinese-skill-patch、保留 --- 之后 footer）
- [ ] 已有 workflow 挂 readme:sync，不新增 workflow 文件
- [ ] readme:sync --check 与 doctor 对本仓全绿；本仓构建与测试通过
- [ ] 其他仓零改动

## Comments

### local — 2026-10-31T03:47:34.109Z
这张票作废：建票时规格容器 #00 还不存在，票是以 kind=issue 直接建的，无法挂到规格下（deck_map_link 补 parent 会被后端拒绝）。已按规格体系重建为 #09（kind=spec-ticket、父票 #00、依赖边齐全），正文与验收条目一致，后续以 #09 为准。

### local — 2026-10-31T03:47:34.182Z
重复票，已由 #09 取代（规格容器 #00 建立前误建为普通 issue）

## 进度
