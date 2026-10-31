<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 08 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-c7b48534-5978061 -->
<!-- DSH-CREATED: 2026-10-31T03:47:19.907Z -->
# 10: palette 仓接入 base 包（mini-bundler 风险）

**What to build:** palette 仓接入 base 包，重点是验证 palette 的 mini-bundler 能内联 base client 产物：INLINE_PACKAGES 登记新产物，设置面板接入入口与推荐卡，README 三个文件迁移四块（星图保留单张主题中性图），已有 workflow 挂 readme:sync。

**Blocked by:** 08

**Status:** resolved

- [ ] 依赖钉精确版本；INLINE_PACKAGES 登记 base client 产物
- [ ] mini-bundler 构建通过且产物无重复 React
- [ ] 设置面板入口与推荐卡接入；旧实现删除
- [ ] README.md、package/README.md、docs/README.en.md 四块迁移
- [ ] 已有 workflow 挂 readme:sync，不新增 workflow 文件
- [ ] readme:sync --check 与 doctor 对本仓全绿；本仓构建与测试通过
- [ ] 其他仓零改动

## Comments

### local — 2026-10-31T05:13:53.048Z

### local — 2026-10-31T05:13:53.944Z
实现完成：mini-bundler 已内联 base client 且无重复 React，面板入口/推荐卡接入，三份 README 四块托管（package/README.md 为 gitignore 构建产物），既有两份 workflow 挂 readme:sync；typecheck/build/readme:check/doctor/test 全绿。待推送后看 Actions 实跑与 HUMAN-GATE。
## 实现完成（降级路线：本机直接改仓 + 本地提交，未 push）

- 提交：862a4c2（palette main，基线 4ab7f23；21 files, +365/−299；未 push、未 amend/rebase/reset）
- 工作树干净（git status --short 为空）

### 验证（Lead 独立复跑）
- npm run typecheck → exit 0
- npm run build → exit 0（bundle: package/lib/client.js 1694055 B / 动态版 1693444 B / index.js 25748 B；check-deps、inline-fonts 全过）
- npm run readme:check → exit 0：README.md / package/README.md / docs/README.en.md 均 up to date
- base doctor . → exit 0：10 项全 ok（readme-blocks 3 README in sync、dependency-version pinned 0.0.2、cron-mounts mounted star-history.yml+thanks.yml、star-assets present）
- npm test → exit 0：tests 312 / pass 312 / fail 0
- 产物核查：createBaseUI ×6、内联模块名 base-client ×3、ESM import base ×0、两份产物各自只走既有 React 注入（无第二份 React）

### 逐条核对
- [x] 依赖精确 0.0.2；scripts/build-client.ts 的 INLINE_PACKAGES 登记 base client（单文件、deps 空、key base-client），MODULE_ORDER 插在 client 之前；产物 mini-bundler 构建通过且无重复 React
- [x] 面板入口与推荐卡改由 createBaseUI(hostReact,{lang,selfId:'palette'}) 渲染（ContactRow/AuthorPlugins），删除手写 authorCard/authorPlugins/extLinkIcon/gridIcon 与 6 条 I18N 词条；settings.section order 16 本来已满足
- [x] README 四块迁移：README.md / docs/README.en.md 由 readme:init 生成、readme:sync 维护；package/README.md 由 build 从英文页再生（含托管块）
- [x] 只在既有 star-history.yml / thanks.yml 挂 readme:sync，无新增 workflow（git diff origin/main..HEAD -- .github/workflows 仅 2 个 M）
- [x] 其他仓零改动（提交只含 palette 文件）

### 偏离与说明
- package/README.md 是 .gitignore 的构建产物（ADR 0004）：不入库，由 build 从 docs/README.en.md 再生；本地 readme:check 三份全 up to date（需先 build）。
- CI 里不用 --repo .：clean checkout 缺 package/README.md，--repo . --check 实测 exit 1（README not found）；两份 workflow 改为逐文件 npx readme:sync --readme README.md|docs/README.en.md --self palette，并删掉旧的 node -e 缓存戳步骤（改由 base 从 docs/star-history.json 派生 12 位戳）。
- doctor 的 inline-bundle-version 对 palette 报 "not inlined"，原因是 base 0.0.2 只扫 ≤512KB 源文件，palette bundle 1.69MB 超阈值（判 ok）；实际内联已用人工 grep 验证，属 base 版本遗留缺口。
- 保留 scripts/sync-readme-version.ts（只维护 UPGRADE 段版本号，在托管块之外），不构成第二条托管块写路径。
- package-lock 里 react/react-dom 等 5 条 registry.npmmirror.com URL 为基线既有，本票只新增 base 条目且 resolved 指 registry.npmjs.org、integrity 与发布 tarball 一致。

### 遗留风险
- 两份 workflow 的 readme:sync 步骤尚未在 GitHub Actions 实跑（推送后观察）。
- 星图 ?v= 改为随数据日派生（旧为分钟戳），同一天重复改图不会换 URL，属 base 设计口径。
- 真机/浏览器 HUMAN-GATE（弹窗 top-layer、焦点、深色浅色）待票 14。

## 进度

- 进度：100%（2026-10-31T13:13:52+08:00）：实现完成并 Lead 独立复跑 typecheck/build/readme:check/doctor/test 全绿，本地提交 862a4c2（未 push）
