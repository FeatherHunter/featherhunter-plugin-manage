<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 页头操作组 ActionCluster v2 与 base 0.1.2 五仓换代 -->
<!-- DSH-STATUS: ready-for-agent -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: hac2-spec-0001 -->
<!-- DSH-CREATED: 2026-10-31T10:32:22.462Z -->

## 目的
把 base 包的页头操作组从「三件套胶囊」收敛为语义正确的 Action cluster（一个容器 + N 个独立按钮），删掉 0.1.1 残留的分段控件死规则与错误文档，修掉 hover 区分度与最后一天有效期文案问题，发布 base 0.1.2，五仓换代，最后装进 web profile 由用户本人人眼验收。

## 背景
- base 0.1.1 已发布、五仓已接入。用户已纠正设计语义：三个按钮互相独立，容器只承担归组，不是「一个按钮切三段」。
- 0.1.1 里残留两条永不命中的分段控件规则（7px 内切圆角、发丝分隔线）与多处错误注释/README 描述，需删除而非补全。
- 待修：最后一天有效期显示「0 天内」；托盘内按钮 hover 与容器同 token 可能不可见；组 aria-label 写死三项名。
- 五仓验收口径由用户确定：安装到 web profile 后由用户本人人眼验收，不以代理截图代替。

## 范围与顺序
1. 四方向原型 + 方向拍板（含 Issue 落点 / 尺寸 / 双联系入口三项口径）
2. base 预清理与最后一天文案修正
3. ActionCluster v2 + demo 状态样张（等 1、2）
4. base 0.1.2 构建与发布（等 3）
5. 五仓升 0.1.2 并打包 tarball（等 4，合为一票）
6. 装进 web profile + 用户本人目验 + HUMAN-GATE 收口（等 5）
7. base 0.1.3 远端二维码加载兜底 + 五仓换代重装（等 6 真机取证发现的缺陷；票 07）
8. 作者插件卡完整介绍 HoverTip + 两处气泡文案微调 + base 0.1.5 五仓换代重装（票 08）

## 验收口径
- base：vitest/typecheck/build 绿，0.1.2 三通道可读，demo 状态样张与选定方向一致。
- 票 07（真机取证后追加）：联系弹窗三张卡（飞书/QQ/微信）在冷启动首次打开即有码，离线时三卡仍有内置基线码；0.1.3 三通道可读、五仓 banner v0.1.3、重装后用户复核通过。
- 五仓：门禁与定向测试绿，产物 banner v0.1.2（票 07 后为 v0.1.3），tarball 可安装，逐仓 commit+push。
- 票 08（owner 复验后追加）：作者插件卡每行悬停/聚焦用共用 HoverTip 弹出完整介绍词（不新增包裹层、不改省略号布局）；联系我们气泡结尾 🎉、提交 Issue 气泡改为「任何功能需求、故障、建议、意见都可以提ISSUE问题单🙏」；0.1.5 三通道可读、五仓 banner v0.1.5、重装后 owner 复核通过。
- 最终：五个插件在 web profile 中由用户本人目验并逐项记录结论；票 14 更新，规格由用户在详情页点「完成」收口。

## 说明
- web profile 安装方式：dsh plugin --profile web add <tarball>（按包内 cordis.patch.yml 自动装配 bundle 层，不手改 profile；装前备份 package.json 与 pnpm-lock.yaml）。
- 用户是技术小白：技术取舍由代理决定，票面只呈现可视化结果与可回滚方案。

## 验收记录（票 01–08 收口，2026-11-01 00:50 +08:00）

**实施票 8/8 已关闭**：01 四方向原型与拍板（B 静默簇 / Issue 落点 `<repo>/issues` / 尺寸统一 16 / 只留页头图标）、02 预清理与最后一天文案、03 ActionCluster v2 + 彩色图标 + 五状态动效 + demo 样张、04 base 0.1.2 发布、05 五仓升 0.1.2 打包、06 装 web profile 人眼目验（贯穿 0.1.2 → 0.1.5）、07 二维码兜底（0.1.3）、08 作者插件卡 HoverTip + 文案微调（0.1.5）。

