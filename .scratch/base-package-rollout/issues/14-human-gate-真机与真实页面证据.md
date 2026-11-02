<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 09, 10, 11, 12 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-d85fe86b-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:47:24.367Z -->
<!-- DSH-ASSIGNEES: lead -->
# 14: HUMAN-GATE 真机与真实页面证据

**What to build:** 五仓真实页面与真机证据汇总（由仓主执行、代理不自判）：真机扫码飞书/QQ/微信各一次、真实浏览器 dialog top layer 与焦点回归、GitHub 上四块观感、大陆网络三通道全失败降级。

**Blocked by:** 09, 10, 11, 12

**Status:** ready-for-agent

- [ ] 真机扫码三项各留一次证据（时间、群、结果）
- [ ] 真实浏览器 dialog 行为证据（top layer、遮罩、Esc、焦点回归、深浅色）
- [ ] GitHub 四块观感证据（截图或链接）
- [ ] 大陆网络降级证据（三通道全失败时回退内置基线）
- [ ] 结论记录到 docs/，未确认项明确标为待确认

## Comments

### local — 2026-10-31T06:10:57.979Z

### local — 2026-10-31T07:01:13.501Z
已把「照着做」的场景化走查补进 docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md §6（commit 3b8796b，已推送）：
- A GitHub 页面观感（中/英 README 四块）
- B 真机扫码（飞书永久 / QQ 新群 / 微信——validUntil=2026-10-30 已过期，当前只能验「过期降级」，真验需新群码）
- C 真实浏览器 dialog 机制（demo 页 file:// 可跑，含 top layer / Esc / 遮罩 / 焦点回归 / 响应式列数 / 深浅色 / 语言 / 离线基线 / 推荐卡）
- D 插件真实页面入口（需先装本次五仓构建产物，当前 profile 是旧发布版）
- E 大陆网络降级
另用无头 Chrome 生成了预期渲染参考图（非仓主证据）。票保持 open，等仓主按清单取证。

### local — 2026-10-31T07:26:09.786Z
场景清单已细化到 A/B/C/D/E 共 40 项（清单文档 docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md §6）。

代理侧新增实测：deck 仓 GitHub 页面已用 headless Chrome 整页截图核对——CONNECT 三张 0.0.2 CDN 卡、Star History（264 stars · 2026-10-30，双轴）、THANKS 表、MORE 四条均正常渲染，无破图/错位/alt 外露；星图外层 Pages 链接 HTTP 200。A 组其余四仓仍可由代理补截图代验。

仍需仓主取证：B（真机扫码，B3 依赖新微信群码）、C（真实浏览器 dialog，零安装可做）、D（插件真实页面入口，需先装本次构建产物并重启）、E（大陆网络降级）。

已向仓主列出剩余场景与前置依赖。

### local — 2026-10-31T09:35:35.118Z
2026-10-31 追加证据（票 15 换码后）：
1) 微信群二维码已换发为 2026-10-31 版（validUntil 2026-11-07），base 包 0.1.1 与五仓 README 均指向新卡；CDN 实测 jsDelivr/unpkg 200（card-wechat-2026-10-31.png 21010B），deck GitHub README 页面 headless 截图核对：三列联系区正常渲染，微信群卡为深色卡面、二维码白底可扫、图内文字『该二维码7天内（11月7日前）有效』。
2) 五仓已升 base 0.1.1 并接入页头三件套（联系/Star/Issue），commit：prompt f7229e5+685cb7b、deck 91db8fcf、palette 28f215b、im aa36b20、ilife a1d108a7，均已 push；doctor/readme:check 聚合 exit 0。
3) 仍需仓主真机：B1/B2 扫码进群（飞书/QQ/微信新码）、B3 弹窗过期降级（旧码 10-30 已过期可验）、C 组浏览器 dialog 9 项、D 组安装本次构建产物后 5 仓入口、E 组断网三通道降级。B 组建议手机打开 unpkg 直链长按识别：https://unpkg.com/dsh-featherhunter-plugin-base@0.1.1/data/img/card-wechat-2026-10-31.png

