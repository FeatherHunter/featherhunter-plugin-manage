# 五仓接入 base 0.0.2 整体验收记录（票 13）

- 验收时间：2026-10-31 14:00–14:10（Asia/Shanghai）
- 验收人：Lead（代理），本机 Windows，node v24.19.0 / npm 10.9.2 / corepack pnpm 11.22.0·11.8.0
- 受验对象：dsh-prompt、dsh-mattpocock-skills-deck、dsh-opencode-palette、dsh-im-companion、ilife
- base 包：`dsh-featherhunter-plugin-base@0.0.2`（registry.npmjs.org latest，integrity `sha512-4iL/yaly5dlgvKOx8hXfJ8qtAD0/W8jFGjDoWtUcqMP9t3ooj2pBE6jcwwgdta2FcHIOFs+/5eJyHmWkkGOi6A==`）
- 验收口径：规格 `spec.md` 票 13；降级路线（单实现者串行 + Lead 独立复核 + 五仓本地提交）

## 1. 五仓接入提交（每仓一次接入改动）

| 仓库 | 提交 | 说明 |
| --- | --- | --- |
| dsh-prompt | `944905c` | 联系入口与作者插件卡改由 base 通用件渲染；= origin/main |
| dsh-mattpocock-skills-deck | `42280a82` | 接入 base 联系入口/作者卡，README 四块改由 readme:sync 渲染（其上有并发会话 #1721/#1732 的提交，未 rebase） |
| dsh-opencode-palette | `862a4c2` | 接入 base 通用件与 README 四块迁移 |
| dsh-im-companion | `76dd0f6` | 面板接入共享联系入口，README 四块交给 base 托管 |
| ilife | `d7cdda30` | 总管页接入 base 通用件并把 README 四块迁到托管标记 |

五仓依赖均精确钉版 `"dsh-featherhunter-plugin-base": "0.0.2"`；lock 里只出现 npmjs tarball / integrity，无 npmmirror URL。

## 2. 聚合检查（在五仓父目录 D:\dsh-plugin 上跑）

CLI：`D:\dsh-plugin\dsh-prompt\node_modules\dsh-featherhunter-plugin-base\dist\node\cli.js`

### 2.1 `readme:sync --check --all --repos D:\dsh-plugin` → exit 0

11 份受管 README 全部 up to date：deck 3（README.md、package/README.md、docs/README.en.md）、palette 3、im 2、prompt 2、ilife 1。

### 2.2 `doctor --repos D:\dsh-plugin` → exit 0（全 ok）

- package-version：0.0.2
- data-freshness：manifest v0.0.2，revision 1
- copy-freshness：5 entries（oldest deck 2026-10-30）
- remote-manifest：unpkg @latest v0.0.2，matches package
- 逐仓：readme-blocks（deck 9 / palette 9 / im 6 / prompt 6 / ilife 3，全部 @0.0.2）、readme-images、dependency-version（pinned 0.0.2）、inline-bundle-version（deck **inlined v0.0.2**；palette/im/prompt/ilife not inlined——它们的产物由各自 bundler 内联，doctor 只扫源码，已用产物 grep 补证）、star-assets（chart assets present）、cron-mounts（deck/palette/im/prompt：mounted in star-history.yml + thanks.yml；ilife：mounted in ci.yml with schedule）

## 3. 未新增 workflow 文件（git 对比，文件集合前后相同）

| 仓库 | 对比 | 改动 | 文件数 |
| --- | --- | --- | --- |
| dsh-prompt | HEAD^..HEAD | M check.yml、M star-history.yml、M thanks.yml | 3 → 3 |
| dsh-mattpocock-skills-deck | 42280a82^..42280a82（及 f7320e34..HEAD） | M star-history.yml、M thanks.yml | 4 → 4 |
| dsh-opencode-palette | 862a4c2^..862a4c2 | M star-history.yml、M thanks.yml | 2 → 2 |
| dsh-im-companion | 76dd0f6d^..76dd0f6d | M star-history.yml、M thanks.yml | 2 → 2 |
| ilife | d7cdda30^..d7cdda30 | M ci.yml | 1 → 1 |

