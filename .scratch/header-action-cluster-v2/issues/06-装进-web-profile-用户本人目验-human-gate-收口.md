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

## Comments

### local — 2026-10-31T13:45:19.492Z
## 真机取证记录（2026-10-31 21:00–22:00，代理侧）

**安装**：profile 目录写 .npmrc（registry=https://registry.npmmirror.com/）绕过本机对 registry.npmjs.org 的 TLS 阻断后，`dsh plugin --profile web add` 五个 tarball 成功（Packages: +6，pnpm v11.28.5，964ms）。profile package.json 的 dependencies 已全部指向 file:D:/temp/hac2-pack/*.tgz，bundles 由 6 个增至 8 个（新增 dsh-im-companion、dsh-life-pack）。安装前备份：D:\temp\hac2-pack\web-profile-backup-20261031-204444（package.json / pnpm-lock.yaml / cordis.patch.yml / cordis.yml / pnpm-workspace.yaml）。
**实例**：web profile 以 127.0.0.1:3080 启动（pid 88812），带令牌地址从 D:\temp\hac2-pack\web-serve.log 的 `dsh web: http://.../?token=` 行取（每次重启换新 token）。服务端日志无插件加载报错。
**代理侧逐项实测（headless Chrome + CDP）**：
1. 插件管理页可见全部五个插件（dsh-im-companion / dsh-life-pack / dsh-mattpocock-skills-deck / dsh-opencode-palette / dsh-prompt），deck 详情显示 v1.9.0-beta.33 运行中、代码来源 file:D:\temp\hac2-pack\dsh-mattpocock-skills-deck-1.9.0-beta.33.tgz。
2. 设置面板五个插件分区（OpenCode调色板 / MattSkills / 爱生活 / IM机器人增强 / 提示词模板）逐个实测：每区恰好 1 个 .dsh-base-cluster + 3 个 .dsh-base-cluster__btn，aria-label 为 联系我们 / Star 这个项目 / 提交 Issue，容器 role=group、aria-label=快捷操作。页头右侧为三枚彩色图标（蓝紫对话气泡 / 金色星 / 珊瑚粉气泡），无托盘无边框（B 静默簇）。
3. hover：派发指针事件后 1.2s 出现 .dsh-base-tip，文案「扫码加入交流群，反馈、建议、idea 都欢迎」，opacity 1。
4. 联系弹窗：dialog.dsh-base-modal 进入 top layer，3 张卡 data-group-id=feishu/qq/wechat。**发现缺陷：微信卡没有二维码**（飞书/QQ 正常），只有有效期文案与「点此获取最新群二维码」降级按钮。
**缺陷定位**：content.ts 的 1500ms 超时被 manifest 与二维码图片共用（冷启动 cdn.jsdelivr.net 实测 2010ms 被 abort）+ 失败结果缓存 30 分钟不重试 + 微信二维码无内置基线码（BUNDLED_PLATFORMS 只含 feishu/qq）。已开票 07 修复并重发 base 0.1.3，再五仓换代重装。
**票 06 与票 07 的关系**：票 06 保持 open。页头操作组相关验收项（形态 / hover / 深浅色 / 窄宽 / 作者插件卡）可直接由用户目验；联系弹窗一项等票 07 修复重装后再复核。
**截图证据**：.tmp/web-shell.png、web-deck-settings.png、web-palette-settings.png、web-life-settings.png、web-im-settings.png、web-prompt-settings.png、web-tip.png、web-contact-modal.png（微信卡缺码）。

## 进度

- 进度：70%（2026-10-31T21:45:19+08:00）：安装+代理级真机取证完成；发现微信二维码降级缺陷已开票 07；用户目验待做
