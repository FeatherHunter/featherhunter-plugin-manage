<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 页头操作组 ActionCluster v2 与 base 0.1.2 五仓换代 -->
<!-- DSH-STATUS: closed -->
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

## 发版记录：dsh-prompt 0.4.40（2026-11-01 01:2x +08:00）

- 目的：验证「五仓 + base 0.1.5 收口后的产物」能走正式 npm 发版链路（此前五仓只在本机 file: tarball 上迭代）。
- 变更 commit `ae7c6b5`（main，7 files +91/−16）：version 0.4.39→0.4.40（package.json / package-lock）、README 中英安装命令锁版、CHANGELOG 0.4.40 条目、`scripts/check-star-history.mjs` 门禁修正（刻度数字按 Yd(v)+4 摆放，回推像素 y 需减 4；峰值落在最后一天时不再要求平滑后顶点高于原始顶点）、新增 `.github/workflows/publish.yml`（workflow_dispatch：npm ci → node 读 version → build → npm publish --tag inputs.tag）。
- 本机 registry.npmjs.org TLS 被拦（直连与 127.0.0.1:7890 代理均 curl exit 35），故发版走 GitHub Actions：`gh secret set NPM_TOKEN`（取自 User 环境变量 NODE_AUTH_TOKEN，40 字符）→ `gh workflow run publish.yml --ref main -f tag=latest` → run [41223953408](https://github.com/FeatherHunter/dsh-prompt/actions/runs/41223953408) completed/success（job 124604096278，17s）。
- npm notice：`dsh-prompt@0.4.40` package size 998.1 kB / unpacked 3.6 MB / 13 files / shasum `c2a9543ec12795ac3a6b92e295ad87abfa97dc11` / integrity `sha512-DOBulWrDL+CoG…wpqsU3g3WFfdA==`；publish 输出 `+ dsh-prompt@0.4.40`（tag latest）。
- 发布后核验：npmmirror `dist-tags.latest=0.4.40`（sync 2026-10-31T17:20:52Z）；jsDelivr `@0.4.40/package.json` 200（version 0.4.40）；`npm install dsh-prompt@0.4.40 --registry=https://registry.npmmirror.com` 成功（3 packages / 2s），装出的 `lib/client.js` 含 base `v0.1.5` banner ×1、`dsh-base-cluster` ×115。
- npmmirror tarball 998,150B 解包：`package/package.json` version 0.4.40；`lib/client.js` 942,485B，`dsh-base-cluster` ×115、`__btn` ×49、`createTipController` ×3、`rowTip` ×2、`dsh-base-modal__qr{box-sizing:border-box` ×1、`linearGradient` ×4、旧 `dsh-base-actions--group` ×2（兼容代码）。
- unpkg 在发布后 ~10 分钟仍 404（同步滞后），以 npmmirror、jsDelivr 与 registry 实际安装为证据；npmjs 本体不可直连（本机 TLS），发版成功与 jsDelivr 200 共同证明 npmjs 侧已收录。
- 其余四仓尚未发版；如需，可按同一 workflow 模式逐个加 `publish.yml`。
- **GitHub Release 补齐（2026-11-01 01:36）**：此前只做了 npm publish，GitHub 仓库页的 Releases 仍停在 v0.4.39（owner 反馈「没看到 dsh-prompt 有发布最新版本」即此）。已补：tag `v0.4.40` → commit `ae7c6b5`；GitHub Release [v0.4.40](https://github.com/FeatherHunter/dsh-prompt/releases/tag/v0.4.40) 设为 **Latest**，notes 取自 CHANGELOG 0.4.40 段，资产 `dsh-prompt-0.4.40.tgz` 与 `dsh-prompt.tgz`（各 998,150B）。
- **发版口径修正为「npm publish + GitHub Release 一次完成」**：`publish.yml` 新增 `Create GitHub release` 步骤（`permissions: contents: write`；发 latest 时按 CHANGELOG 对应版本段建 release，附 `npm pack` 产物 `<pkg>-<ver>.tgz` 与稳定名 `dsh-prompt.tgz`）；`Publish to npm` 改为幂等（`npm view <pkg>@<ver>` 已存在则跳过）。commit `f140852`；run [41225497257](https://github.com/FeatherHunter/dsh-prompt/actions/runs/41225497257) 验证幂等路径 success（npm 已有该版本、release 已存在，两处均跳过）。

## 发版记录：dsh-opencode-palette 2.1.11（2026-11-01 01:48 +08:00）

- 版本 2.1.10→2.1.11；内容 = 页头 ActionCluster（base 0.1.5 彩色三图标）+ 删面板底部联系整行 + 产物重建。
- 变更 commit `d1695e1`（6 files +109/−9：package.json / package-lock 两处 / readme:version 刷两 README / `package/release-notes-2.1.11.md` / 新增 `.github/workflows/publish.yml`），push `3b01032..d1695e1` main。发布流程 = workflow_dispatch：typecheck → check-deps --warn-only → fonts → build:artifacts → npm test → verify:artifacts → 幂等 npm publish → `package/` 内 pack → GitHub Release（2 资产）。
- 首跑 run [41262130385](https://github.com/FeatherHunter/dsh-opencode-palette/actions/runs/41262130385) 红：CI Node 的 `navigator.language=en-US` 让 `dsh-plugin-update` 的 `resolveLang` 走英文，`tests/update-panel.test.ts` 三条中文断言与实际 'Check for updates' 等不符；`tests/panel-render.test.ts` 在 Linux 上 `createRequire('D:/0Tools/DSH Desktop/...')` 抛 ERR_INVALID_ARG_VALUE。修法 commit `501bdb5`（3 files +18/−13）：测试显式固定 zh 语言、回退路径改为 `createRequire(import.meta.url)` 主 + Windows 路径 try/catch 追加。强制 en-US 复跑 68/68、全量 312/312。
- 重跑 run [41262443628](https://github.com/FeatherHunter/dsh-opencode-palette/actions/runs/41262443628) success：7 files / 704.1 kB / shasum `b9ed38757cb37ea19f14f47ec5f637bca54adc15` / integrity `sha512-NeoMOYZ34XEGT6iylqn5JSjmmYafcyuevFUgm65L91tNe+QraraiYZMXC7rJSfhahCFM/f3qsnzGBOQPz/HxpA==`，tag+Release [v2.1.11](https://github.com/FeatherHunter/dsh-opencode-palette/releases/tag/v2.1.11)（Latest，资产 `dsh-opencode-palette-2.1.11.tgz` 与别名 `dsh-opencode-palette.tgz` 各 704,112B，sha256 `66a82308…1b9697`）。
- 可见性：publish 01:48，npmmirror 01:58 可见（latest=2.1.11）；jsDelivr/unpkg `@2.1.11/package.json` 均 200。收尾 commit `304bc6c` 回填 release notes 哈希段。

## 发版记录：ilife 0.3.86（七包，2026-11-01 10:23 +08:00）

- 七个包整体 0.3.85→0.3.86（dsh-life-pack + 六单品 dsh-bill-ilife / dsh-calorie / dsh-chef / dsh-home-ilife / dsh-memo-ilife / dsh-schedule-ilife；其余 base-*/skill-* 保持 0.3.55）；内容同 palette 的页头簇换代 + 作者插件卡 tooltip + 弹窗二维码修复。
- 变更 commit `d1c2953f`（12 files +188/−20：7 个 package.json / 两处 README 版本行 / pnpm-lock 六处 importer / `.changeset/08-header-action-cluster.md` / `docs/releases/v0.3.86.md` / 新增 `.github/workflows/publish.yml`），tag `v0.3.86`。
- 首次 publish run [41263086785](https://github.com/FeatherHunter/ilife/actions/runs/41263086785) 红：`check-publish --pre` 报 `dsh-life-pack` 内嵌 `dsh-plugin-update` 必须声明 `^0.18.39`（#1282 latest tag 冻锁），当时为 `^0.18.38`——本机 npmjs 被拦时该校验离线 WARN 跳过，联网 CI 立刻红。修法 commit `2cb115f9`：`packages/plugin-manager/package.json` 升 `^0.18.39`、pnpm-lock 两处条目与 importer 同步、`docs/releases/v0.3.86.md` 补一条；本地把 `.pnpm` 里的 0.18.39 换入后重建，`packages/plugin-manager/dist/client.js` 1,294,902B 含 0.18.39（0.18.38 命中 0）、base banner v0.1.5、0.3.86。tag 强移到该提交（58e9a90f）。
- 第二次 run [41263467373](https://github.com/FeatherHunter/ilife/actions/runs/41263467373)：npm publish 步成功（七包全部真发 0.3.86），但打包步红——从仓库根 `npm pack "packages/plugin-manager"` 被 npm 当成 GitHub 简写（`ssh://git@github.com/packages/plugin-manager.git`，Permission denied publickey）。修法 commit `148770f2`：改在包目录内打包 `( cd "packages/$dir" && npm pack --pack-destination "$OUT" )`。
- 第三次 run [41264795579](https://github.com/FeatherHunter/ilife/actions/runs/41264795579) success：publish 幂等跳过、打包 7+1 资产、tag 已存在跳过新建、Release [v0.3.86](https://github.com/FeatherHunter/ilife/releases/tag/v0.3.86) 为 **Latest**（8 资产：七包 + `dsh-life-pack.tgz` 别名，life-pack 1,903,363B、其余 18–20 万 B），notes 取自 `docs/releases/v0.3.86.md`。
- 已发 npm shasum：dsh-life-pack `7233e6ff…6b4d42`、dsh-bill-ilife `aa9c14c5…0948d5`、dsh-calorie `dae6dcf2…3d7856b`、dsh-chef `993917e6…bb98d`、dsh-home-ilife `c663aaa4…869ac1`、dsh-memo-ilife `8008199a…916172`、dsh-schedule-ilife `58c409d4…6e6815`。
- 资产抽检：`dsh-life-pack-0.3.86.tgz` 内 `package/dist/client.js` 1,339,485B，base banner v0.1.5 命中 1、v0.1.4 命中 0，0.18.39 命中 36、0.18.38 命中 0，`dsh-base-cluster__btn` ×49；`dsh-calorie-0.3.86.tgz` 内 version 0.3.86、依赖 dsh-life-pack 0.3.86。
- 镜像：jsDelivr/unpkg 七包 0.3.86 均 200；npmmirror 起初六个已同步、dsh-calorie 滞后（latest 仍 0.3.85），已用 `PUT https://registry.npmmirror.com/dsh-calorie/sync` 触发补同步（201 ok:true），随后复查。
- 环境限制：本机 registry.npmjs.org TLS 被拦（curl exit 35），两仓发布均走 GitHub Actions；GitHub Actions 队列近期拥堵（排队 10–17 分钟），重跑需耐心等待。

## 发版记录：dsh-mattpocock-skills-deck 1.9.0-beta.33（2026-11-01 12:2x +08:00）

- 版本此前只在本机 tarball 里存在（npm 最新停在 1.9.0-beta.32），owner 要求「不要挂本地形式的」，因此补发。版本号、README 三处锁版、CHANGELOG 的 beta.33 节此前已就绪；本次补：`.github/workflows/publish.yml`（workflow_dispatch：pnpm install --frozen-lockfile → node scripts/build.mts → typecheck → 五条冒烟 → 发布契约校验 → 幂等 publish → `package/` 内 pack → annotated tag + Release 附版本化与固定名两资产）、GitHub About 描述 v1.3.1→v1.3.2（与 package description 同句）。
- 发布管道经 4 次 run 收敛：41272392945 红在 pnpm/action-setup 版本冲突（`version: 11.22.0` 与 packageManager 带 sha512 同时给）→ commit 34d26637 只从 packageManager 读；41272591987 npm 发布步已成功（`+ dsh-mattpocock-skills-deck@1.9.0-beta.33`、`+latest:` 同步指向）但打 annotated tag 报 Committer identity unknown → commit 0e957cf4 打 tag 前配 git 身份；41272783224 Release 已建、固定名资产上传步在 mktemp 目录解析不到仓库 → commit 80788911 回工作区并 `-R` 上传；41272933352 success（走后一次幂等路径：publish SKIP、tag/Release 已存在跳过）。
- commit：cf9abe5e（发版管道 + CHANGELOG 补 base 0.1.5 界面说明）→ 34d26637 → 0e957cf4 → 80788911，全部 push main，HEAD==origin。
- npm：`dsh-mattpocock-skills-deck@1.9.0-beta.33`，dist-tags beta 与 latest 均指向该版本，shasum `9c42bbff4f329be7806afa35eee25776beeb643e`、size 2,028,781 B / unpacked 7,774,822 B / 672 files。GitHub Release [v1.9.0-beta.33](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/releases/tag/v1.9.0-beta.33) 为 Latest，notes 与 CHANGELOG 对应节逐字一致（5327 chars，脚本比对 true），两资产：版本化 `dsh-mattpocock-skills-deck-1.9.0-beta.33.tgz`（2,028,778 B）与固定名 `dsh-mattpocock-skills-deck.tgz`（2,028,781 B，sha1 与 npm shasum 一致 = npm 原包）。
- 产物抽检（Release 固定名资产）：`package/lib/client.js` banner `dsh-featherhunter-plugin-base v0.1.5` ×1、v0.1.4 ×0、`dsh-base-cluster__btn` ×49、`createTipController` ×3；package.json version 1.9.0-beta.33。
- 本地门禁：build / typecheck / test:smoke / verify-release-contract（58 通过 0 失败）/ readme:check 全 EXIT=0。
- 注意：GITHUB_TOKEN 创建的 Release 不会触发仓内 `release-tarball.yml`，故固定名资产由 publish.yml 自己从 npm 拉原包附上；tag 打在 0e957cf4（发布内容提交），之后 80788911 只改 workflow，不影响包内容。

## 发版记录：dsh-im-companion 0.2.26（2026-11-01 12:16 +08:00）

- 版本 0.2.25→0.2.26（package.json + package-lock 两处），README 中英版本行与 CHANGELOG（[Unreleased] 落成 `[0.2.26] - 2026-11-01`）同步；新增 `.github/workflows/publish.yml`（npm ci → build → check → readme:check → 幂等 publish → pack → tag + Release）。commit `e947af7`（6 files +128/−11，push master，HEAD==origin）。
- run [41272354524](https://github.com/FeatherHunter/dsh-im-companion/actions/runs/41272354524) success；npm shasum `f31248ba35fac71b770ec284c0e8958a78bce79c`（100 files / 1,174,140 B）；GitHub Release [v0.2.26](https://github.com/FeatherHunter/dsh-im-companion/releases/tag/v0.2.26) 资产 sha1 与 npm shasum 一致。
- 产物抽检：`lib/client.js` 1,309,641B、banner v0.1.5 @ line 28163、v0.1.4 ×0、`dsh-base-cluster__btn` ×49、`createTipController` ×3。
- 本地门禁：build / check（SOME_FAIL=0、ALL PASS=17、React Warning=0、guard 191 files PASS）/ readme:check 全 EXIT=0。

## 收口记录：web profile 依赖切到 npm 正式版（票 09，2026-11-01 12:40 +08:00）

- 背景：0.1.5 验收阶段 web profile 里挂的是本机 `file:D:/temp/hac2-pack/b015x/*.tgz`；owner 明确要求「不要挂本地形式的」，且 deck/im 的 npm 版还是旧 UI（deck beta.32、im 0.2.25 不含 base），故先补发两仓（上两节），再整体切 npm。
- 前置：`~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 逐行补 5 条（dsh-prompt@0.4.40、dsh-opencode-palette@2.1.11、dsh-life-pack@0.3.86、dsh-mattpocock-skills-deck@1.9.0-beta.33、dsh-im-companion@0.2.26），绕开 pnpm 24h 新版等待期；安装前备份 `D:/temp/hac2-pack/web-profile-backup-20261101-1215`（package.json / pnpm-lock.yaml / pnpm-workspace.yaml）。
- 安装命令：`dsh plugin --profile web add --save-exact dsh-prompt@0.4.40 dsh-opencode-palette@2.1.11 dsh-life-pack@0.3.86 dsh-mattpocock-skills-deck@1.9.0-beta.33 dsh-im-companion@0.2.26 --registry=https://registry.npmmirror.com/ --reporter=append-only` → EXIT 0，pnpm 日志逐条 `Replaced "<pkg>" ("file:...tgz") with "<version>" from a different source`、`Packages: +6`、10.9s。
- profile 现状：dependencies = dsh-im-companion 0.2.26 / dsh-life-pack 0.3.86 / dsh-mattpocock-skills-deck 1.9.0-beta.33 / dsh-opencode-palette 2.1.11 / dsh-prompt 0.4.40 / dsh-plugin-update 0.18.38 / dshmarket ^1.66.44；bundles 8 个；`package.json` 与 `pnpm-lock.yaml` 均无 file: 依赖（lock 里唯二 `file:` 子串来自 `lockfileVersion:` 与 `excludeLinksFromLockfile:`）。
- 重启 web 实例（127.0.0.1:3080）后 CDP 复验：五插件设置页版本文案分别为 0.4.40 / 1.9.0-beta.33 / v2.1.11 / dsh-life-pack 0.3.86 / v0.2.26；每页仍恰 1 个 `.dsh-base-cluster` + 3 枚 `__btn`；MattSkills 作者插件卡 4 行、hover 首行 `.dsh-base-tip` 恰 1 枚 role=tooltip、opacity 1、文案为完整介绍词；联系弹窗 3 卡（feishu/qq/wechat）三张 `.dsh-base-modal__qr` 均 data:image/png、natural 320×320、computed box-sizing=border-box。截图：`.tmp/web5-settings.png`、`.tmp/web5-five-pages.png`、`.tmp/web5-mattskills.png`、`.tmp/web5-contact-npm.png`。
- 结论：本地 tarball 仅保留在 `D:/temp/hac2-pack/` 作历史备份，profile 不再引用；票 09 已关闭（规格下实施票 09/09 全部 resolved）。

## 收口评论：规格 00 独立复核（2026-11-01 13:05 +08:00）

复核人：本会话 agent（lead）。触发：用户 2026-11-01 指令——8/8 实施票已关只是触发，不是完成证明；四项（承诺落地 / 长线分支 / 提交上检查可复跑 / 遗留清零）缺一不关。本记录按四项逐条给出可复跑证据；结论：四项全部成立，关闭本规格。

说明：规格正文没有单列用户故事验收表，按工作区惯例以「规格 验收口径 5 条 + 各实施票验收标准」合并核对（此约定写在这里，供复核者沿用）。

## 一、承诺落地：票 01–09 逐票核对（全部 closed，无 wontfix / duplicate / 缩减范围票）

核对方式：打开每张票的验收标准 → 用 git show 看交付提交里的真实代码/测试 → 在本会话复跑对应测试；票的 closed 状态与正文自述不作为证据。

| 票 | 交付提交（仓） | 实际检查到的实现 / 测试 |
|---|---|---|
| 01 四方向原型与方向拍板 | manage prototype/header-action-cluster 分支 9e1ac64（四方向 header-action-cluster.html ?v=1..4）、253b0ff + 108b3c9（图标样张 action-icon-set.html / action-icon-set-v2.html） | 原型文件在分支上可打开；用户拍板 B 静默簇、Issue 落点 /issues 列表、图标 16px、只保留页头图标（记录在票 01 与规格 验收记录）；分支未合并属预期（一次性原型） |
| 02 base 预清理 + 最后一天文案 | manage 6be5500（packages/base） | styles.ts 已无 7px 内嵌圆角与内嵌描边 hairline 规则（现存 "padding:7px 4px" 是正常行内边距）；core/index.ts formatValidity 末日中文「该二维码今天（M 月 D 日前）有效，重新进入将更新」/ 英文 "Valid today (until M/D), refreshed on re-entry"；test/client/validity.test.ts 四个边界用例（含 "says today instead of zero days on the last valid day"）；本会话 vitest 通过 |
| 03 ActionCluster v2 + demo 样张 | manage 495c6b7（9 文件 +1314/−81） | cluster.ts（createActionCluster：items、size 14/16/18 默认 16、gap 4、variant quiet/tray、maxVisible 溢出）、cluster-icons.ts（三色渐变 SVG）、hover-tip.ts（共享气泡：body 挂载、离开延迟 160ms、同时只显示一个、Escape、aria-describedby、无包裹 span）、styles.ts 径向光晕 + prefers-reduced-motion、index.ts 导出 ui.ActionCluster / ui.clusterIcons、demo 五状态明暗样张；cluster.test.ts 覆盖 "renders one container with three independent coloured buttons, no wrapper"、"defaults the issue target to the issue list, not /issues/new"、尺寸/间距、legacy tray、共享气泡、溢出、英文文案、quiet 样式；本会话 typecheck / vitest / build / build:demo 全绿 |
| 04 base 0.1.2 构建与发布 | base 98054d9 / 24c8409 / ad84c86 / 97fe5d8（manage 仓 packages/base） | GitHub Actions publish-base.yml run 41198426062 成功，npm shasum db73b979…；jsDelivr 与 npmmirror 均可读到 0.1.2（本会话对 0.1.5 复核三通道同样 200） |
| 05 五仓升 0.1.2 打包 | prompt 6c0d8c0；deck b521ddf5；palette 1cfeffe + 0c47124；im 181e01f + cc1eda1；ilife f534348a | 五仓 package.json 依赖声明 0.1.2，tarball 在 D:/temp/hac2-pack/ 可安装；后续 0.1.3/0.1.4/0.1.5 换代覆盖（见票 07/08） |
| 06 web profile 人眼验收 + HUMAN-GATE | 五仓 0.1.2 安装后的 profile + HUMAN-GATE 记录 | 用户 2026-11-01 00:44 人眼验收原话「效果蛮好的，有你可以自行验证的你可以直接验证了。我目前看到的效果都满意」；CDP 矩阵记录（五页各 1 个 .dsh-base-cluster + 3 按钮、tooltip 文案、作者卡、弹窗三码）；票 14 已更新（进度 80%，B 通过，D/E 留 owner 真机） |
| 07 二维码兜底 0.1.3 | base eb8ee78；0.1.4 修正 4555f74；五仓 0.1.4：prompt f2669c4 / deck 3f1bca2f / palette bce5583 / im 0956a23 / ilife 8110a9fc | content.ts MANIFEST_TIMEOUT_MS=1500、CONTENT_IMAGE_TIMEOUT_MS=6000、MANIFEST_FAILURE_TTL_MS=60*1000（成功缓存 30min）；build-data.ts BUNDLED_PLATFORMS 含 wechat；baseline.ts 三平台（feishu/qq/wechat，含 wechat 卡）；content.test.ts 20 例含 "times out a hanging channel and moves on (1.5s window, no retries)"、"retries a failed fetch after the 60s failure window, not before"；0.1.4 QR box-sizing 修复；本会话复跑 0.1.5 同一代码路径通过 |
| 08 作者插件卡 HoverTip + 文案 + 0.1.5 | base 9ca64c6；五仓 0.1.5：prompt eabd828 / deck 61b557d4 / palette 3b01032 / im e7651a9 / ilife c7f0ea8 | hover-tip.ts（TIP_HIDE_DELAY=160、createTipController、Escape、aria-describedby）；texts.ts contactTip「扫码加入交流群，反馈、建议、idea 都欢迎🎉」/ issueTip「任何功能需求、故障、建议、意见都可以提ISSUE问题单🙏」（含英文）；plugins.ts rowTip 绑定 onMouseEnter/onFocus；plugins.test.ts 气泡用例；五仓产物 banner "dsh-featherhunter-plugin-base v0.1.5"；profile 重装后 CDP 复核（1 簇 92×28 + 3 按钮 28×28、tooltip、弹窗三卡 320×320 显示 215×215、13/13 padding、viewport 1000/900 无溢出、dark rgb(10,10,10)） |
| 09 web profile 改 npm 正式版 | deck beta.33（80788911 等）+ im 0.2.26（e947af7） | profile package.json / pnpm-lock.yaml 无 file: 依赖；安装版本 dsh-im-companion 0.2.26、dsh-life-pack 0.3.86、dsh-mattpocock-skills-deck 1.9.0-beta.33、dsh-opencode-palette 2.1.11、dsh-prompt 0.4.40；五个已安装 client bundle 内 banner 均为 v0.1.5；CDP 复验五页 1+3 簇、tooltip、弹窗三码 |

结论：规格 验收口径 5 条（base 三通道与 demo、票 07 二维码兜底、五仓门禁/banner/tarball/commit+push、票 08 气泡文案与 0.1.5、最终 owner 人眼验收 + 票 14 更新 + 收口）逐条有实现或测试证据；无「不做 / 重复」票需要用户追认。

## 二、变更在长线分支上（六仓，2026-11-01 12:56 复核）

| 仓 | 长线分支 | 当前 HEAD 与上游 | 交付提交是否在长线分支上 |
|---|---|---|---|
| featherhunter-plugin-manage | main | d4dd3fc == origin/main | 规格/票/收口记录直接提交 main（先例 0969bb1 同类收口） |
| dsh-prompt | main | f140852 == origin/main | eabd828 是 origin/main 祖先（git merge-base --is-ancestor 退出 0）；v0.4.40 已发布 |
| dsh-mattpocock-skills-deck | main | 本地 80788911；origin/main 已由另一会话推进到 84ca70b7（#1782，与本规格无关） | 61b557d4、80788911 均是 origin/main 祖先（退出 0）；npm 1.9.0-beta.33 已发布 |
| dsh-opencode-palette | main | 304bc6c == origin/main | 3b01032 是祖先；2.1.11 已发布 |
| dsh-im-companion | master | e947af7 == origin/master | e7651a9 是祖先；0.2.26 已发布 |
| ilife | master | 148770f2 == origin/master | c7f0ea8 是祖先；0.3.86 已发布 |

复核命令（任选其一可复跑）：`git merge-base --is-ancestor <交付提交> origin/<长线分支>; echo $?` 应为 0；`git log --oneline origin/<长线分支> | grep <交付提交>`；npm 版本用 `npm view <pkg>@<ver> version`（本机 npm registry TLS 受限，本次改用 npmmirror/jsDelivr HTTP 200 与 profile 安装版本核对）。

## 三、检查在注释所写提交上复跑（本会话结果，非记忆）

| 仓 / 提交 | 命令 | 结果 |
|---|---|---|
| manage @ d4dd3fc（packages/base 0.1.5） | `pnpm run typecheck` / `pnpm run test` / `pnpm run build` / `pnpm run build:demo` / `pnpm run data:check` | 全部退出 0；vitest：Test Files 27 passed \| 1 skipped (28)，Tests 347 passed \| 6 skipped (353)，16.66s（2026-11-01 13:00 在 manage d4dd3fc 复跑）；data:check "generated data is up to date" |
| dsh-mattpocock-skills-deck @ 80788911 | `npm run verify:parallel`（仓内 docs/agents/verification.md 规定的唯一判据） | 退出 0：520/520 步，wall 166.1s，主链真红 0 步，冒烟真红 0 步，冒烟 5/5 PASS；另 `readme:check` 退出 0。（初次 `npm run test` 报 client.js 产物缓存不一致，按文档 `node scripts/build.mts` 重建后 verify-leaves 全过——是构建缓存问题，非代码红） |
| dsh-opencode-palette @ 304bc6c | `npm run build` / `npm run test` / `npm run verify:artifacts` / `npm run readme:check` | 全部退出 0；312 用例通过；verify:artifacts 两次构建 sha256 逐字节一致（8 个产物、LF） |
| dsh-im-companion @ e947af7 | `npm run check` / `npm run readme:check` | 退出 0；guard 191 文件 ≤300 行 PASS，#170/#178 证明 PASS |
| dsh-prompt @ f140852 | `pnpm run build` / `typecheck` / `check` / `readme:check` / `test:star-history` / `test:issue-37` | build 0、typecheck 0、readme:check 0、test:star-history 17/17 通过、test:issue-37 "ALL PASS: #37"；`check` 退出 2 仅因 `check:update-pkg` 需联网（npm ECONNRESET，已登记的离线既有红），其余链内步骤（含 typecheck）均通过 |
| ilife @ 148770f2 | `pnpm run build` / `test:types` / `gen:check` / `publish:pre` / `boundaries` / `base:floor` / `doctor` / `readme:check` | 全部退出 0；publish:pre 离线跳过上游查证但 PASS；base:floor 15/15 |
| base 0.1.5 三通道 | npmmirror / jsDelivr HTTP GET | 均 200，version=0.1.5（npmmirror shasum 722b9678…） |
| web profile | 读 ~/.dsh/profiles/web/package.json + pnpm-lock.yaml + node_modules | 五个版本与 spec 发版记录一致，无 file: 依赖；五个已安装 client bundle banner 均为 v0.1.5 |

自检：以上检查跑在各仓 HEAD（manage d4dd3fc、prompt f140852、deck 80788911、palette 304bc6c、im e947af7、ilife 148770f2），与本记录第二节所写提交一致；本收口记录本身只改 manage 仓 .scratch 文档，不改代码。

## 四、遗留处理（逐条有落点）

1. 票 14（base-package-rollout）保持 open：B 组 owner 已确认，D 组定为临时验证（不发版）待 owner 授权在 desktop profile 安装验形态，E 组离线降级待 owner 真机；规格 遗留已记。责任人：用户真机；本规格关闭不阻塞票 14。
2. prompt `test:star-history` 既有红：已由 ae7c6b5 修复，本会话复跑 17/17 通过 → 已在规格 遗留回填「已修复」。
3. prompt `test:issue-89` 僵尸红、`check:update-pkg` 需联网：保持登记（本机 registry TLS 受限，发版走 GitHub Actions），未新增处理。
4. ilife `ci-gates-295`、`p10-boundaries`：保持登记；本会话 boundaries 门禁 0。
5. palette `check-deps` 离线 '?'：保持登记。
6. 新发现（本会话首次登记）：ilife 全量 `npm test` 有既有红——tooling/check-combos.mjs:20 的 /schema/i 命中 packages/base-combos/combos.yaml:282 "- key: calorie.data.schema"（"FAIL: 说明书禁业务表语义（命中 /schema/i），0 表红线"）。引入时间早于本规格（/schema/i 于 59d2cc44 2026-09-06，calorie.data.schema 于 645c048a 2026-09-25），本规格未改 tooling；ilife AGENTS.md:89 规定 pnpm test 全量只与主线基线比对、不单独拦路，故不影响本规格交付。建议 ilife 仓补登记到其 known-red 清单（下一步：用户/后续会话，非本规格阻塞）。
7. manage 未合并分支 prototype/header-action-cluster（9e1ac64、253b0ff、108b3c9 三个原型提交）：票 01 明确为一次性原型，保留不合并、不删除（删除需用户同意）；特此列出。
8. 各仓非本规格的既有未提交/未跟踪/工作树/分支：deck 15 个未跟踪 .scratch-*（他人在途）、im 2 个 docs/research 改动（10/25–10/31）、prompt 7 个未合并分支 + 2 个工作树、deck ~20 分支 / ~60 工作树 / 2 stash、im 10 分支 / 5 工作树、manage 未跟踪 .dsh-mattskillsdeck-cache/——均早于本规格且属其他会话，保持原状交其 owner。
9. 临时文件：D:/temp/hac2-pack/ 的 tarball 与 web profile 备份按规格记录保留为历史证据；manage .tmp/ 证据目录已被 .gitignore 忽略，未入库。

## 五、收口方式说明

- 工作区约定与先例：markdown 后端的 spec 容器不支持 deck_issue_patch 评论（工具报 map.md not-found，见 0969bb1 先例的同一说明），故收口评论按约定直接回填本 spec.md 正文，同时把头部 DSH-STATUS 改为 closed；这与用户在详情页点「完成」等效（本次由用户 2026-11-01 指令授权 agent 执行关闭）。
- 关闭不改变票 14 的 open 状态，也不回滚任何实现票。


## 进度

- 进度：100%（2026-11-01T13:10:00+08:00）：独立复核四项通过（规格承诺落地 / 长线分支 / 提交上检查复跑 / 遗留清零），规格关闭；收口评论见上一节。

