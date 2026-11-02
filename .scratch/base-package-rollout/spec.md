<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 五仓接入 base 包（rollout） -->
<!-- DSH-STATUS: closed -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-92d99e0d-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:46:07.969Z -->
# 五仓接入 base 包（rollout）


## 目的
把已交付并合入 main 的 base 包（规格见 `.scratch/base-package/spec.md`，规格票 00 已关闭）接入另外五个插件仓：dsh-prompt、dsh-mattpocock-skills-deck、dsh-opencode-palette、dsh-im-companion、ilife，并完成整体自动验收与 HUMAN-GATE 真机证据。
## 背景
- base 包 `dsh-featherhunter-plugin-base` 0.0.1 已发布；0.0.2 已构建出 tarball（含 `--repo` 单仓同步、Markdown 星图/联系标题变体、`markdownImage`、数据文件派生星图版本），因 npm registry 网络阻断暂未发布。
- 五仓接入只改各仓自己的文件：依赖钉精确版本、设置面板改用 base 的 ContactRow/AuthorPlugins、README 四块用 base 的 readme:init/sync 迁移、旧手写实现删除、已有 workflow 挂 readme:sync（不新增 workflow）。
- base 仓本身（`packages/base/**`）不在本规格范围；发现 base 缺陷回到 base 仓修复并补测试。
## 范围与顺序
1. 票 08 dsh-prompt 仓接入并全部测通（先行，其余四仓等它全绿）
2. 票 09 deck / 10 palette（mini-bundler 风险）/ 11 im-companion / 12 ilife
3. 票 13 五仓接入整体自动验收
4. 票 14 HUMAN-GATE 真机与真实页面证据
## 验收口径
- 每仓：`npm run check`（或该仓等价门禁）全绿；`readme:check` 退出 0；依赖声明为 base 精确版本；仓内不存在第二套写 README 的路径；不新增 workflow 文件。
- 整体：五仓各提交一次接入改动、README 四块内容等价、base 版本一致；base 仓测试仍全绿。
- HUMAN-GATE：真机扫飞书/QQ/微信各一次、真实浏览器 dialog 顶层与焦点回归、GitHub 上四块观感、至少一仓真实构建链吃下产物（palette 最高风险）、中国大陆网络三通道全失败降级，由仓主确认。
## 当前状态
- 票 08–15 已全部关闭（01–07 是规格容器建立前的重复票，已按重复关闭）；五仓已全部接入 base 并统一钉 `dsh-featherhunter-plugin-base: "0.1.7"`（2026-11-02 提交并推送，五仓 HEAD==origin）；五仓当前已发 npm 版本：prompt `0.4.40`、deck `1.9.0-beta.33`、palette `2.1.12`（web/desktop profile 仍为 2.1.11）、im-companion `0.2.26`、ilife `0.3.86`（这些发布版本内部仍内联 base 0.1.5；五仓工作树已含 0.1.7 的渠道徽标弹窗，待下一轮发版生效）。web profile 保持 npm 精确版本（§7.5）。
- 票 14 HUMAN-GATE 已于 2026-11-03 01:5x 关闭（进度 100%）：B 组 owner 已确认；D 组 desktop profile 安装形态由 owner 2026-11-01 15:27 完成、16:42 反馈无问题，代理核验通过（核对清单 §7.7）；E1–E3 断网降级代理实测 PASS（§7.6）；C4/C6 新弹窗（18px 渠道徽标）按票内 Option ① 用 base 0.1.8 本地 demo 重验 PASS（§7.8，截图 `.tmp/hg-018-*.png`）。
- **C4/C6 状态（2026-11-01 16:14 作废 → 2026-11-03 重验）**：base 仓 `94bbace` 渠道徽标改动后旧证据作废；本轮按 Option ① 用 base 0.1.8 本地 demo 重验 PASS（三档列数/无溢出、徽标 18×18+SVG+品牌色、中英全量切换），详见核对清单 §7.8。
- 票 14 与规格票 00 均已关闭：规格收尾评论与状态经 `deck_issue_patch({key:"00", feature:"base-package-rollout", ...})` 写回（`## Comments` + `closed` + 进度 100%，2026-11-03 02:47），详见文末「收口记录（规格关闭，2026-11-03）」；规格详情页的「完成」按钮由仓主核对后点击（不是自动关闭）。
## 票号说明
最早建的 01–07 是在本规格容器存在之前以普通 issue 建的，挂不到规格下；已按规格体系重建为 08–14（kind=spec-ticket、父票 00、依赖边齐全），01–07 已作为重复票关闭；15 是 2026-10-31 追加需求票（页头三件套 + 微信群码换发），同样挂在父票 00 下。
## 验收记录（票 13 回填，2026-10-31 14:10 +08:00）
- 五仓自动验收全部通过：聚合 `readme:sync --check --all --repos D:\dsh-plugin` exit 0（11 份 README up to date）、`doctor --repos D:\dsh-plugin` exit 0 全绿；五仓构建/测试通过（prompt check+build、deck verify-parallel 459/459、palette build+312 tests、im check 595、ilife tsc -b+build+97 定向测试）；git 对比确认未新增 workflow 文件；base 仓 typecheck + vitest（314 pass）全绿。
- 证据与逐仓明细：`docs/五仓接入-base-0.0.2-验收记录.md`。
- 五仓接入提交（本地提交，尚未推送）：dsh-prompt `944905c`、deck `42280a82`、palette `862a4c2`、im-companion `76dd0f6`、ilife `d7cdda30`。
- 票 08–13 已全部关闭；票 14 HUMAN-GATE 待仓主真机/真实页面证据（扫码三群、浏览器内 dialog 顶层与焦点、GitHub 观感、大陆网络三通道降级）。
- 注（2026-11-03 更正）：此前误记「markdown 后端的 spec 容器不支持 deck_issue_patch 评论」；实为 `deck_issue_patch` 作用在 spec 容器时需传 `feature:`（传 `effort:` 会按探索地图解析并报 `map.md not-found`）。本规格的收尾评论与关闭已按正确参数经 `deck_issue_patch` 写回 `## Comments` 与状态行。
## 验收记录（票 15 回填，2026-10-31 17:55 +08:00）
- 追加需求（用户 2026-10-31 提出）：页头三件套（联系 / Star / Issue）+ 三项合一控件 + 公共 HoverTip；微信群二维码换发（旧码 10-30 到期）。
- base 包：新增 ActionButtons / ActionGroup / HoverTip / StarButton / IssueButton / ContactButton，中英文案与图标单测；全量 vitest 322 pass；typecheck/build 绿；版本 `0.1.1` 发布 npm（`--tag latest`；0.1.0 因 data/manifest.json 版本未随 bump 更新已 deprecate）。
- 发布通道核验：jsDelivr / unpkg / npmmirror 均能读到 0.1.1 与 `data/img/card-wechat-2026-10-31.png`（21010B）；npmmirror dist-tags latest=0.1.1。
- 五仓接入（均只改本仓文件、构建+测试通过、已 push）：
  - dsh-prompt `f7229e5`（页头三件套）+ `685cb7b`（README 同步）
  - dsh-mattpocock-skills-deck `91db8fcf`（派生重建 baseClient v0.1.1 + 页头 ActionGroup + README 致谢表补 3 行）
  - dsh-opencode-palette `28f215b`（页头 ActionGroup + 类型垫片 + 312 测全过）
  - dsh-im-companion `aa36b20`（页头 mountHeaderActions 挂 ActionGroup，保留自绘作者插件卡）
  - ilife `a1d108a7`（根+plugin-manager 双依赖升级，PanelActions → ActionGroup，保留手册入口）
