<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: hac2-t6 -->
<!-- DSH-CREATED: 2026-10-31T10:35:07.461Z -->
<!-- DSH-BLOCKED-BY: 05 -->
# 06: 装进 web profile + 用户本人目验 + HUMAN-GATE 收口

**What to build:** 把票 05 的五个 tarball 装进 web profile 并由用户本人目验：先备份 ~/.dsh/profiles/web/package.json 与 pnpm-lock.yaml；执行 dsh plugin --profile web add <五个 tarball>（自动装配 bundle 层，不手改 profile；im-companion 本次不需要 dsh-im 宿主）；重启 web-profile 实例加载新 bundle，给用户带令牌的访问地址；用户逐项人眼验收：页头操作组形态、hover 气泡、联系弹窗、深浅色、窄宽、作者插件卡、第 4 钮溢出，逐项记录通过/不通过；不通过回开对应仓修复；通过后更新 HUMAN-GATE 清单与票 14，并提醒用户在规格详情页点「完成」。默认保留本地构建产物直到正式发版，备份可一键回滚。

**Blocked by:** #05

**Status:** ready-for-agent

- [ ] 五个插件在 web profile 中可见、可交互
- [ ] 用户逐项给出通过/不通过结论并记录在票面
- [ ] 票 14 与 HUMAN-GATE 清单已更新
- [ ] 规格「完成」提醒已发出

## 进度
