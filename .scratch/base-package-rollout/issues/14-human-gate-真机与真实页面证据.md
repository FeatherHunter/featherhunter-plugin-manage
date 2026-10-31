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
## HUMAN-GATE 准备就绪（代理侧）

自动侧已全部完成：票 08–13 关闭，五仓接入提交已推送到 GitHub 默认分支（prompt `944905c`、deck `42280a82`、palette `862a4c2`、im `76dd0f6`、ilife `d7cdda30`）。

本票需要仓主在真机/真实页面取得证据，核对清单已备好：`docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md`，含四组待确认项：
1. 真机扫码飞书/QQ/微信各一次（时间、群、结果；微信周更图的过期表现）
2. 真实浏览器 dialog（top layer、遮罩、Esc、焦点回归、深浅色、窄屏）
3. GitHub 四块观感（中英 README，逐仓）
4. 大陆网络三通道全失败时的内置基线降级

票保持 open；证据补齐、清单第 5 节结论填好后关闭。规格收口由仓主在规格详情页点「完成」按钮核对。

## 进度