- 聚合校验：`readme:sync --check --all --repos D:\dsh-plugin` exit 0；`doctor --repos D:\dsh-plugin` exit 0（依赖钉 0.1.1、内联 bundle 版本 0.1.1、README 图片 @0.1.1）。
- README 与页面：11 份 README 联系区全部指向 2026-10-31 新微信群码；deck GitHub README headless 截图核对：三列联系区正常、微信群卡深色卡面二维码可扫、图内文字“该二维码7天内（11月7日前）有效”。
- 剩余：票 14 HUMAN-GATE 仍需仓主真机证据（B1/B2 扫码进群、B3 弹窗过期降级、C 组 dialog 行为、D 组装产物后入口、E 组断网降级）；票 14 关闭后由用户在规格详情页点“完成”收口。
## 验收记录（票 14 自动化取证回填，2026-11-01 14:12 +08:00）
- 依据 owner 2026-11-01 指示「你能自动化测试的 可以直接测试」，代理用无头 Chrome（CDP 9333）在真实页面补齐 C4/C6/E 组：
  - C4 窄档列数 PASS：demo 与 web profile 两处 1200/600/420 → 3/2/1 列，420px 档无横向溢出、无越界元素、二维码 320×320 未破图。
  - C6 中英切换 PASS（demo）：按钮/aria/插件卡标题/弹窗全量文案切换并可复原（含 wechat「Valid for 6 days (until 11/7)…」）。
  - E1 断 CDN PASS：阻断 unpkg/jsdelivr/npmmirror/github 后三通道 fetch 全失败 → 内置基线 3 卡真码正常渲染，无白屏/错误框。
  - E2 合成降级清单 PASS：远程图失败回退内置码、过期卡降级 fallbackUrl link、无内置码降级 link，三链路均不弹错不白屏。
  - E3 恢复回源 PASS：unpkg 清单 200（992ms）+ jsdelivr 远程图 3 张全 200（1575–1657ms），弹窗 img 320×320/true。