### local — 2026-10-31T16:51:36.866Z

### local — 2026-10-31T16:58:29.693Z
2026-11-01 00:58 B 组复验结论：owner 口头确认「B 组没问题」→ 手机扫码三码（飞书/QQ/微信）真机可通过；微信码 2026-10-31 换新（validUntil=2026-11-07），过期表现一行改判为「已不适用」（0.1.3 起微信内置基线码，0.1.5 弹窗三卡均为 data:image/png 内联码）。证据落在 docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md §1 表与 §7.2。

D 组定性（回答 owner 提问「d 组是临时验证还是要发版本？」）：D 组是**临时验证，不需要发版本**。装进 desktop profile 的是本次本地构建的 tarball（file: 依赖），五个包的版本号不变（prompt 0.4.39 / deck 1.9.0-beta.33 / palette 2.1.10 / im 0.2.25 / life-pack 0.3.85），验证完可按备份回滚；正式发版（npm publish 各仓新版）是独立的一件事，等 owner 决定再做。注意 desktop profile 正是当前 DSH Desktop 会话所在 profile，安装后需重启桌面应用，须 owner 授权/操作。剩余：D（desktop 安装形态，待授权）、E（断网降级）。

### local — 2026-11-01T04:35:40.966Z
2026-11-01 12:40 更新：五仓已全部发 npm 正式版（prompt 0.4.40 / deck 1.9.0-beta.33 / palette 2.1.11 / im 0.2.26 / ilife 0.3.86），web profile 已从本地 tarball 切到 npm 精确版本并在真机复验通过（五设置页版本与 UI、作者插件卡 tooltip、联系弹窗三卡二维码居中；见规格 .scratch/header-action-cluster-v2/spec.md「收口记录：web profile 依赖切到 npm 正式版」与票 09）。B 组 owner 已确认通过；剩余 C4 更窄档、C6 中英切换，以及 D 组 desktop profile 安装形态（现可直接用 npm 正式版安装，需重启桌面应用）与 E 组断网降级。

### local — 2026-11-01T06:12:01.118Z
2026-11-01 14:0x 自动化取证回填（依据 owner「你能自动化测试的 可以直接测试」）：
1) C4 窄档列数 PASS：demo 与 web profile 两处 1200/600/420 三档列数 3/2/1，420px 档卡宽 338、弹窗 386×880/792，docScrollWidth==viewportWidth，grid/dialog 横向溢出 0，无越界元素；二维码 natural 320×320 未破图。截图 .tmp/hg-c4-*.png、hg-web-*.png。
2) C6 中英切换 PASS（demo）：按钮/aria/插件卡标题/弹窗标题与欢迎语/scanHint/close/卡片标题副标题 note 全量切换，含 wechat「Valid for 6 days (until 11/7)…」，切回中文全部复原。截图 .tmp/hg-c6-en-modal.png / hg-c6-zh-modal.png。
3) E1 断 CDN PASS：Network.setBlockedURLs 阻断 unpkg/jsdelivr/npmmirror/github 后 reload，页面正常、弹窗可开，三通道清单 fetch 全 TypeError→内置基线，3 卡内置真码正常渲染，errText=[]、errs=[]、无白屏无错误框。截图 .tmp/hg-e1-blocked2.png。
4) E2 合成降级清单 PASS：拦截 unpkg 返回自造 manifest（feishu 远程图/wechat 远程图+validUntil 2026-10-30/telegram 远程图无内置码）+ 阻断 jsdelivr+npmmirror，结果 feishu 回退内置 qr-feishu 320×320、wechat card--expired+expired 文案+fallbackUrl link、telegram 无码降级 link，全程 errs=[]、gridOverflow=0、不弹错不白屏。截图 .tmp/hg-e2-degraded2.png。
5) E3 恢复回源 PASS：unblock+reload 后 unpkg manifest 200（992ms），随后 jsdelivr 远程图 qr-feishu/qr-wechat-2026-10-31/qr-qq 全 200（1575–1657ms），弹窗 img 320×320/true——证明远程清单被采用并预取远程图。截图 .tmp/hg-e3-restored2.png。
证据已写入 docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md §7.6，并把 §7.2 的 C4/C6/E 标为代理已自动化覆盖。
剩余待 owner：C4/C6 主观观感一眼、D 组 desktop profile 安装形态（需授权装五仓 npm 正式版并重启桌面应用）；B 组 owner 已确认。票保持 open。

