<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 08 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-d3db063e-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:47:20.872Z -->
# 11: im-companion 仓接入 base 包

**What to build:** im-companion 仓接入 base 包：自绘二维码弹窗换成 base.openContactModal，删除旧样式 / 群码 / i18n；先修 README 的 merge-conflict 脏行再迁移两个 README；已有 thanks.yml 挂 readme:sync。

**Blocked by:** 08

**Status:** resolved

- [ ] 先删除 README 里的 </div>>>>>>>> origin/master 脏行，readme:sync 才能写入
- [ ] 弹窗改用 base.openContactModal；旧自绘弹窗、样式、群码、i18n 删除
- [ ] README.md、docs/README.en.md 四块迁移（含 im 星图 width 720 与角注保留）
- [ ] 已有 workflow 挂 readme:sync，不新增 workflow 文件
- [ ] readme:sync --check 与 doctor 对本仓全绿；本仓构建与测试通过
- [ ] 其他仓零改动

## Comments

### local — 2026-10-31T05:08:32.614Z

### local — 2026-10-31T05:08:34.263Z
实现完成：面板接 base ContactRow、两份 README 四块托管、既有两份 workflow 挂 readme:sync；check/readme:check/doctor 全绿。偏离：仓内无自绘联系弹窗（connect-flow 是 provisioning 流程，保留），handover 01 §6 与事实不符。待 HUMAN-GATE 真机证据。
## 实现完成（降级路线：本机直接改仓 + 本地提交，未 push）

- 提交：76dd0f6d（dsh-im-companion master，ahead 3 = #189 两笔 + 本票一笔；无 amend/rebase）
- 规模：20 files changed, +231/−165

### 验证（Lead 独立复跑）
- npm run check → exit 0：build host+client、typecheck、verify 全绿（node:test 595 pass / 0 fail；render-client ALL PASS；guard 190 files PASS）
- npm run readme:check → exit 0：README.md / docs/README.en.md 均 up to date
- base doctor . → exit 0：10 项全 ok（dependency-version pinned 0.0.2 / cron-mounts 挂 star-history.yml+thanks.yml / readme-blocks 2 README in sync / star-assets present / remote-manifest unpkg v0.0.2）

### 逐条核对
- [x] 先删 README 262 行 '</div>>>>>>>> origin/master' 脏行，readme:sync 可正常写入
- [x] 联系入口：面板尾部接 base ContactRow（新增 src/client/base-ui.ts，点击走 base.openContactModal，联系真源只剩 base 一份）；README 群码换 base CDN 整卡，删除 4 张废弃群码图（assets/contact-feishu-permanent.png、contact-qq-permanent.jpg、contact-wechat-weekly.png、DSH插件交流群-飞书二维码.png）
- [x] 两份 README 四块（MORE / THANKS / CONTACT / STAR-HISTORY）全部由 readme:init+sync 生成；星图 width=720 + 中英角注 + 12 位戳 ?v=202610290000
- [x] 只在既有 star-history.yml / thanks.yml 挂 readme:sync，无新增 workflow（git diff origin/master..HEAD -- .github/workflows 仅 2 个 M）
- [x] 其他仓零改动（本票提交只含 dsh-im-companion 文件）

### 偏离与说明（重要）
- 仓内实际没有「自绘联系弹窗」可删：git log --all -S 对 contact 群码/联系我们/扫码进群/交流群 在 src 下无命中；src/client/components/connect-flow.ts 是「接入机器人 provisioning 二维码」流程（provision.begin/cancel + 倒计时轮询 + 双模式手填，被 tools/verify/features/connect-qr.ts 守护），不是联系弹窗，换成 base.openContactModal 会破坏开通流程，故保留。handover 01 §6 把它当自绘联系弹窗与 HEAD 事实不符，建议后续修订 handover。
- package-lock.json 既有约 100 处 registry.npmmirror.com URL 为历史遗留，本票只改 base 条目：resolved=https://registry.npmjs.org/.../dsh-featherhunter-plugin-base-0.0.2.tgz，integrity 与发布 tarball 一致。
- update-thanks 改为只写 docs/thanks-data.json（不再自绘表），thanks-table 门禁改比 base renderThanksBlock。

### 遗留风险
- README 需随远端仓库推送后 GitHub 观感确认（HUMAN-GATE 票 14）。
- 真机扫码 / dialog top-layer、焦点回归 / manifest 不可达时 BASELINE 兜底，需 HUMAN-GATE 真机验证。
- theme.ts 现 299 行（guard 上限 300），后续加样式需先拆文件。

## 进度

- 进度：100%（2026-10-31T13:08:31+08:00）：实现完成并 Lead 独立复跑 check/readme:check/doctor 全绿，本地提交 76dd0f6d（未 push）
