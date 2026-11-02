<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-BLOCKED-BY: 01 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-a1790330-5978770 -->
<!-- DSH-CREATED: 2026-11-02T14:50:15.626Z -->
# 05: 发布后 tarball 校验接入

**What to build:** 发布 workflow 在 npm publish 成功后，用与本地同一份校验代码从 registry 下载 tarball 全验；失败让 workflow 红灯；没有跳过校验的开关。

**Blocked by:** 01

**Status:** resolved

- [ ] publish workflow 在 publish 成功后运行只校验模式，版本取自包目录 package.json，超时显式给足；失败即 job 失败。
- [ ] 无跳过校验的输入、开关或条件分支；校验步骤不接收发布 token（token 只注入发布步骤）。
- [ ] 校验 JSON 写 runner 临时目录并以 artifact 留存。
- [ ] 离线测试：本地假 registry 提供 manifest 与合成 tarball（含包清单、dist 入口四标记、CLI、文档）→ 成功退出 0 且 JSON 含 dist/download/entry/cli；篡改 shasum → 退出 1 且文案含 mismatch；版本不符 → 退出 2；未发布（404）→ 退出 2。
- [ ] 测试不联网、不需要 npm 登录；typecheck 与 tests 绿。



## Comments

### local — 2026-11-02T15:42:47.732Z
验收证据（Lead 复核）：
- 合入：merge 1b6050c（ticket/05-publish-verify c116f96），3 文件 +528。
- 红→绿：旧 workflow 6 failed|5 passed（workflow has no tarball verification step），实现后 11/11。
- workflow：publish 步骤后新增校验步骤（working-directory: .，timeout-minutes: 20，版本从 packages/base/package.json 读），调用与本地相同的入口 `node scripts/ops/base-release.mjs --skip-publish --version ... --commit HEAD --registry https://registry.npmjs.org --timeout-min 15 --download $RUNNER_TEMP/base-verify --json`；无 if/continue-on-error/|| true；校验步骤不接收 NODE_AUTH_TOKEN；JSON 上传 artifact（if: always()）。
- 离线假 registry 4 例覆盖：成功 0 且 JSON 含 dist/download/entry/cli；篡改 shasum → 1 且文案含 mismatch；版本不符 → 2；未发布 404 → 2。
遗留（已知、票面接受）：base-release.mjs --skip-publish 的预检在版本尚不可见时立即退 2（scripts/ops/base-release.mjs:143-153），只有预检通过才进 pollPublished(:203)，因此 CI 紧跟 npm publish 撞传播窗口会红灯、--timeout-min 在 verify 模式不生效；本次按票面「404→2 且不改脚本」只做接线，修法（预检也轮询）留给后续票。

### local — 2026-11-02T15:42:50.857Z
发布后取证接线完成、契约用例绿；传播窗口风险按票面记为遗留。





## 进度

- 进度：100%（2026-11-02T23:42:46+08:00）：publish workflow 发布后新增只校验步骤 + artifact，离线 11 用例绿并合入
