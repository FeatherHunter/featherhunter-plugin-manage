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
- 票 08 本机全绿（prompt 仓 commit 944905c，未推送）：typecheck、npm run check、readme:sync --check --repo . 全部通过；lib/client.js 已用 base 0.0.2 tarball 重建。
- 唯一阻塞：base 0.0.2 未发布（npm registry 网络阻断，npm ping ECONNRESET），prompt 的 lock integrity 与 push 要等发布后核验；发布用同一 tarball 则 lock 直接生效。
- 票 09–12 按依赖边等票 08 关闭后开始；票 13、14 等 09–12 关闭后开始。

## 票号说明
最早建的 01–07 是在本规格容器存在之前以普通 issue 建的，挂不到规格下；已按规格体系重建为 08–14（kind=spec-ticket、父票 00、依赖边齐全），01–07 已作为重复票关闭。
