# base 包最终验收记录

适用范围：规格 `.scratch/base-package/spec.md`（票 00），实施票 01–13。
验收时间：2026-10-31（Asia/Shanghai）；长期分支 `main`。第一轮交付提交 `1fd97558d83bd42664fbefc93c832fccff1180a3`（`feat/base-package` fast-forward 合入后删除）；评审后修复提交 `bb6db1f`；复评后收尾提交 `6755eae`（helper 收敛、剩余主题颜色令牌化、末尾换行补齐），本记录随其后单独提交，仅文档变更。三轮均已推送 `origin/main`。
结论：**自动部分 7/7 全绿**；`/code-review` 两轴 23 条发现与两轴复评的 12+11 条复核意见均已处置（修复 / 补测试 / ADR 记录 / 环境遗留说明，见 §1.1）；人工项（HUMAN-GATE）逐条列出，**待各仓仓主确认**，代理不自判。

## 1. 自动验收（7/7 PASS）

运行 `.tmp/final-acceptance.ps1`（最新日志 `.tmp/acceptance-round3.log`），结果 `RESULT: 7/7 checks passed`：

| 检查 | 命令 | 本次结果 |
| --- | --- | --- |
| typecheck | `npm run typecheck` | tsc clean |
| test | `npm test` | 306 passed / 6 skipped（24 个测试文件通过 + 1 个 network 文件默认 skip） |
| build | `npm run build` | build ok: core, client, node |
| three-entry-import | `node --input-type=module -e "import(...)"` | core=10 client=19 node=58 个导出，三入口均非空 |
| demo-build | `npm run build:demo` | demo/dist 构建成功 |
| packlist | `npm pack --dry-run --json` | files=34、size=284342；含 package.json / README.md / LICENSE / data/manifest.json / dist 三入口 |
| real-repos-unchanged | 运行前后对比五仓 HEAD + `git status --porcelain` | 5 repos unchanged during the run |

补充说明：

- `npm test` 里的 network 用例（`test/network/cdn-smoke.test.ts`）需要真实发布 + 网络，按规格默认 `describe.skipIf` 跳过；
  发布侧的真实证据见 `docs/base包-发布演练记录.md`。
- packlist 的 33 个文件全部来自 `dist/`、`data/`、README、LICENSE、package.json；发布包不含源码与测试。
- 上面是复评后收尾提交 `6755eae` 上的复跑结果（测试数由 280 → 305 → 306：新增 `test/qr-gate.test.ts`、client 清单体积上限与控件契约用例、release 顺序回归用例、样式令牌用例）。

### 1.1 评审后修复（第二轮，提交 `bb6db1f`）

`/code-review`（938787a→2a24072，Standards 12 条 + Spec 11 条）的发现逐条处置：

| 类别 | 处置 | 证据 |
| --- | --- | --- |
| 发布顺序缺陷（Spec） | `release.ts` 改为 `version` → `data`，清单与内联基线不再写旧版本；回归用例锁顺序 | `packages/base/scripts/release.ts`；`test/release.test.ts`（21 例，含「version must precede data」） |
| 客户端契约（Spec 5 条） | 纯图标 `ContactButton`（16px 线框 SVG、aria-label/title、6px 圆角、hover 令牌）；整行 `ContactRow`；`AuthorPlugins` 首帧基线后从共享 loader 静默替换；清单文本 512KB 上限；`dsh-base-ui-style` 与弹窗颜色令牌化 | `packages/base/src/client/{index,icons,styles,content}.ts`；`test/client/widgets.test.ts`（10 例）、`content.test.ts`（+4 例） |
| 星图策略（Spec） | palette/prompt 单主题资产只输出单张 `<img>`（不伪造双 source）；ilife 以资产存在为前置（缺资产跳过 + `doctor` 报 `star-assets`） | `src/node/{renderers,targets,doctor}.ts`；`test/readme-star-thanks-sync.test.ts`、`readme-targets.test.ts`、`doctor.test.ts` |
| 裁图门禁（Spec） | 纯 JS 定位图案检测替换固定 crops 框：紧裁 → 覆盖比 ≥0.9 → 白边 ≥4 模块 → ≥320px；重生成 `data/img` 与 `src/core/baseline.ts` | `packages/base/scripts/image.ts`；`test/qr-gate.test.ts`（10 例）、`test/data-chain.test.ts` |
| 文档纪律（Standards） | GLOSSARY 图名与「base 包」术语、F13「这是库，不是插件」首行声明、handover 01–03 与发布/回滚顺序说明 | `GLOSSARY.md`、`packages/base/README.md`、`docs/handover/*.md`、`docs/base包-发布与回滚.md` |
| Standards smells | `isRecord`/`pickText`/`takeFlagValue` 收敛为单一实现；`ReadmeSyncOptions extends BlockRenderOptions`；删除 `sortedPlugins`、`implementedBlockDefinitions`、死分支与死循环 | `src/core/index.ts`、`src/node/{cli,types,index,readme-compare,readme-sync}.ts` |
| 与规格有意的偏离 | 9 条决定记录成 ADR（doctor 检查多于四项、`contact:update` 不进发布包 CLI、发布前自动回滚/发布后 manual 等） | `docs/adr/0001-base-package-implementation-deviations.md` |
| 复评建议（第三轮） | 剩余主题颜色全部改读宿主令牌（过期卡 `state-warn-tertiary/secondary/label`、链接与复制确认 `alias-link`、hover 填充 `fill-tsp-secondary`）；`isRecord`/`pluginHref`/`takeFlagValue`/星图默认路径收敛为单一实现；删除 `ReadmeSyncOptions` 重复字段、星图硬编码常量与过期注释；29 个文件补末尾换行 | `packages/base/src/client/styles.ts`、`src/core/index.ts`、`src/node/{cli,renderers,targets,star-assets}.ts`；`test/client/widgets.test.ts`（新增令牌用例，共 99 例） |

