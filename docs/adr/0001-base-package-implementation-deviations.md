# ADR-0001 base 包实现与规格字面不一致处的裁决

- 状态：已接受（2026-10-31，base 包实现收口时补记）
- 相关：`.scratch/base-package/spec.md`、`docs/base包-对抗式审查.md`、`docs/base包-最终验收记录.md`

## 背景

base 包按 `.scratch/base-package/spec.md` 实现并已合入 `main`。实现过程中有若干处**规格字面写法与实际约束冲突**，或规格只写了目标而没写手段。这些选择不是随手偏离：每一处都保留在代码与测试里，但需要一个集中记录，避免后来者把它们当成 bug 重新「修回去」，也避免下次评审再次把它们当成未说明的越界。

本 ADR 记录的是**与规格字面不一致、且不会改回去**的决定；规格内明确要求的行为（联系弹窗、四块 README、CDN 分发、裁图门禁、doctor 门禁等）不在此列。

## 决定

### 1. palette / prompt 的星图保持单张 `<img>`，不强行输出深浅双 `<source>`

规格 §6 要求「统一 `<picture>` 深浅双图」。但 palette / prompt 仓内只有一张 `docs/star-history.svg`，两套主题共用；若按字面输出两个指向**同一个文件**的 `<source>`，只是形似双图，语义上是假的。

决定：`renderStarHistoryBlock` 在 dark / light 解析后 URL 相同时只输出单张 `<img>`（`packages/base/src/node/renderers.ts` 的 `dark === light` 分支），其余仓仍输出 `<picture>`。内容等价口径下 palette / prompt 的 diff 为空（`test/star-history-render.test.ts`），单图行为由 `test/readme-star-thanks-sync.test.ts` 锁住。将来某仓真的产出两套主题图，只改 `targets.ts` 的 `star.darkPath` / `star.lightPath` 即可，不需要改渲染器。

### 2. ilife 的星图块以「仓内资产存在」为前置条件，缺失时跳过并让 doctor 报错

规格 §6 写「ilife 补上」星图。但星图 SVG 由**各仓自己的** star-history 生成流程产出（`star-history.json` → SVG + 定时 workflow），base 包只负责渲染 URL；规格 §8 又规定本次不改五仓（P-F）。base 包无法凭空生成 ilife 的图，写死路径只会得到坏图。

决定：`resolveTarget` 只在 `docs/star-history-{dark,light}.svg`（palette/prompt 为单张 `star-history.svg`）都存在时才挂 `starHistory`；缺失时该块 `skipped`，README 不写入坏地址。`doctor` 增加逐仓 `star-assets` 检查，失败信息指向 `docs/handover/02-README四块迁移.md` 的前置条件段。ilife 的补图动作留给仓主，在交接文档里作为第一步。

### 3. 二维码裁图门禁用纯 JS 的定位图案几何检测，不引入 OpenCV，也不尝试解码

规格 §10 要求裁图自动门禁「检测包围盒 → 裁图 → 再检测覆盖比 ≥0.9 → 白边外扩 ≥4 模块 → 输出 ≥320px 方形」。规格同时要求**零运行时依赖**，且 F2 已实测 QQ/微信风格码无法被开源解码器解出，不能把「解码成功」当门禁。

决定：`packages/base/scripts/image.ts` 用纯 JS 实现定位图案检测（灰度 → Otsu → 行 RLE → 1:1:3:1:1 五段扫描 → 聚类 → 左上/右上/左下三角判定 → 模块尺寸与包围盒），再走紧裁、二次检测覆盖比、白边外扩、320px 输出。原「固定 crops 框 + 亮度标准差」门禁被替换：实测现有整卡按固定框裁出的白边只有 0.08~2.1 个模块，不满足 ≥4，必须按检测结果紧裁再补白边。`contact:update` 与 `build:data` 共用同一门禁，测试见 `test/qr-gate.test.ts` 与 `test/data-chain.test.ts`。

### 4. doctor 的检查项多于规格 §7 的四项

规格 §7 列的是「依赖声明版本 / 内联产物版本 / 四块一致性 / 图片地址版本」四项**逐仓**检查。实现额外提供：