- 证据（结论、截图、plan/日志路径、复跑命令）写入 `docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md` §7.6，§7.2 中 C4/C6/E 已标为代理自动化覆盖；票 14 回填评论 + 进度 92%。
- 仍待 owner：C4/C6 主观观感、D 组 desktop profile 安装形态（授权 + 重启桌面应用）；票 14 保持 open。
## 验收记录（票 14 D 组回填，2026-11-01 16:5x +08:00）
- owner 2026-11-01 15:27 前后在 DSH Desktop 把五仓装/更到 npm 正式版并重启桌面应用；16:42 反馈「现在都重启了，暂时没看到什么问题」。
- 代理核验 desktop profile：dsh-prompt 0.4.40 / deck 1.9.0-beta.33 / palette 2.1.11 / im-companion 0.2.26 / life-pack 0.3.86，declared=actual、node_modules 全部真实目录无 Junction；市场日志 deck 按 registry latest 重装并 hot=true 激活；im-companion 官方包运行日志活跃。
- 附带修复：desktop 的 dsh-im-companion 原为 Junction 指向本地仓导致 pnpm ERR_PNPM_EPERM，15:18 改为 registry 0.2.26（真实目录，integrity 与 npm 一致，备份 .tmp-backup-im-official-20261101-1518）。
- 证据：docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md §7.7；票 14 评论 + 进度 95%。
## 状态修订（2026-11-01 16:14 渠道徽标改动后）
- **改动来源**：2026-11-01 16:14 base 仓提交 `94bbace`（来源 `.scratch/contact-channel-badges/issues/01`，已 resolved）：联系弹窗群卡改为「18px 彩色渠道官方徽章 + 群名」，微信卡重复副标题删除；该票自测 typecheck / test 354 passed / data:check / build 全绿。
- **影响 1（C4/C6 证据作废）**：票 14 的 C4/C6 整卡观感截图与判定停留在旧版（三张同形卡片），**C4/C6 观感证据作废**，需按新弹窗重做（票 14 已于 2026-11-01 16:15 记录）；E1–E3 断网降级、A/B/D 组其余检查不受影响。
- **影响 2（新版弹窗未发版）**：`94bbace` 未发版——`packages/base/package.json` 仍为 `0.1.5`，五仓仍钉已发布的 `0.1.5`（不含徽标）；contact-channel-badges 票 01 明确「五仓换钉与发版由发布/后续票跟进」，当前尚无后续票。C4/C6 重验载体二选一：① 用 base 仓本地构建的 demo 页重验（新弹窗可渲染，不依赖发版）；② 等新 base 版本发布 + 五仓换钉后在真实插件页重验（需新的版本轮次与发布票）。
- **影响 3（D 组范围）**：D 组安装形态已于 15:27 通过，但装的是 npm 0.1.5（旧弹窗）；新弹窗发版后观感需再看一眼，安装形态本身不受影响。
- **影响 4（提交未推送）**：manage 仓 `127a487`（票 14 证据回填）、`94bbace`（渠道徽标）、`f3fdeb5`（票 01 收口）3 个提交尚未推送，origin/main 仍为 `d6355a7`；收口复核的「变更在长线分支上」项需先 push（后续已推送）。
## 收口记录（票 14 关闭，2026-11-03 01:5x +08:00）
- **五仓集成状态**：票 08–13 全部关闭；五仓 devDependencies 统一钉 `dsh-featherhunter-plugin-base: "0.1.7"`，node_modules 实际安装 0.1.7，各仓 `npm run readme:check` exit 0，HEAD==upstream（已推送）。0.1.7 接入提交：prompt `5b3a402`、palette `b1d1243`、im-companion `f4c38eb`（master）、ilife `59d32ae4`（master），deck 被其它工作推进到 `f70be720`；相关提交只改 README / `.github/workflows` 版本行，未新增 workflow 文件。
- **base 版本**：base 已发布 0.1.8（npm latest），五仓仍钉 0.1.7（已含渠道徽标提交 `94bbace`）。用本仓本地 0.1.8 CLI 跑聚合 `doctor --repos D:\dsh-plugin --offline` 会报 16 项 fail（各仓 readme-blocks / readme-images @0.1.7 期望 @0.1.8、dependency-version 期望 0.1.8、deck inline-bundle 期望 v0.1.8），属版本轮次差、不是五仓门禁回归；五仓按自身 0.1.7 门禁全绿。换钉 0.1.8 与发五仓新版本属后续独立动作。
- **票 14 重验**：C4/C6 新弹窗（18px 彩色渠道徽标 + 群名）按票内 Option ① 用 base 0.1.8 本地 demo 重验 PASS（1200/600/420 → 3/2/1 列、无横向溢出与越界元素；徽标 3 枚 18×18 + SVG + feishu/qq/wechat 品牌色；中英全量切换并可复原）；证据与截图路径见 `docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md` §7.8。
- **收口动作**：票 14 已关闭（进度 100%）；核对清单 §5 已填代理侧结论（2026-11-03 行）；请仓主在规格详情页点「完成」按钮做最终收口核对。
- **遗留（不阻塞本规格）**：五仓已发布 npm 版本仍内联 base 0.1.5 旧弹窗，新徽标弹窗要等五仓下一轮发版才在真实插件页可见；是否同轮换钉 0.1.8 由后续发布票决定。

