<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: hac2-t6 -->
<!-- DSH-CREATED: 2026-10-31T10:35:07.461Z -->
<!-- DSH-BLOCKED-BY: 08 -->
# 06: 装进 web profile + 用户本人目验 + HUMAN-GATE 收口

**What to build:** 把票 05 的五个 tarball 装进 web profile 并由用户本人目验：先备份 ~/.dsh/profiles/web/package.json 与 pnpm-lock.yaml；执行 dsh plugin --profile web add <五个 tarball>（自动装配 bundle 层，不手改 profile；im-companion 本次不需要 dsh-im 宿主）；重启 web-profile 实例加载新 bundle，给用户带令牌的访问地址；用户逐项人眼验收：页头操作组形态、hover 气泡、联系弹窗、深浅色、窄宽、作者插件卡、第 4 钮溢出，逐项记录通过/不通过；不通过回开对应仓修复；通过后更新 HUMAN-GATE 清单与票 14，并提醒用户在规格详情页点「完成」。默认保留本地构建产物直到正式发版，备份可一键回滚。

**Blocked by:** #08

**Status:** ready-for-agent

- [ ] 五个插件在 web profile 中可见、可交互
- [ ] 用户逐项给出通过/不通过结论并记录在票面
- [ ] 票 14 与 HUMAN-GATE 清单已更新
- [ ] 规格「完成」提醒已发出

## 2026-10-31 23:45 0.1.4 重装完成：二维码居中已修，等 owner 复验

