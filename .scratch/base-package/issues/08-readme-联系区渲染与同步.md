<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 03, 07 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-b7d5aaaa-5977919 -->
<!-- DSH-CREATED: 2026-10-30T15:56:53.917Z -->
# 08: README 联系区渲染与同步

**What to build:** 实现联系区的渲染器与同步命令：标准标题变体与 ilife 的 Markdown 标题变体都能渲染；README 里插入成对标记，命令支持初始化、同步、只检查三种模式；联系区图片改为绝对 CDN 地址（258 宽整卡、日期文件名、带版本查询串）；同步只替换标记块，遇到脏行或结构可疑处停手报错，重复运行零 diff。

**Blocked by:** 03, 07

**Status:** ready-for-agent

- [ ] 两个变体渲染结果与 fixture 内容等价
- [ ] 初始化能在无标记文件里正确插入标记；同步幂等；检查模式有差异时非零退出
- [ ] 脏行被识别为错误且不改文件；标记不配对时报错
- [ ] 图片 URL 为精确版本 + 日期文件名 + 版本查询串；README 输出不含弹窗专用字段

## 进度
