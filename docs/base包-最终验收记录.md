# base 包最终验收记录

适用范围：规格 `.scratch/base-package/spec.md`（票 00），实施票 01–13。
验收时间：2026-10-31（Asia/Shanghai）；分支 `feat/base-package`，HEAD `a85ebab`。
结论：**自动部分 7/7 全绿**；人工项（HUMAN-GATE）逐条列出，**待各仓仓主确认**，代理不自判。

## 1. 自动验收（7/7 PASS）

运行 `.tmp/final-acceptance.ps1`（日志 `.tmp/acceptance-final.log`），结果 `RESULT: 7/7 checks passed`：

| 检查 | 命令 | 本次结果 |
| --- | --- | --- |
| typecheck | `npm run typecheck` | tsc clean |
| test | `npm test` | 280 passed / 6 skipped（23 个测试文件；network 冒烟默认 skip） |
| build | `npm run build` | build ok: core, client, node |
| three-entry-import | `node --input-type=module -e "import(...)"` | core=8 client=18 node=56 个导出，三入口均非空 |
| demo-build | `npm run build:demo` | demo/dist 构建成功 |
| packlist | `npm pack --dry-run --json` | files=32、size=324189；含 package.json / README.md / LICENSE / data/manifest.json / dist 三入口 |
| real-repos-unchanged | 运行前后对比五仓 HEAD + `git status --porcelain` | 5 repos unchanged during the run |

补充说明：

- `npm test` 里的 network 用例（`test/network/cdn-smoke.test.ts`）需要真实发布 + 网络，按规格默认 `describe.skipIf` 跳过；
  发布侧的真实证据见 `docs/base包-发布演练记录.md`。
- packlist 的 32 个文件全部来自 `dist/`、`data/`、README、LICENSE、package.json；发布包不含源码与测试。

## 2. 三份交接文档走查（票 13 验收第 1 条）

三份文档均以「各仓仓主照做即可」为标准写：步骤可复制、含常见失败与回退、明确执行者是仓主。

| 文档 | 覆盖内容 | 失败/回退 | 结论 |
| --- | --- | --- | --- |
| `docs/handover/01-接入联系弹窗与推荐卡.md`（157 行） | 安装（钉精确版本）、`createBaseUI` 三行接入、选项表、组件 props、JSX 与 `createElement` 两套最小示例、逐仓落点表（槽位/入口/推荐卡/产物托管）、ilife 特例、旧实现逐仓清理清单 | §8 七类（构建链吃不下、多 React 实例、CSP、SSR、清单拉不到、临时换源、整体回退） | 通过：任一仓可独立完成接入 |
| `docs/handover/02-README四块迁移.md`（114 行） | 四块标记与渲染口径、11 个目标文件表、每仓迁移步骤、逐文件 diff 预期（含 deck en 行删除、im 脏行、prompt Markdown 标题、ilife 新增块）、`--check` 四类错误 | §6 五类（缺旧块、脏行、标记外改动、整体回退、暂停某块） | 通过：任一仓可独立完成迁移 |
| `docs/handover/03-CI与发布.md`（154 行） | 主路径 `readme:sync --all --repos`、在已有 workflow 挂 sync（不新增 workflow）、ilife `ci.yml` 加 schedule 特例、`doctor` 检查项表、发布侧一条命令（含 `--image` 换码、回滚语义、真实演练数据）、凭据不落库 | §5 十二类失败（drift、缺标记、脏行、标记错误、npmmirror 403、unpkg 滞后、依赖版本、内联版本、cron 缺失、脏树、客户端缓存） | 通过：任一仓可独立照做 |

## 3. HUMAN-GATE 五项（逐条，状态：待仓主确认）

| # | 项目 | 判定标准 | 状态 | 依据/说明 |
| --- | --- | --- | --- | --- |
| 1 | 真机扫码 | 手机扫飞书 / QQ / 微信各一次，能入群 | **待仓主确认** | 演练用图是旧码改名模拟，真实新码需人提供；见 `docs/base包-发布演练记录.md` §6 |
| 2 | 真实浏览器弹层 | `<dialog>.showModal()` top layer、遮罩、Esc、焦点回归、深浅色可读 | **待仓主确认** | 自动化在 happy-dom 里验证行为；真实浏览器观感需人看 |
| 3 | GitHub 观感 | 四块实际渲染：图片 260 宽、表格三列、标题居中、star 双图 | **待仓主确认** | 本地演练在 `.tmp/drill-repos` 副本；真实页面需推送后看 |
| 4 | 真实构建链 | deck/palette 内联产物、im/prompt tsdown、ilife `tsc -b` 吃下产物且无重复 React | **待仓主确认** | 需要各仓真实工程与打包器 |
| 5 | 大陆网络降级 | 无代理环境拉清单/图片，失败时回退可用通道与内置基线 | **待仓主确认** | npmmirror 403 已实测；本地代理环境不代表用户网络 |

以上 5 项未勾选即不算验收完成；它们与 `docs/handover/01` §7.2、`docs/handover/03` §6 的清单一一对应。