结论：只有既有 workflow 被修改（追加 `npx -y dsh-featherhunter-plugin-base@0.0.2 readme:sync …` 或 README 缓存戳步骤），没有新增 workflow 文件。

## 4. 五仓构建与测试（Lead 本机重跑）

### dsh-prompt（944905c）
- `npm run readme:check` → 0（2 份 up to date）
- `npm run check` → 0
- `npm run build` → 0（lib/client.js 969,811 B，含 base v0.0.2 横幅与 createBaseUI；构建后 git status 干净 → 产物确定性）

### dsh-mattpocock-skills-deck（HEAD bd3039bd，含我方 42280a82）
- `node scripts/verify-parallel.mts --keep-going` → exit 0：459/459 步、真红 0、主链真红 0、并发假红 1（verify-cap-fold-browser.ts，串行复跑绿）、冒烟 5/5、墙钟 106.7 s
- `readme:check` → 0（3 份 up to date）；`tsc` typecheck → 0；`node scripts/build.mts` → 0（package/lib/client.js 含 base 内联；scripts/generated/baseClient.derived.js 94,181 B）
- base doctor --offline → 0（10 项 ok，inline-bundle-version: inlined v0.0.2）
- 定向门禁全 0：verify-gate-map（109 断言）、verify-generated-no-shadow（21 项）、verify-build-artifacts、verify-client-hardcode-gate（616）、verify-ui-feedback（193）、verify-thanks-table、verify-kernel；verify-settings-debug 单跑 204/0

### dsh-opencode-palette（862a4c2）
- `npm run typecheck` → 0
- `npm run build` → 0（package/lib/client.js 1,694,055 B、动态版 1,693,444 B、index 25,748 B；mini-bundler 路径 OK）
- `npm run readme:check` → 0（3 份 up to date）
- `npm test` → 312 pass / 0 fail

### dsh-im-companion（76dd0f6）
- `npm run readme:check` → 0（2 份 up to date）
- `npm run check` → 0（node:test 595 pass / 0 fail；guard 190 files PASS）
- 注：工作树另有与本票无关的未提交文件（docs/research/INDEX.md 修改、排查-185-首条回复未送达.md 新增），未入库、不影响验收

### ilife（d7cdda30）
- `pnpm -F dsh-life-pack run typecheck` → 0；`pnpm build`（tsc -b + 打包）→ 0（packages/plugin-manager/dist/client.js 1,286,080 B，base 横幅 1 处、dsh-base-* 109 处、react require 恰 1 次）
- `readme:check` / `star:check` / `thanks:check` / `gen:check`（DATA-ABSENCE PASS）/ `boundaries` / `base:floor`（15/15）/ `changeset:status` → 全部 0
- 定向测试 97 pass / 0 fail（plugin-manager 4 个测试 + client-bundle-48 + tooling 2 个）
- 全量套件本机基线红（既有 headless Chrome/CDP、像素缝等环境问题，130 fail），本票相关测试全绿、无新增失败

## 5. base 仓自身测试（验收口径「base 仓测试仍全绿」）

`D:\dsh-plugin\featherhunter-plugin-manage\packages\base`（源码 version 0.0.1，工作树干净）：
- `npm run typecheck` → exit 0
- `npm test`（vitest）→ exit 0：24 passed files / 1 skipped；314 tests passed / 6 skipped；17.26 s

## 6. 结论与遗留

- 五仓接入 base 0.0.2 的自动验收项全部通过：聚合 readme 检查与 doctor 双绿、五仓构建/测试通过、未新增 workflow、base 仓测试全绿。
- 遗留（不阻塞自动验收，交票 14 HUMAN-GATE / 仓主）：
  - 真机证据：三群体扫码、浏览器内联系弹窗顶层与焦点、GitHub 页面观感、大陆网络三通道降级——代理不可自判。
  - 五仓提交已「本地提交」，推送 GitHub 默认分支与 CI 实跑在票 13 之后统一进行（deck 需与并发会话协调）。
  - 已知偏离：deck/palette 本地 pnpm 11 需 `--config.verify-deps-before-run=false`；base CLI 在 pnpm 软链下需 `--preserve-symlinks-main`（ilife/deck 脚本已带，建议回馈 base 仓）。