- 全局：`package-version`、`data-freshness`（清单版本 == 包版本）、`copy-freshness`（推荐文案 `verifiedAt` ≤ 90 天，用户故事 29）、`remote-manifest`（unpkg → jsDelivr 可达，用户故事 26）；
- 逐仓：`cron-mounts`（用户故事 37：不新增 workflow、挂现有 workflow，doctor 要能回答「哪个仓没挂」）、`star-assets`（本 ADR 第 2 条）。

决定：保留这些检查。它们是用户故事 26/29/36/37 的可执行出口，且都只是只读观测；失败只影响 `doctor` 退出码，不改变任何仓的文件。

### 5. `contact:update` 不在发布包的 CLI 里执行，只从源码仓用 `npm run` 跑

规格 §10 的 CLI 接缝要求在临时目录跑 `contact:update`。该命令依赖 `pngjs` / `jpeg-js` 解码源图，而发布包是零运行时依赖、node bundle 只允许 `node:` 内建，无法把图像工具打进 dist。

决定：dist CLI 的 `contact:update` 明确提示「只在源码仓可用」并退出 2，指路 `npm run contact:update -- <image> [--group id] [--confirmed]`；源码仓入口（`scripts/contact-update.ts`）保留完整能力，验收测试在 `test/data-chain.test.ts` 与 `test/qr-gate.test.ts` 里覆盖真实临时目录流程。

### 6. `AuthorPlugins` 挂载时读共享 loader，而不是完全「不发请求」

规格 §4 写「纯展示：不发请求」，同一段又写「清单没到时先渲染内置 5 条基线，到货后静默替换」。字面上两者矛盾：没有请求就不会「到货」。

决定：组件**不发起独立请求**，挂载时调用 `getLoader().load()`——与 `preloadContent`、联系弹窗共用同一个 loader（30 分钟缓存 + inFlight 去重），宿主若已预热则零网络请求；显式传入 `props.plugins` 时完全不碰 loader。首帧永远是基线，失败/超时静默保留基线。测试见 `test/client/widgets.test.ts`。

### 7. 发布流水线把 `version` 排在 `data` 之前

规格 §10 与票 12 只要求「一条命令、任一步失败可回滚」，没有规定步骤顺序。实现最初把 `build:data` 放在 `npm version` 之前，结果清单与内联基线写入的是**旧版本号**，发布后的 `registry` 轮询永远等不到目标版本，被判 `manual` 回滚——这是评审发现的真实缺陷。

决定：顺序固定为 `contact → version → data → gates → pack → publish → registry → CDN → readme`（`packages/base/scripts/release.ts`）。`data` 必须在 `version` 之后，因为 `build-data.ts` 读 `package.json` 的版本写清单与基线。`test/release.test.ts` 有一例专门锁这个不变量（旧顺序下该测试失败）。

### 8. 发布前失败自动回滚，发布后失败标 manual

规格票 12 要求「任一步失败可回滚」，但 npm 版本不可变，发布后不可能真正回滚。

决定：发布前失败逐 `RELEASE_PATHS` `git checkout`（`--image` 时额外 `git clean -fdq -- contact` 清新增日期图），报告 `rollback: "rolled-back"`；发布后失败报告 `rollback: "manual"`，人工按 `docs/base包-发布与回滚.md` §5 走 `npm deprecate` 或补丁版本。这是「可回滚」在 npm 语义下能做到的最强承诺。

### 9. 清单文本本身也受 512KB 上限约束

规格 §5 的安全校验写「512KB」，评审时只发现图片有上限、清单文本没有。决定：`content.ts` 的 `MAX_MANIFEST_BYTES = 512 * 1024` 同时约束清单文本——先看 `content-length`，再按 UTF-8 实际字节校验，超限走下一通道/回退基线（`test/client/content.test.ts` 4 例，含「header 撒谎」用例）。

## 影响

- 这些决定都已写进代码、测试或交接文档；回退其中任何一条都会改变对外行为，需要新 ADR 覆盖本文件。
- `docs/base包-最终验收记录.md` 的「已知限制」与「HUMAN-GATE」按本 ADR 的口径描述，不再把上述条目列为缺陷。
