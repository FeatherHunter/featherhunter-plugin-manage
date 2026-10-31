<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-254e77d2-5978045 -->
<!-- DSH-CREATED: 2026-10-31T02:26:18.808Z -->
# 01: dsh-prompt 仓接入 base 包并全部测通

**What to build:** dsh-prompt 仓按 docs/handover/01、02、03 接入 base 包，并让本仓 `npm run check` 全部通过：设置面板里的作者其他插件推荐从手写清单换成 base 的 AuthorPlugins；README 的联系 / 星图 / 致谢 / 作者其他作品四块改由 readme:sync 渲染（保留 prompt 的 Markdown 标题变体）；已有 workflow 挂 readme:sync，不新增 workflow 文件。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [ ] 依赖钉精确版本 dsh-featherhunter-plugin-base@0.0.1（写入 package.json，peer react 与宿主一致）
- [ ] 设置面板推荐卡改用 base 的 AuthorPlugins：不注册 settings.section、不读写宿主存储；首帧基线、到货静默替换；整行可点开新标签页
- [ ] README.md 与 docs/README.en.md 四块内容等价迁移：联系区 260 宽 CDN 图、星图单张主题中性图带 ?v=、致谢表逐行等价、作者其他作品保留 prompt 的 MORE 标题变体
- [ ] 旧手写联系/推荐实现删除，仓内不存在第二套写 README 的路径
- [ ] 已有 workflow 挂 readme:sync（不新增 workflow 文件）
- [ ] `npm run check` 全绿（typecheck、既有全部 check:* 与 test:*）
- [ ] `npx dsh-featherhunter-plugin-base@0.0.1 readme:sync --check` 对本仓退出 0
- [ ] 其他四个仓零改动

## Comments

### local — 2026-10-31T03:47:33.149Z
这张票作废：建票时规格容器 #00 还不存在，票是以 kind=issue 直接建的，无法挂到规格下（deck_map_link 补 parent 会被后端拒绝）。已按规格体系重建为 #08（kind=spec-ticket、父票 #00、依赖边齐全），正文与验收条目一致，后续以 #08 为准。

### local — 2026-10-31T03:47:33.300Z
重复票，已由 #08 取代（规格容器 #00 建立前误建为普通 issue）

## 进度