## 收口记录（规格关闭，2026-11-03 02:47 +08:00）
- **关闭动作**：实施票 08–15 全关后，按本工作区收口协议用 `deck_issue_patch({key:"00", feature:"base-package-rollout", comment, progress:{percent:100}, close:true})` 一次写入收尾评论、进度 100% 与关闭；本文件 `## Comments` 与 `## 进度` 由工具写回，状态 `closed`。
- **收尾评论要点**：逐票核对 01–15（08–15 附文件/测试/命令证据）、验收口径逐条证据、本会话检查命令与结果（base gate 5/5；五仓聚合 readme:sync --check --all 与 doctor --offline exit 0；五仓 HEAD==upstream）、交付证明（manage `5f59f21` + 五仓提交 + base `83e2b0a`）、遗留处置（新票 16）、关闭前自检。
- **关闭后补充**：规格关闭写回的文件改动（收尾评论、状态 closed、进度 100%、本节）已单独提交 `ad35aab` 并推送 `origin/main`；补充条目见 `## Comments` 末尾。
- **遗留（不阻塞）**：新票 16 承接五仓换钉 base 0.1.8、五仓发版与真实插件页 C4/C6 复验；已发布 npm 版本仍内联 0.1.5 旧弹窗。
## Comments
### local — 2026-11-02T18:47:34.852Z
按本工作区收口协议：实施票全关是触发条件；本评论逐条给出验证证据、交付证明、检查命令与遗留处置，并与关闭同一次调用写入。

