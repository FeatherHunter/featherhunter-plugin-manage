<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-254e7810-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:46:59.704Z -->
# 08: dsh-prompt 仓接入 base 包并全部测通

**What to build:** dsh-prompt 仓按 docs/handover/01、02、03 接入 base 包，并让本仓 `npm run check` 全部通过：设置面板里的作者其他插件推荐从手写清单换成 base 的 AuthorPlugins；README 的联系 / 星图 / 致谢 / 作者其他作品四块改由 readme:sync 渲染（保留 prompt 的 Markdown 联系标题 <sub>CONNECT</sub> 变体与 Markdown 星图形态）；已有 workflow 挂 readme:sync，不新增 workflow 文件。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 依赖钉精确版本 dsh-featherhunter-plugin-base@0.0.2（写入 package.json，peer react 与宿主一致；0.0.2 尚未发布时先用手工 tarball 验证，发布后更新 lock）
- [ ] 设置面板推荐卡改用 base 的 AuthorPlugins：不注册 settings.section、不读写宿主存储；首帧基线、到货静默替换；整行可点开新标签页
- [ ] README.md 与 docs/README.en.md 四块内容等价迁移：联系区 260 宽 CDN 图、星图保持 Markdown 单图形态带 ?v=YYYYMMDDHHmm（读 docs/star-history.json 末条日期）、致谢表逐行等价、作者其他作品保留 prompt 的 MORE 标题变体
- [ ] 旧手写联系/推荐实现删除（MORE_PLUGINS、PluginRow、旧 contact 图与 screenshots.json 条目），仓内不存在第二套写 README 的路径
- [ ] 已有 workflow 挂 readme:sync（star-history.yml、thanks.yml）并在 check.yml 加 readme:check，不新增 workflow 文件
- [ ] `npm run check` 全绿（typecheck、既有全部 check:* 与 test:*）
- [ ] `readme:sync --check --repo .` 对本仓退出 0
- [ ] 其他四个仓零改动

## 进度
