<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 08 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-98234e2e-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:47:18.894Z -->
# 09: deck 仓接入 base 包

**What to build:** deck 仓接入 base 包：设置面板加入口与作者插件卡、README 三个文件迁移四块、已有 star-history.yml / thanks.yml 挂 readme:sync、删除旧 assets/contact-*.png，deck 构建与测试通过。

**Blocked by:** 08

**Status:** resolved

- [ ] 依赖钉精确版本，产物可被 deck 构建链吃下（重新内联 dist/client/index.js 并提交）
- [ ] 设置面板入口与推荐卡接入；旧实现删除
- [ ] README.md、package/README.md、docs/README.en.md 四块迁移（英文页移除 dsh-chinese-skill-patch、保留 --- 之后 footer）
- [ ] 已有 workflow 挂 readme:sync，不新增 workflow 文件
- [ ] readme:sync --check 与 doctor 对本仓全绿；本仓构建与测试通过
- [ ] 其他仓零改动

## Comments

### local — 2026-10-31T06:00:28.035Z

### local — 2026-10-31T06:00:28.433Z
deck 仓接入完成并经 Lead 独立复核：依赖钉 0.0.2、base client 派生内联进构建产物、设置页用 base ContactRow/AuthorPlugins 且旧实现删除、三份 README 四块托管、两份既有 workflow 挂 readme:sync 未新增 workflow、readme/doctor/类型检查/定向门禁/冒烟全绿；全链唯一红为并发负载下 verify-settings-debug 计时抖动（单跑绿）。
## Lead 独立复核（2026-10-31）

提交 `42280a82`（main，父 `f7320e34`＝并发会话 #1732 的提交；单提交、25 files +1698/−133，索引清理后只含票 09 路径）。提交后工作树仅剩开工前就有的两件未跟踪文件（assets/video/中文-spec-implementspec-2.mp4、research/1704-v132-diff.md）。注意：复核期间并发会话又在其上提交（HEAD 已前进到 bd3039bd），我方提交不作改动、未 rebase。

### 索引污染处置（Lead 发现并下达）
`git diff --cached` 曾显示 M src/client/statusbar/StatusMenus.ts、M tests/gate-map.json、D tests/verify-1732-chain-menu-resize.ts。实现者按指令：记录现场 → `git reset`（mixed，工作树未动）→ 只 add 25 个票 09 显式路径 → 逐行核对 staged 清单 → 提交。Lead 复核 `git show --name-status HEAD`：25 条全部为票 09 文件，无 StatusMenus.ts、无 verify-1732 文件删除；`git cat-file -e HEAD:tests/verify-1732-chain-menu-resize.ts` 存在；`git diff f7320e34..HEAD -- StatusMenus.ts` 为空 → 并发会话内容零回退。tests/gate-map.json 的改动仅为重生成（generatedAt 更新 + baseClient.derived.js 归属/防线登记），未删他人条目。

### Lead 本机重跑结果
- 依赖/锁：package.json devDep `"dsh-featherhunter-plugin-base": "0.0.2"` 精确；pnpm-lock 仅 integrity `sha512-4iL/…GOi6A==`（与已发布 0.0.2 一致），无 tarball/npmmirror URL；pnpm-workspace 加 minimumReleaseAgeExclude base@0.0.2。
- 内联：`node scripts/build.mts` exit 0（[build] OK）；scripts/generated/baseClient.derived.js 94,181 B 含 v0.0.2 横幅；package/lib/client.js 含 base 横幅 1 处、createBaseUI、kernel baseClient 标记。
- README：`pnpm --config.verify-deps-before-run=false readme:check` exit 0，三份 README（README.md、package/README.md、docs/README.en.md）up to date；四块标记齐全（zh：THANKS-TABLE-ZH/CONTACT/STAR-HISTORY/MORE；en：MORE/THANKS-TABLE-EN/CONTACT/STAR-HISTORY），en 页不再含 dsh-chinese-skill-patch 推荐行。
- doctor：`base doctor . --offline` exit 0，10 项全 ok（readme-blocks 3 in sync、readme-images 9@0.0.2、dependency 0.0.2、inline-bundle-version inlined v0.0.2、star-assets、cron-mounts mounted in star-history.yml+thanks.yml）。
- typecheck：exit 0（全绿输出，603 份源码无漏检）。
- 定向门禁逐条 exit 0：verify-gate-map（109 断言）、verify-generated-no-shadow（21 项，含 base createBaseUI/ensureBaseStyles 可见）、verify-build-artifacts、verify-client-hardcode-gate（616）、verify-ui-feedback（193 断言）、verify-thanks-table、verify-kernel；verify-settings-debug 单跑 204 通过/0 失败；test:smoke 5 条全绿。
- 工作流：只改既有 star-history.yml / thanks.yml（Bump README cache stamp → `npx -y dsh-featherhunter-plugin-base@0.0.2 readme:sync --repo .`，commit 清单补 package/README.md；thanks.yml 写数据后加同款 sync）；`git ls-tree` 对比 workflow 集合一致（matrix/release-tarball/star-history/thanks）→ 未新增 workflow 文件。
- 入口与旧实现：SettingsPage 底部渲染 base ContactRow + AuthorPlugins（运行时 typeof 守卫，源码树单独 import 退化为不渲染）；旧 MORE_PLUGINS/more.* 文案删除；3 张旧联系 PNG 删除。

### 已知偏离 / 风险
1) 全链 `verify-chain` 一次 exit 0 未取到：唯一红是 verify-settings-debug 两条计时断言在并发负载下抖动（单跑 204/0 绿）；并发会话持续在本仓 main 编辑（#1732），属并发导致，不是本票代码问题。
2) pnpm 软链坑：脚本带 `--preserve-symlinks-main`（否则 base CLI 静默 no-op）；本地 pnpm 11 需 `--config.verify-deps-before-run=false` 否则依赖校验会去 npmjs 挂死。此两点与 ilife 同源，属 base CLI / pnpm 11 环境改进项，记入票 13 交付说明。
3) 未 push（按降级路线由 Lead 统一推送）。

结论：票 09 验收通过，关闭。

## 进度

- 进度：100%（2026-10-31T14:00:27+08:00）：Lead 独立复核通过：commit 42280a82（25 files，无并发会话内容回退），typecheck/build/readme:check/doctor(10项)/7 项定向门禁/verify-settings-debug 单跑 204-0/smoke 5 条全绿；未新增 workflow；base 0.0.2 精确钉版 + 内联横幅可证