### local — 2026-11-02T18:49:59.950Z
关闭后补充（2026-11-03T02:5x+08:00）：规格关闭写回的文件改动已单独提交 `ad35aab`（仅 `.scratch/base-package-rollout/spec.md`：收口评论、状态 closed、进度 100%、收口记录），已推送 `origin/main`。此前两笔 spec 相关提交 `5f59f21`（状态修订 + 新票 16）与 `4646fb0`（§7.8 徽标证据）亦已在 origin/main。

## 一、逐票核对（01–07 为重复票；08–15 为实施票，均已关闭）
- 00 本规格：五仓接入 + 整体验收 + HUMAN-GATE；子票 08–15 全部 closed（本会话 `deck_issue_list({state:"all", type:"all", feature:"base-package-rollout"})` 16 行核验）。
- 01–07：规格容器建立前建的普通 issue，已按重复票关闭，不承载实施证据（见 spec.md「票号说明」）。
- 08 dsh-prompt：查 `lib/client.js`（createBaseUI / ContactRow / AuthorPlugins / ActionGroup 命中）、`settings-links.ts`（删 MORE_PLUGINS / PluginRow）、README.md + docs/README.en.md（四块托管）；提交 `944905c` 已推送；票面记录 `npm run check` exit 0、`readme:sync --check` 两 README up to date；GitHub Check run 41168116795 attempt4 全绿。
- 09 deck：查 `scripts/generated/baseClient.derived.js:6`（`/*! dsh-featherhunter-plugin-base v0.1.7 */` 且含 ActionGroup）、`package/lib/client.js`；提交 `42280a82`（25 files +1698/−133，索引清理后只含本票路径）已推送；票面记录 `scripts/build.mts`、`readme:check`（3 份）、`base doctor .` 10 项 ok、typecheck 与定向门禁全绿（verify-settings-debug 并发抖动单跑 204/0）。
- 10 palette：查 `runtime/client.ts:15`（import createBaseUI / ensureBaseStyles）、`:95`（页头三件套注释）、`:1726`（联系入口收进 ActionCluster）；提交 `862a4c2`（21 files +365/−299）已推送；票面记录 typecheck / build（1,694,055 B，无重复 React）/ readme:check / doctor / 312 tests 全绿。
- 11 im-companion：查 `src/client/base-ui.ts:11,28`（createBaseUI 桥）；提交 `76dd0f6d`（master，20 files +231/−165）已推送；票面记录 `npm run check` 595 pass / 0 fail、readme:check 2 份、doctor 全绿；偏离已记录：仓内无自绘联系弹窗（connect-flow 是 provisioning 流程，保留），handover 01 §6 与事实不符。
- 12 ilife：查 `packages/plugin-manager/src/base-ui.ts:51`（AuthorPlugins）、`src/client.ts:24`（ActionCluster）；提交 `d7cdda30`（master，25 files +1554/−177）已推送；票面记录 typecheck / build / readme:check / star / thanks / boundaries / base:floor / doctor 全绿、定向 97 pass / 0 fail；全量套件为既有环境性红（基线 130 条），无新增失败。
- 13 整体自动验收：查 `docs/五仓接入-base-0.0.2-验收记录.md`（0.0.2 轮次：聚合 readme:sync --check --all exit 0 覆盖 11 份 README、doctor --repos exit 0、五仓 build/test、workflow 计数不变、base vitest 314 pass）；本会话用五仓已装 0.1.7 CLI 复跑聚合（见 §三）。
- 14 HUMAN-GATE：查 `docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md` §5 / §7.6 / §7.7 / §7.8；B 组 owner 2026-11-01 确认；D 组 desktop 安装形态 owner 11-01 15:27 完成、16:42 反馈无问题；E1–E3 断网降级 §7.6；C4/C6 因 base `94bbace` 徽标改动作废后按 Option ① 用 base 0.1.8 本地 demo 重验 PASS（§7.8：三档 3/2/1 列、无横向溢出与越界元素、badge 18×18 + SVG + 品牌色、中英全量切换；截图 `.tmp/hg-018-*.png`）。边界：载体为 demo，已发布插件仍内联 0.1.5，真实插件页复验转票 16。
- 15 页头三件套 + 群码：查五仓 README 均含 `card-wechat-2026-10-31`、base 资产 `packages/base/data/img/card-wechat-2026-10-31.png`（21010 B）与 `qr-wechat-2026-10-31.png`（13116 B）；五仓提交 f7229e5+685cb7b、91db8fcf、28f215b、aa36b20、a1d108a7；票面记录 npm 0.1.1 三通道可读、deck 页面与 CDN 新卡实测通过。