**base 发布链**：0.1.2 → 0.1.3 → 0.1.4（二维码居中修复，commit 4555f74）→ 0.1.5（作者插件卡 tooltip + 文案，commit 9ca64c6）。0.1.4 publish run 41214781218、0.1.5 publish run 41218845884 均 success；unpkg / jsDelivr / npmmirror 三通道可读，tarball 解包校验 v0.1.5 banner、`createTipController`、`dsh-base-plugins__row` tooltip 接线、QR `box-sizing:border-box` 均在包内。

**五仓 0.1.5 换代（HEAD==origin，依赖精确 0.1.5）**：
| 仓 | commit | 内联产物 banner |
|---|---|---|
| dsh-prompt | `eabd828` | lib/client.js:6527 v0.1.5 |
| dsh-mattpocock-skills-deck | `61b557d4` | derived:6 / package/lib/client.js:8375 v0.1.5 |
| dsh-opencode-palette | `3b01032` | package/lib/client.js:22802 v0.1.5 |
| dsh-im-companion | `e7651a9` | lib/client.js:28163 v0.1.5 |
| ilife | `c7f0ea8` | dist/client.js:101 v0.1.5 |

聚合校验：`readme:sync --check --all --repos D:/dsh-plugin` EXIT 0（11 份 README up to date）；`doctor --repos D:/dsh-plugin` EXIT 0（package-version 0.1.5、manifest v0.1.5 rev2、五仓 readme-images @0.1.5、dependency-version 0.1.5、deck inline-bundle-version v0.1.5）。

**web profile 最终安装（0.1.5）**：备份 `D:/temp/hac2-pack/web-profile-backup-20261101-0022`；`dsh plugin --profile web add` 五个 b015x tarball（Packages: +5，pnpm v11.28.5）；实例 127.0.0.1:3080 无插件加载报错。

**owner 人眼验收（2026-11-01 00:44）**：原话「效果蛮好的，有你可以自行验证的你可以直接验证了。我目前看到的效果都满意」→ 全部通过。

**代理自行补验矩阵（web profile 真机 CDP，1416×845）**：
- 五设置分区（提示词模板 / MattSkills / OpenCode调色板 / 爱生活 / IM机器人增强）：各 1 个 `.dsh-base-cluster`（92×28、gap 4、透明底、0 边框、role=group、aria-label=快捷操作）× 3 枚 28×28 按钮；旧 `.dsh-base-actions--group` 0、面板底部联系整行 0。
- 三钮气泡文案五区一致：联系我们「扫码加入交流群，反馈、建议、idea 都欢迎🎉」/ Star「您的🌟是我夜空中最亮的星🌹」/ Issue「任何功能需求、故障、建议、意见都可以提ISSUE问题单🙏」；同屏 1 枚、opacity 1。
- 落点：联系我们无 href（开弹窗）；Star → 各仓 `<repo>`；Issue → 各仓 `<repo>/issues` 列表（不再 `/issues/new`）。
- 作者插件卡 4 行，悬停任一分区首行均出 1 枚 role=tooltip 完整介绍词，行上 aria-describedby 指向气泡。
- 联系弹窗三卡 data:image/png、natural 320×320、显示 215×215、左右留白 13/13px；Esc 关闭且焦点回「联系我们」；Tab×4 焦点困在 dialog；初始焦点为关闭按钮。
- 窄宽：viewport 1000 / 900 下五区 cluster 均在对话框内、无横向溢出（scrollWidth == innerWidth）。
- 深色：`prefers-color-scheme:dark` 下 body bg rgb(10,10,10)，cluster 透明底、按钮 28×28、气泡正常。
- base demo 0.1.5 五状态 computed：默认 ::before opacity 0；is-hover .85；is-active transform matrix(.88,…) + .95；is-focus outline 2px solid rgb(77,107,254) offset 2；disabled opacity .38 + grayscale(1) saturate(.25)；`prefers-reduced-motion` 规则在 styles.ts:105。

**遗留**：票 14（HUMAN-GATE A/C 已可引用本轮证据；B 手机扫码 / D Desktop 安装形态 / E 断网降级 待 owner 真机）；各仓既有红点非本次引入（prompt test:star-history / test:issue-89 僵尸 / check:update-pkg 需联网；ilife ci-gates-295 / p10-boundaries；palette check-deps 离线 '?'）。规格收口由用户在详情页点「完成」。

## 进度
