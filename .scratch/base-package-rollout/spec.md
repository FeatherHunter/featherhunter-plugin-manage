<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 五仓接入 base 包（rollout） -->
<!-- DSH-STATUS: ready-for-agent -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-92d99e0d-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:46:07.969Z -->

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
- 票 08–13 已全部关闭；base 已从 0.0.2 一路发到 **0.1.5**（0.0.2 时期「未发布」阻塞已解除）；五仓均已发 npm 正式版并钉 `dsh-featherhunter-plugin-base: "0.1.5"`：prompt `0.4.40`、deck `1.9.0-beta.33`、palette `2.1.11`、im-companion `0.2.26`、ilife `0.3.86`。web profile 已从 file: tarball 切到 npm 精确版本并真机复验通过（见票 09 与 `docs/HUMAN-GATE-五仓接入-base-0.0.2-核对清单.md` §7.5）。
- 票 14 HUMAN-GATE 仍 open（进度 92%）：B 组 owner 2026-11-01 已确认通过；C4/C6/E1/E2/E3 已由代理自动化实测 PASS（证据见核对清单 §7.6）；剩 owner 对 C4/C6 的主观观感一眼、D 组 desktop profile 安装形态（需授权装五仓 npm 正式版并重启桌面应用）。
- 票 14 关闭后，由用户在规格详情页点「完成」按钮做收口核对（不是自动关闭）。

## 票号说明
最早建的 01–07 是在本规格容器存在之前以普通 issue 建的，挂不到规格下；已按规格体系重建为 08–14（kind=spec-ticket、父票 00、依赖边齐全），01–07 已作为重复票关闭。

## 验收记录（票 13 回填，2026-10-31 14:10 +08:00）
- 五仓自动验收全部通过：聚合 `readme:sync --check --all --repos D:\dsh-plugin` exit 0（11 份 README up to date）、`doctor --repos D:\dsh-plugin` exit 0 全绿；五仓构建/测试通过（prompt check+build、deck verify-parallel 459/459、palette build+312 tests、im check 595、ilife tsc -b+build+97 定向测试）；git 对比确认未新增 workflow 文件；base 仓 typecheck + vitest（314 pass）全绿。
- 证据与逐仓明细：`docs/五仓接入-base-0.0.2-验收记录.md`。
- 五仓接入提交（本地提交，尚未推送）：dsh-prompt `944905c`、deck `42280a82`、palette `862a4c2`、im-companion `76dd0f6`、ilife `d7cdda30`。
- 票 08–13 已全部关闭；票 14 HUMAN-GATE 待仓主真机/真实页面证据（扫码三群、浏览器内 dialog 顶层与焦点、GitHub 观感、大陆网络三通道降级）。
- 注：markdown 后端的 spec 容器不支持 deck_issue_patch 评论（工具报 `map.md not-found`），本条按工作区约定直接回填在 spec.md 正文。

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