## 二、验收口径逐条证据（spec.md「验收口径」）
1. 每仓 check 全绿 + readme:check exit 0 + base 精确版本 + 无第二套 README 写路径 + 不新增 workflow：票 08–12 逐仓记录（见 §一）＋本会话五仓 `npm run readme:check` 全 exit 0；五仓 devDependencies 均 `"dsh-featherhunter-plugin-base": "0.1.7"`；各仓 README 唯一写路径为 base readme:sync；workflow 数 3→3 / 4→4 / 2→2 / 2→2 / 1→1（票 13 记录）。
2. 整体：五仓各一次接入改动（prompt 944905c、deck 42280a82、palette 862a4c2、im 76dd0f6d、ilife d7cdda30）已推送默认分支；11 份 README 全部 up to date；五仓 base 版本一致（0.1.7）；base 仓 gate 全绿（§三）。
3. HUMAN-GATE：五组证据见核对清单 §7；§5 已填代理侧收口结论（2026-11-03），最终「完成」由仓主在规格详情页点击。

## 三、检查命令与结果（本会话 2026-11-03 02:2x–02:5x，manage HEAD `4646fb0`，与 §四 交付提交一致）
- `node scripts/ops/base-verify.mjs --json` → exit 0，5/5：typecheck 1.8s；tests 1080 passed | 6 skipped（80 passed files，40.83s）；docs ok（README/AGENTS-USAGE match）；scan 318 files 0 issue；build ok（core/client/node/cli/real-machine-verification）。日志 `.tmp/ops-logs/base-verify-2026-11-02T18-28-34-907Z-<step>.log`。
- 五仓 HEAD==upstream（ahead/behind 0 0）：prompt `5b3a402`、deck `f70be720`、palette `b1d1243`、im `f4c38eb`(master)、ilife `59d32ae4`(master)；每仓 `npm run readme:check` exit 0（2/3/3/2/1 份 up to date）。
- 聚合（用五仓已安装的 0.1.7 CLI `D:\dsh-plugin\dsh-prompt\node_modules\dsh-featherhunter-plugin-base\dist\node\cli.js`）：`readme:sync --check --all --repos D:\dsh-plugin` exit 0（11 份 up to date）；`doctor --repos D:\dsh-plugin --offline` exit 0（33 项 ok；remote-manifest skipped offline；deck inline-bundle inlined v0.1.7；cron-mounts 全挂）。
- GitHub main CI：`gh run list` 最近 3 次 success：41496915229（4646fb0，55s）、41496708863（5365eab，44s）、41491809808（7m59s）。
- 说明：用本仓本地 base 0.1.8 CLI 跑同一聚合会报 16 项 fail（readme-blocks/readme-images @0.1.7 期望 @0.1.8、dependency-version、deck inline-bundle v0.1.7→v0.1.8），属版本轮次差、不是五仓门禁回归；换钉与发版转票 16。

