<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-BLOCKED-BY: 01 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-3dfe583f-5977919 -->
<!-- DSH-CREATED: 2026-10-30T15:56:52.258Z -->
# 07: README 现状 fixture 与等价口径

**What to build:** 只读提取五个插件仓共 11 个 README 文件里的四个区块（联系区、星图区、致谢区、作者其他作品区）现状，存成测试基准；实现规范化比较器（忽略白空格、属性顺序、单双引号）并给出「内容等价」判定：成员集合、链接目标、表头/标题/alt 文字、图片宽度、致谢表数据一致即通过；把各仓允许的形态差异写成清单；把可疑结构（已知至少一处合并冲突残留脏行）标成必须人工处理。此票不修改任何外部仓库文件。

**Blocked by:** 01

**Status:** resolved

- [x] 11 个文件的四块全部提取成功，缺失块记为 null 并标注（ilife 星图、MORE 缺失属已知）
- [x] 比较器对等价/不等价样例判定正确，且能区分「内容差异」与「纯格式差异」
- [x] 形态差异清单成文：星图 4 形态、MORE 标题 3 形态与 6 种顺序、联系区 2 变体、图片 3 种相对前缀
- [x] 脏行被识别为必须停手项，提取阶段不修改五仓任何文件

## Comments

### local — 2026-10-30T16:42:05.522Z
fixture 与比较器全部满足：11 文件四块提取（ilife 两处缺失记入 missingBlocks）、内容/格式差异可区分、形态差异清单成文、脏行识别为停手项、五仓零改动；已 merge（a96f223），全仓 92 测试全绿。

## 进度

## 结果

- 提交 7a14c04（分支 ticket/07-readme-fixtures），已 merge 进集成分支 feat/base-package（a96f223）；比较器经 src/node/index.ts 重新导出（ef008f3）。
- 交付：src/node/readme-compare.ts（961 行，零 import 单文件：locateReadmeBlocks/findSuspiciousLines/parseContactBlock/parseStarHistoryBlock/parseThanksBlock/parseMoreBlock/parseHeading/canonicalizeMarkup/compareBlocks/compareReadmeBlocks + 全套类型）、test/readme-compare.test.ts（43 测试 = 31 合成 + 12 fixture 回归）、test/fixtures/readme-blocks.json（11 文件 × 4 块，42 非空 + meta.missingBlocks ["ilife.star-history","ilife.more"]，raw+parsed+sha256+suspicious）、test/fixtures/extract-readme-fixtures.mjs（只读生成器，README_SOURCE_ROOT 可覆盖）、docs/base包-readme现状与形态差异.md（304 行）。
- 验证：worktree 内 typecheck exit 0、npm test 51/51、build ok；合并后全仓 typecheck/build/test 全绿（92/92）。
- 偏差如实记录：图片相对前缀实测为 4 种（assets/、../assets/、assets/readme/、../assets/readme/）+ deck/package 的 GitHub 绝对 URL 1 种，文档按 5 类记录（规格原记 3 种）；dsh-im-companion/README.md:262 的 </div>>>>>>>> origin/master 被识别为 merge-conflict-residue 脏行，readme:init/sync 必须停手，迁移前需人工修复；旧 fixture 作为迁移前基线，迁移票（08/09/10）建议用 manifest 渲染结果作 expected 做内容等价硬校验，旧 fixture 只做现状清单与有意差异报告。
