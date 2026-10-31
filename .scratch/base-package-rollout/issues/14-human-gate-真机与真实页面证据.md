<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 09, 10, 11, 12 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-d85fe86b-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:47:24.367Z -->
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

- 进度：75%（2026-11-01T00:51:36+08:00）：A/C 组代理实测补齐并写入 HUMAN-GATE §7；B/D/E 待仓主真机，票保持 open
- 进度：60%（2026-10-31T17:35:34+08:00）：新微信群码（validUntil 2026-11-07）已发布到 base 0.1.1 与五仓 README，deck GitHub 页面实测新卡渲染正常；B3 过期降级场景需仓主等 11-07 后再验
- 进度：50%（2026-10-31T15:26:09+08:00）：A 组 deck 页代理实测通过；剩余 B/C/D/E 待仓主取证，B3 缺新微信群码
- 进度：40%（2026-10-31T15:01:13+08:00）：场景化走查与参考渲染已就绪，等仓主真机/真实页面取证