## 2. 三份交接文档走查（票 13 验收第 1 条）

三份文档均以「各仓仓主照做即可」为标准写：步骤可复制、含常见失败与回退、明确执行者是仓主。目录入口 `docs/handover/README.md` 给出阅读顺序、最短命令路径、base 维护者与五仓仓主的职责边界。

| 文档 | 覆盖内容 | 失败/回退 | 结论 |
| --- | --- | --- | --- |
| `docs/handover/01-接入联系弹窗与推荐卡.md`（157 行） | 安装（钉精确版本）、`createBaseUI` 三行接入、选项表、组件 props（纯图标 `ContactButton` / 整行 `ContactRow`）、JSX 与 `createElement` 两套最小示例、逐仓落点表（槽位/入口/推荐卡/产物托管）、ilife 特例、旧实现逐仓清理清单 | §8 七类（构建链吃不下、多 React 实例、CSP、SSR、清单拉不到、临时换源、整体回退） | 通过：任一仓可独立完成接入 |
| `docs/handover/02-README四块迁移.md`（117 行） | 四块标记与渲染口径、星图资产前置条件（ilife 缺资产先补、palette/prompt 单图）、11 个目标文件表、每仓迁移步骤、逐文件 diff 预期（含 deck en 行删除、im 脏行、prompt Markdown 标题、ilife 新增块）、`--check` 四类错误 | §6 五类（缺旧块、脏行、标记外改动、整体回退、暂停某块） | 通过：任一仓可独立完成迁移 |
| `docs/handover/03-CI与发布.md`（156 行） | 主路径 `readme:sync --all --repos`、在已有 workflow 挂 sync（不新增 workflow）、ilife `ci.yml` 加 schedule 特例、`doctor` 检查项表（含 `copy-freshness` 与 `star-assets`）、发布侧一条命令（`version` 先于 `data`、含 `--image` 换码、回滚语义、真实演练数据）、凭据不落库 | §5 十二类失败（drift、缺标记、脏行、标记错误、npmmirror 403、unpkg 滞后、依赖版本、内联版本、cron 缺失、脏树、客户端缓存） | 通过：任一仓可独立照做 |

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
  （`2602f5d` → `6bad40c` → `0e63b25`，`.github/workflows/check.yml`、README 与 `docs/*` 改动）；im 的 `docs/research/*` 与 ilife 的 README/package.json/tooling
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
| palette | `README.md`、`package/README.md`、`docs/README.en.md` | 同上 | 同上 | `INLINE_PACKAGES`（runtime/client.ts）重新登记产物；星图保留单张主题中性图（`docs/star-history.svg`） |
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
- 规格票 00 的收口：实施票 01–13 全部关闭只是触发条件；按收口协议在规格票上留一段可独立复核的收尾评论并关闭（等价于规格详情页的「完成」动作）。本记录与票 13 关票不是完成证据。
- `/code-review` 两轴 23 条发现与两轴复评意见的处置见 §1.1（修复提交 `bb6db1f`、收尾提交 `6755eae`，均已推送 `origin/main`）；仍未关闭的只有 HUMAN-GATE 五项与上面列出的环境项。
- 本地分支 `ticket/11-sync-doctor`（`88f0948`）的实现已被 `5ff50de` 取代，未合并也未删除；按「丢弃改动前先征得同意」保留，需要清理时由仓主确认后删除。

## 6. 证据索引

| 文件 | 内容 |
| --- | --- |
| `.tmp/final-acceptance.ps1` / `.tmp/acceptance-final.log` | 第一轮 7/7 自动验收脚本与日志 |
| `.tmp/acceptance-round2.log` | 评审后修复提交上的 7/7 复跑日志 |
| `.tmp/acceptance-round3.log` | 复评后收尾提交 `6755eae` 上的 7/7 复跑日志 |
| `docs/adr/0001-base-package-implementation-deviations.md` | 评审后确认的 9 条有意偏离及理由 |
| `docs/base包-发布演练记录.md` | 两次真实发布演练、三通道耗时、jsDelivr 图片头、README 改写结果、HUMAN-GATE 清单 |
| `.tmp/drill-rewrite.log` / `.tmp/drill-before` / `.tmp/drill-repos` | README 全量同步演练日志与前后快照 |
| `.tmp/real-repos-baseline.json` | 五仓基线快照（HEAD + porcelain） |
| `packages/base/scripts/release.ts` | 发布脚本每次运行写 `.tmp/release-<version>.json` 机器可读报告（演练后未保留报告文件；耗时与通道结果见发布演练记录） |
| `.tmp/drill-init.log` / `.tmp/drill-sync.log` / `.tmp/drill-check.log` / `.tmp/drill-doctor.log` | 票 11 的 init/sync/check/doctor 演练输出 |