## 4. 五仓零改动声明与各仓主执行清单

### 4.1 零改动声明

- 本次实施**只读**五个插件仓（`D:/dsh-plugin/dsh-mattpocock-skills-deck`、`dsh-opencode-palette`、`dsh-im-companion`、
  `dsh-prompt`、`ilife`）：所有 `readme:init/sync/doctor` 演练都在仓库外副本 `.tmp/drill-repos` 上跑，
  发布演练在 `.tmp/drill-before` / `.tmp/drill-repos` 上跑，从未向五仓执行写命令。
- 最终验收脚本在运行前后各取一次五仓 HEAD + `git status --porcelain` 快照，结果一致（`real-repos-unchanged` PASS）。
- 五仓当前的未提交改动与 HEAD 变化均属仓主并发工作，不是本次实施产生：
  deck 在验收期间由仓主推进 HEAD（`1901ff9` → `9a09d98`）并新增未跟踪 mp4 / research 文档；prompt 同理
  （`2602f5d` → `6bad40c`，`scripts/real/*` 改动）；im 的 `docs/research/*` 与 ilife 的 README/package.json/tooling
  改动在本次实施开始前就存在；palette 保持干净。
- **本仓不包含五仓的代码改动**；README 的实际落地与 HUMAN-GATE 由各仓主按交接文档自行执行。

### 4.2 各仓主执行清单

通用验收（在五仓父目录执行，退出 0 即通过）：

```sh
npx -y dsh-featherhunter-plugin-base@1 readme:sync --check --all --repos <五仓父目录>
npx -y dsh-featherhunter-plugin-base@1 doctor --repos <五仓父目录>
```

| 仓 | README 文件 | 首次接入 | CI 挂载 | 该仓额外动作 |
| --- | --- | --- | --- | --- |
| deck | `README.md`、`package/README.md`、`docs/README.en.md` | `readme:init --all --repos` | 现有 `star-history.yml` / `thanks.yml` 加 sync 步骤 | 重新内联 `dist/client/index.js` 并提交（`inline-bundle-version`）；删除旧 `assets/contact-*.png` |
| palette | `README.md`、`package/README.md`、`docs/README.en.md` | 同上 | 同上 | `INLINE_PACKAGES`（runtime/client.ts）重新登记产物；星图从单图升双图 |
| im-companion | `README.md`、`docs/README.en.md` | 先修 `</div>>>>>>>> origin/master` 脏行，再 `readme:init --all` | 现有 `thanks.yml` 加 sync | 自绘二维码弹窗改 `base.openContactModal`，删旧样式/群码/i18n |
| prompt | `README.md`、`docs/README.en.md` | 同上 | 现有 `thanks.yml` 加 sync | 替换 `src/client/settings-links.ts` 的 `MORE_PLUGINS` 为 `<base.AuthorPlugins />` |
| ilife | `README.md` | 同上 | `ci.yml` 加 `schedule:` + sync 步骤（03 §2 ilife 特例） | 总管卡加入口 + 内联 base client；新增星图与 MORE 块；六 skill 不加独立入口 |

每仓完成后由仓主勾选：`readme:sync --check` 退出 0、`doctor` 全绿、四块 GitHub 观感符合规格、HUMAN-GATE 逐条确认。

## 5. 已知限制与待办（不属于本仓可自动完成的部分）

- 真实新群码尚未提供：生产 `latest` 仍是 0.0.1（微信群码 2026-10-30 过期，客户端降级为兜底链接）；拿到新码后按
  `npm run release -- --version 0.0.2 --image <新码> --repos <父目录>` 发 patch 即可，无需五仓发版。
- GitHub Actions 首次真实运行待各仓推送后观察（本仓未新增 workflow）。
- npmmirror 通道 403 是 cnpm 白名单政策，需要时可向 `cnpm/unpkg-white-list` 提 PR；客户端已回退 jsDelivr。
- npm staged publishing 有约 1.5 分钟审核延迟（0.0.1 实测），发布脚本已内置 registry 轮询。
- 规格票 00 的「完成」按钮由人点：本记录与票 13 关票只代表实施票 01–13 全部关闭，收口核对仍由规格详情页执行。

## 6. 证据索引

| 文件 | 内容 |
| --- | --- |
| `.tmp/final-acceptance.ps1` / `.tmp/acceptance-final.log` | 本次 7/7 自动验收脚本与日志 |
| `docs/base包-发布演练记录.md` | 两次真实发布演练、三通道耗时、jsDelivr 图片头、README 改写结果、HUMAN-GATE 清单 |
| `.tmp/drill-rewrite.log` / `.tmp/drill-before` / `.tmp/drill-repos` | README 全量同步演练日志与前后快照 |
| `.tmp/real-repos-baseline.json` | 五仓基线快照（HEAD + porcelain） |
| `.tmp/release-*.json` | 发布脚本每次运行的机器可读报告 |
| `.tmp/drill-init.log` / `.tmp/drill-sync.log` / `.tmp/drill-check.log` / `.tmp/drill-doctor.log` | 票 11 的 init/sync/check/doctor 演练输出 |
