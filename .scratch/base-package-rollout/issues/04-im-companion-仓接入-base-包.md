<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-d3db0600-5978045 -->
<!-- DSH-CREATED: 2026-10-31T02:26:33.955Z -->
<!-- DSH-BLOCKED-BY: 01 -->
# 04: im-companion 仓接入 base 包

**What to build:** im-companion 仓接入 base 包：自绘二维码弹窗换成 base.openContactModal，删除旧样式 / 群码 / i18n；先修 README 的 merge-conflict 脏行再迁移两个 README；已有 thanks.yml 挂 readme:sync。

**Blocked by:** #01

**Status:** resolved

- [ ] 先删除 README 里的 </div>>>>>>>> origin/master 脏行，readme:sync 才能写入
- [ ] 弹窗改用 base.openContactModal；旧自绘弹窗、样式、群码、i18n 删除
- [ ] README.md、docs/README.en.md 四块迁移（含 im 星图 width 720 与角注保留）
- [ ] 已有 workflow 挂 readme:sync，不新增 workflow 文件
- [ ] readme:sync --check 与 doctor 对本仓全绿；本仓构建与测试通过
- [ ] 其他仓零改动

## Comments

### local — 2026-10-31T03:47:35.822Z
这张票作废：建票时规格容器 #00 还不存在，票是以 kind=issue 直接建的，无法挂到规格下（deck_map_link 补 parent 会被后端拒绝）。已按规格体系重建为 #11（kind=spec-ticket、父票 #00、依赖边齐全），正文与验收条目一致，后续以 #11 为准。

### local — 2026-10-31T03:47:35.967Z
重复票，已由 #11 取代（规格容器 #00 建立前误建为普通 issue）

## 进度