- base **0.1.4** 已发布（manage 仓 commit 4555f74，publish workflow run 41214781218 success），五仓全部升 0.1.4 并重建产物（详见票 07），五份 tarball 落在 `D:\temp\hac2-pack\b014\`。
- web profile 已用 0.1.4 产物重装并重启：备份 `D:\temp\hac2-pack\web-profile-backup-20261031-1538`；安装 `dsh plugin --profile web add D:\temp\hac2-pack\b014x\*-b014.tgz`（Packages: +5，pnpm v11.28.5）；profile dependencies 全部指向 b014x；node_modules 五包 banner 均 v0.1.4 且各含 `.dsh-base-modal__qr{box-sizing:border-box`。
- 实例：pid 42648 监听 127.0.0.1:3080，日志无插件加载报错；带令牌地址 `http://127.0.0.1:3080/?token=SfVX_LrGn8xfnbH7rCmu3sUBZDxIn6fjiTNGU_LgyY8`（重启即换新 token）。
- 代理侧 CDP 复验（1440×1000）：联系弹窗三卡 feishu/qq/wechat 的 img 均为 data:image/png 内联码、natural 320×320、显示 215.33×215.33、computed `box-sizing=border-box`，左右留白 **gapLeft=gapRight=1px**（修复前 13/1）。截图 `.tmp/web3-contact-modal.png`。
- 问题二复核：作者插件卡渲染 4 行（dsh-prompt / dsh-opencode-palette / dsh-im-companion / ilife），用 CDP `Input.dispatchMouseEvent` 真实鼠标移入第一行 1.5s 后：`.dsh-base-tip` 与任何 `[role=tooltip]`/`[class*=tip]` 命中 0、body 元素数不变、行内无 title/aria-label/--data-tip。当前 0.1.4 产物里该卡不接气泡（公用控件仍叫 **HoverTip**，`packages/base/src/client/hover-tip.ts`）。
- 待 owner 复验：① 联系弹窗三张卡二维码都有码且水平居中；② 页头三枚彩色图标与 hover 气泡；③ 深浅色 / 窄宽；④ 若「作者插件 item 悬浮出气泡」仍复现，请截图并说明在哪个分区（可能是 desktop profile 的旧版插件或宿主自身气泡）。

## Comments

### local — 2026-10-31T23:45:00.000Z
### local — 2026-10-31T13:45:19.492Z

### local — 2026-10-31T15:11:26.346Z

### local — 2026-10-31T15:29:22.239Z

### local — 2026-10-31T16:15:03.994Z

### local — 2026-10-31T16:35:32.925Z
## 2026-11-01 00:40 0.1.5 重装完成，请 owner 复验

- 本轮 0.1.5 包含：作者插件卡每行悬停/聚焦显示完整介绍词（共用 HoverTip，160ms 延迟、Escape 关闭、aria-describedby）；页头联系我们气泡结尾 🎉、提交 Issue 气泡改为「任何功能需求、故障、建议、意见都可以提ISSUE问题单🙏」；二维码居中修复（0.1.4）保留。
- 五仓已全部升 0.1.5 并重建内联产物（TARBALL 见票 08），web profile 已重装并重启：**http://127.0.0.1:3080/?token=MH5gYDH1vFF97luhEOjgGpeqHIB9IO2FqqKukueUT4Q**（token 随进程重启变化，新 token 见 D:/temp/hac2-pack/web-serve.log）。
- 代理已用 CDP 实测通过：作者插件行悬停出气泡显示完整介绍词；页头三钮气泡新文案正确；联系弹窗三卡二维码左右留白各 13px 居中。
- 请 owner 人眼复验并给出通过/不通过结论；不通过项按仓回开修复。
## 2026-11-01 00:00 owner 首轮复验结论

- 联系弹窗二维码居中：owner 确认「看了已经居中了」→ 通过（详见票 07 关闭记录）
- 页头三钮、hover 气泡、深浅色：上一轮 web profile 真机取证已通过
- 遗留：owner 新增两项要求（作者插件卡完整介绍用 HoverTip 弹出；两处气泡文案结尾调整）→ 已转 **票 08（base 0.1.5）**，本票改为 blocked by 票 08

票 08 完成并重装 web profile 后，本票再请 owner 做最后一轮人眼验收并关闭。
## 2026-10-31 23:30 owner 首轮目验反馈 → 0.1.4 热修（进行中）
owner 反馈两条：
1. 联系弹窗二维码没有水平居中：左侧有空白、右侧贴边。**已确认为真实缺陷**：`.dsh-base-modal__qr` 是 `width:100%` + `padding:6px` 且 `box-sizing:content-box`（base 注入样式没有全局 border-box 重置），图片盒子比卡片内容列宽 12px 并整体向右溢出。真机 CDP 实测三卡：card 宽 241.3px、img 框 227.3px、左侧留白 13px、右侧仅 1px；浅/深两套卡片一致。
   修法：`.dsh-base-modal__qr` 改 `box-sizing:border-box;max-width:100%`。本地 demo 复测：三卡左右留白均 13px/13px（修复前 13/1），截图 .tmp/base-demo/modal-fixed-crop.png。base 升 **0.1.4**（commit 4555f74，publish workflow run 41214781218 success，npmmirror 已可读，tarball 386,124B，产物含 `box-sizing:border-box` 修复）；unpkg/jsDelivr 传播稍后复查。
2. 「作者的其他插件」条目悬停出现完整介绍气泡，问公用控件叫什么。**已核实**：该卡由 base `renderAuthorPlugins` 渲染（packages/base/src/client/plugins.ts），源码里没有接任何 HoverTip / 无 `title` 属性；在本轮 web profile 真机 DOM 复核：card 内 `[title]/[data-tip]` 命中 0，hover 后 `.dsh-base-tip` 命中 0。公用气泡控件名是 **HoverTip**（packages/base/src/client/hover-tip.ts，`mountTip`；ActionCluster 三按钮与联系弹窗都用它）。若 owner 仍能复现，请给一张带位置的截图（可能是宿主自己的插件列表/旧版插件里的气泡），再定位。
下一步：五仓升 0.1.4 重建产物（已派单 task-20..24）→ 重装 web profile → 重新给 owner 带 token 地址复验二维码居中。
## 2026-10-31 23:10 重装说明（0.1.3 轮）

票 07 修完二维码降级缺陷后，web profile 已用 base 0.1.3 的新产物重装并重启：
- 备份：`D:\temp\hac2-pack\web-profile-backup-20261031-230429`（回滚就把它复制回 `C:\Users\辰辰洋洋\.dsh\profiles\web` 再重启）
- 安装方式：`dsh plugin --profile web add D:\temp\hac2-pack\b013\<五个 tarball>`；之后 `dsh --profile web --port 3080 --no-open` 启动
- 当前访问地址（token 每次启动随机，进程重启即失效）：`http://127.0.0.1:3080/?token=zJs6HIwZTHO9QiH8n_ncbB_2Kf9kbS-Mlb48puQEpMM`
- 日志：`D:\temp\hac2-pack\web-serve.log`

请 owner 本人按下面顺序人眼看一遍（每项都点开左侧「设置」→ 对应插件分区）：
1. 五个设置分区页头右侧各有一排三枚彩色图标（蓝紫对话气泡 / 金色星 / 珊瑚粉气泡），无外框、无底色；鼠标悬停 0.2 秒内弹出深色气泡文案，三句分别对应联系群 / Star / Issue。
2. 点「联系我们」弹窗：三张卡（飞书 / QQ / 微信群）都要有二维码；微信群卡有效期写着 11 月 7 日前。
3. 深浅色切换（设置 → 通用设置里切主题）后再看三枚图标是否仍清晰。
4. MattSkills 分区底部作者插件卡、IM 分区底部作者插件卡是否各只有一张、不重复。
5. 把设置窗拉窄，看页头三枚图标是否被挤掉或换行错位。
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

- 进度：92%（2026-11-01T00:35:32+08:00）：0.1.5 重装完成并 CDP 取证，等 owner 人眼复验
- 进度：90%（2026-10-31T23:45:00+08:00）：0.1.4 已重装并重启（二维码居中代理侧复验通过），等 owner 人眼复验
- 进度：85%（2026-10-31T23:11:25+08:00）：0.1.3 产物已装入 web profile 并重启，等 owner 人眼看五项
- 进度：70%（2026-10-31T21:45:19+08:00）：安装+代理级真机取证完成；发现微信二维码降级缺陷已开票 07；用户目验待做
