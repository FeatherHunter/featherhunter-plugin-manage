<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-254e7810-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:46:59.704Z -->
# 08: dsh-prompt 仓接入 base 包并全部测通

**What to build:** dsh-prompt 仓按 docs/handover/01、02、03 接入 base 包，并让本仓 `npm run check` 全部通过：设置面板里的作者其他插件推荐从手写清单换成 base 的 AuthorPlugins；README 的联系 / 星图 / 致谢 / 作者其他作品四块改由 readme:sync 渲染（保留 prompt 的 Markdown 联系标题 <sub>CONNECT</sub> 变体与 Markdown 星图形态）；已有 workflow 挂 readme:sync，不新增 workflow 文件。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [ ] 依赖钉精确版本 dsh-featherhunter-plugin-base@0.0.2（写入 package.json，peer react 与宿主一致；0.0.2 尚未发布时先用手工 tarball 验证，发布后更新 lock）
- [ ] 设置面板推荐卡改用 base 的 AuthorPlugins：不注册 settings.section、不读写宿主存储；首帧基线、到货静默替换；整行可点开新标签页
- [ ] README.md 与 docs/README.en.md 四块内容等价迁移：联系区 260 宽 CDN 图、星图保持 Markdown 单图形态带 ?v=YYYYMMDDHHmm（读 docs/star-history.json 末条日期）、致谢表逐行等价、作者其他作品保留 prompt 的 MORE 标题变体
- [ ] 旧手写联系/推荐实现删除（MORE_PLUGINS、PluginRow、旧 contact 图与 screenshots.json 条目），仓内不存在第二套写 README 的路径
- [ ] 已有 workflow 挂 readme:sync（star-history.yml、thanks.yml）并在 check.yml 加 readme:check，不新增 workflow 文件
- [ ] `npm run check` 全绿（typecheck、既有全部 check:* 与 test:*）
- [ ] `readme:sync --check --repo .` 对本仓退出 0
- [ ] 其他四个仓零改动

## Comments

### local — 2026-10-31T03:55:23.929Z
prompt 仓接入已在本机全绿（commit `944905c`，未推送）。

**改了什么**
- 设置面板：`src/client/settings-links.ts` 删除手写 MORE_PLUGINS / PluginRow / more 样式，改 `createBaseUI(react,{selfId:'prompt'})` 单例；`AuthorPlugins` 走 base（首帧内置 5 条基线、清单到货静默替换）；新增 `ContactRow` 包装并放在推荐卡之前（`settings-page.ts`）；`strings.ts` 删掉迁走的 more* 文案。
- README：`README.md` 与 `docs/README.en.md` 四块由 base `readme:sync` 生成/接管——联系区改 260 宽 CDN 整卡（`dsh-featherhunter-plugin-base@0.0.2/data/img/card-feishu.png`、`card-qq.png`、`card-wechat-2026-10-23.png?v=20261023`，alt 保留），星图保持 Markdown 单图并带 `?v=202610300000`（读 `docs/star-history.json` 末条日期），致谢表逐字节不变，作者其他作品保留 prompt 的 `## … <sub>MORE</sub>` 居中标题变体与引言。
- 旧实现清理：删除 `assets/readme/contact-feishu-permanent.png`、`contact-qq-permanent.jpg`、`contact-wechat-weekly.png` 与 `screenshots.json` 三条登记；仓内写 README 的路径只剩 `readme:sync`。
- workflow（未新增文件）：`star-history.yml`、`thanks.yml` 在数据更新步骤后挂 `npx -y dsh-featherhunter-plugin-base@0.0.2 readme:sync --repo .`（星图 8 位手写戳改为由 sync 生成 12 位戳）；`check.yml` 加 `npm run readme:check`。
- 脚本：`update-thanks.mts` 只写 `docs/thanks-data.json`（不再画表）；`check-thanks.mjs` 改与 base `renderThanksBlock` 同源比对；`check-star-history.mjs` 用 CDN 整卡定位群码并断言 12 位戳。
- 依赖：`devDependencies` 钉 `dsh-featherhunter-plugin-base: 0.0.2`；`package-lock.json` 按本地 0.0.2 tarball 预置条目（integrity `sha512-4iL/yaly5dlgvKOx8hXfJ8qtAD0/W8jFGjDoWtUcqMP9t3ooj2pBE6jcwwgdta2FcHIOFs+/5eJyHmWkkGOi6A==`）。
- 回归脚本：6 个 `scripts/repro/test-issue-*.cjs` 的 settings-links 桩补 `ContactRow`（settings-page 新 import）。

**验证（本机，commit 944905c）**
- `npm run typecheck` → exit 0（tsconfig.json + tsconfig.host.json）。
- `npm run check` → exit 0（完整静态门禁链：check:lib-sync 重建并逐字节比对 lib/client.js、check:marketplace-readme、check:issue-116/110/104/86/82/182/179/181/177/178/176、test:hover-tip、test:star-history 17 pass、test:thanks 5 pass、check:target-tree 34 行、check:update-pkg 等）。
- `node node_modules/dsh-featherhunter-plugin-base/dist/node/cli.js readme:sync --check --repo .` → 两个 README `up to date`，exit 0。
- `lib/client.js` 已用最终 base 0.0.2 tarball（含 `--repo`）重建：969811 B / gzip 274.53 kB，bundle 内无裸 import base。

**阻塞与待办**
- base 0.0.2 尚未发布：npm registry 当前网络阻断（`npm ping` ECONNRESET），所以 `npm ci` 与 lock integrity 只能在发布后最终核验。发布若使用同一 tarball（sha512 见上）则 lock 直接生效，否则重装重生成。
- 因此本仓 commit 944905c 暂未 push：push 会触发 CI `npm ci`，registry 上还没有 0.0.2。
- base 仓配套修复已提交并推送 manage main `6e3f7c2`（含 `3b7563d`：Markdown 形态保留、`--repo` 单仓模式、星图数据文件版本、居中 wrapper 边界修复）。

### local — 2026-10-31T04:28:14.819Z
票 08 收尾（2026-10-31）：base 0.0.2 已发布到 npm registry，prompt 仓 commit 944905c 已推送 origin/main。GitHub Check workflow run 41168116795 attempt 4 全绿（37s，含 Install dependencies / Typecheck / Check(static gates) / Check managed README blocks）。本票所有验收项完成。

### local — 2026-10-31T04:28:14.974Z
prompt 仓接入完成并推送，CI 全绿

## 进度

- 进度：100%（2026-10-31T12:28:14+08:00）：CI 全绿（run 41168116795 attempt 4 success）
- 进度：75%（2026-10-31T11:55:23+08:00）：prompt 本机全绿（commit 944905c），等 base 0.0.2 发布后核验 lock 并推送