### local — 2026-11-01T07:43:18.579Z
owner 观感反馈（2026-11-01）：联系弹窗三张卡标题都是「DSH 插件交流群」，owner 追问能否在名字前加各渠道（飞书 / QQ / 微信）的官方 LOGO，好让三张卡一眼区分。

已备讨论稿（三种做法：单色品牌标 16px / 彩色徽章 18px / 品牌色文字 chip；另附中英双语对照），截图见会话。技术面结论：改动点很小——`packages/base/src/client/modal.ts` 的 `buildCard()` 里 `cardTitle.textContent = pickText(group.title, lang)` 一行，内联 SVG 即可，不需要动 data/CDN。但落地需要 base 发包 + 五仓换钉，且会改动 C4/C6 的观感证据，需重跑 human gate。待 owner 拍板方案与时机后，另开票实施。

### local — 2026-11-01T08:15:49.827Z
2026-11-01 补充（渠道徽标已落地，本票观感证据需重做）：
- 联系弹窗群卡已改为「18px 彩色渠道官方徽章 + 群名」，微信卡重复副标题已删，来源为票 .scratch/contact-channel-badges/issues/01（提交 94bbace）。
- 因此本票 C4「联系弹窗群卡观感」与 C6 相关的整卡观感截图/判定仍停留在旧版（三张同形卡片），证据已作废，需按新弹窗重做后再闭环。真机/真实页面其余检查项不受影响。
- 本票保持 open，等 owner 重验观感与 D 组 desktop 安装授权。

### local — 2026-11-01T08:46:48.879Z
2026-11-01 16:4x D 组收口：owner 已在 DSH Desktop 内把五仓装/更到 npm 正式版并重启桌面应用（prompt 0.4.40 / deck 1.9.0-beta.33 / palette 2.1.11 / im 0.2.26 / life-pack 0.3.86），16:42 反馈「现在都重启了，暂时没看到什么问题」。代理核验 desktop profile：五仓 declared=actual、node_modules 全部真实目录无 Junction；市场日志显示 deck 按 registry latest 重装并 hot=true 激活；im-companion 官方包运行日志持续活跃。D 组安装形态通过，证据见 docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md §7.7。剩余仅 C4/C6 主观观感待 owner 一眼，确认后即可关票。

### local — 2026-11-01T09:01:11.511Z
补记（2026-11-01 16:5x）：上一条「剩余仅 C4/C6 主观观感待 owner 一眼」需按 16:15 注修正——`94bbace` 渠道徽标改动后，C4/C6 的整卡观感证据作废，需按新弹窗重验（不是看一眼旧证据）。D 组安装形态结论不受影响。重验载体待定：① base 仓本地构建 demo 页重验（不依赖发版）；② 等新 base 版本发布 + 五仓换钉后在真实插件页重验（需先开后续发布票）。

### local — 2026-11-02T06:04:15.958Z
【上游状态更新 2026-11-02 14:03】base 已发布 0.1.7（含真机验证能力完整实现与审计修复）；五仓工作树已把 devDependencies 钉精确 0.1.7 并真实安装、重建产物、self-check 全绿（matt 另跑通 84 门禁 / 9,094 断言全绿）。
仍未满足本票「真实页面证据」的部分：五仓已发布的插件版本仍是内联 base 0.1.5 的旧构建，工作树改动未提交、未发插件新版本；im-companion 无有效 .git 需先恢复仓库。等插件新版本发布后，本票的真机与真实页面复验才具备可复现提交。
## 2026-11-01 00:55 0.1.5 轮：A/C 组代理实测补齐，B/D/E 仍待仓主

