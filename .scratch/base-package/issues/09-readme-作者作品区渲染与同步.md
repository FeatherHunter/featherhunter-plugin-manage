<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 06, 08 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-57146219-5977919 -->
<!-- DSH-CREATED: 2026-10-30T15:56:56.418Z -->
# 09: README 作者作品区渲染与同步

**What to build:** 实现作者其他作品区的渲染器与同步：标准 HTML 标题 + 引导句 + 四行链接；兼容 prompt 两个文件的 Markdown 标题变体与两种英文标题；每仓排除自己；新增成对标记；ilife 补上该块；deck 英文页按拍板移除不在定稿清单里的第 6 个插件行。

**Blocked by:** 06, 08

**Status:** ready-for-agent

- [ ] 现有 10 处渲染结果与 fixture 内容等价（成员、顺序、链接、文案）
- [ ] prompt 两个文件保留 Markdown 标题变体；英文标题两种历史形态都保留
- [ ] ilife 新块插入到正确位置；deck 英文页多余行按拍板移除
- [ ] 同步幂等、检查模式可用；标记不配对或脏行时报错

## 进度