## 四、交付证明
- manage 仓（本规格文档 / 证据 / 收口写回）：`main` 分支，关闭时 HEAD `5f59f21`（含状态修订与新票 16）、写回提交 `ad35aab`，均已推送 origin/main；关闭前证据提交 `4646fb0` 亦在 origin/main。
- 五仓接入提交（各自默认分支，已推送）：prompt `944905c`（0.0.2 接入；0.1.7 换钉 `5b3a402`）、deck `42280a82`（后续 `f70be720`）、palette `862a4c2`（后续 `b1d1243`）、im `76dd0f6d`（后续 `f4c38eb`）、ilife `d7cdda30`（后续 `59d32ae4`）。
- base 仓：0.1.8 发布提交 `83e2b0a`（main 与 feat/real-machine-verification 同 tip），tarball 校验 8/8 PASS。

## 五、遗留处置
- 新票 **#16**「五仓换钉 base 0.1.8 并重发插件版本；发版后复核新弹窗（渠道徽标）」：承接 0.1.8 换钉、五仓发版、真实插件页 C4/C6 复验；parentKey null，不阻塞本规格。
- 已发布 npm 版本仍内联 base 0.1.5 旧弹窗：由 #16 承接。
- 未提交改动：仅 `?? .scratch/evidence-obligation/` 与 `?? docs/证据义务-业界机制调研.md`（另一在办规格 evidence-obligation 的产物，未触碰；不属本规格）。
- 临时文件：`.tmp/hg-018-*.png` 与 `.tmp/hg-plan-*-018.json` 是 §7.8 证据，保留（gitignore）；本会话删除仓库根意外生成的 `%SystemDrive%` 空目录树（0 文件，git 未跟踪）。
- 分支：本规格无独有未合并分支；`feat/real-machine-verification` 本地无独有提交（tip 83e2b0a 已在 origin）；`prototype/header-action-cluster`（9e1ac64 / 253b0ff / 108b3c9）与 `ticket/11-sync-doctor`（5bbfd8a / 88f0948）为更早规格的 throwaway 原型，已在 `.scratch/base-package/spec.md` 收口记录注明保留供审阅，与本次 rollout 无关。

## 六、关闭前自检
- 子票：08–15 全部 closed（本会话 list 核验），满足 spec 关闭守卫。
- 评论与关闭同一次 `deck_issue_patch({key:"00", feature:"base-package-rollout", comment, progress, close:true})`；评论中的 base 仓 gate 在 `4646fb0` 上实跑，五仓结果来自其安装目录与上游 HEAD 核对，均在本会话产生。
- 未提交 / 临时 / 分支遗留：见 §五，已逐项处置。
- 关闭后按工作区惯例把 spec.md 写回（收口评论、closed、进度 100%）单独提交并推送，再以「关闭后补充」评论回填提交号；不使用 Closes 关键词、不开 PR。

## 进度

- 进度：100%（2026-11-03T02:47:33+08:00）：收口复核完成：08–15 全关；本会话 gate/五仓聚合/CI 证据齐全；遗留转票 16；规格关闭（2026-11-03）