- 规格 `.scratch/header-action-cluster-v2` 的票 01–08 已全部关闭；base 已发到 0.1.5，五仓换代（HEAD==origin，依赖精确 0.1.5）并装入 web profile，owner 2026-11-01 00:44 人眼验收通过。
- 代理本轮补齐（web profile 0.1.5 真机 CDP）：五设置分区 cluster/按钮/aria/落点/气泡文案矩阵；作者插件卡 4 行悬停出完整介绍词 tooltip；联系弹窗三卡内联码、左右留白 13/13px、Esc 焦点回位、Tab 困焦、深色模式、viewport 1000/900 无溢出；base demo 0.1.5 五状态 computed 值（默认/hover/active/focus/disabled）。
- 已写入 `docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md` 新增「§7 2026-11-01 更新：0.1.5 收口状态」：7.1 代理已实测（可作证据）/ 7.2 待仓主亲验（B 手机扫码、C4 420px 档、C6 中英切换、D desktop profile 安装形态、E 断网降级）/ 7.3 旧条目过期说明（§0 版本、D1–D5 底部联系入口形态已被 owner 拍板取代、B3 微信过期已换新）。
- 本票保持 open，等 B/D/E 真机证据；规格 `header-action-cluster-v2` 收口由 owner 在详情页点「完成」。
## HUMAN-GATE 准备就绪（代理侧）

自动侧已全部完成：票 08–13 关闭，五仓接入提交已推送到 GitHub 默认分支（prompt `944905c`、deck `42280a82`、palette `862a4c2`、im `76dd0f6`、ilife `d7cdda30`）。

本票需要仓主在真机/真实页面取得证据，核对清单已备好：`docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md`，含四组待确认项：
1. 真机扫码飞书/QQ/微信各一次（时间、群、结果；微信周更图的过期表现）
2. 真实浏览器 dialog（top layer、遮罩、Esc、焦点回归、深浅色、窄屏）
3. GitHub 四块观感（中英 README，逐仓）
4. 大陆网络三通道全失败时的内置基线降级

票保持 open；证据补齐、清单第 5 节结论填好后关闭。规格收口由仓主在规格详情页点「完成」按钮核对。

## 进度

- 进度：90%（2026-11-01T17:01:11+08:00）：C4/C6 证据因渠道徽标 94bbace 作废待重验；D 组安装形态已通过
- 进度：95%（2026-11-01T16:46:48+08:00）：D 组 desktop 安装形态已由 owner 完成并核验；仅剩 C4/C6 主观观感待 owner 一眼
- 进度：92%（2026-11-01T14:12:00+08:00）：C4/C6/E 自动化实测全部 PASS 并回填 HUMAN-GATE §7.6；剩 owner 观感与 D 组 desktop 安装授权
- 进度：85%（2026-11-01T12:35:40+08:00）：五仓 npm 正式版齐发，web profile 已切 npm 并真机复验；剩 C4/C6/D/E 待 owner
- 进度：80%（2026-11-01T00:58:29+08:00）：B 组 owner 确认通过；D 组定性为临时验证（不发版），待 owner 授权在 desktop profile 安装验形态；剩 D/E
- 进度：75%（2026-11-01T00:51:36+08:00）：A/C 组代理实测补齐并写入 HUMAN-GATE §7；B/D/E 待仓主真机，票保持 open
- 进度：60%（2026-10-31T17:35:34+08:00）：新微信群码（validUntil 2026-11-07）已发布到 base 0.1.1 与五仓 README，deck GitHub 页面实测新卡渲染正常；B3 过期降级场景需仓主等 11-07 后再验
- 进度：50%（2026-10-31T15:26:09+08:00）：A 组 deck 页代理实测通过；剩余 B/C/D/E 待仓主取证，B3 缺新微信群码
- 进度：40%（2026-10-31T15:01:13+08:00）：场景化走查与参考渲染已就绪，等仓主真机/真实页面取证
