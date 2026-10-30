# base 包发布演练记录

适用范围：`packages/base`（npm 包 `dsh-featherhunter-plugin-base`）。
对应票：`.scratch/base-package/issues/12-发布流水线与演练记录.md`（依赖 05 发布脚本、11 全量同步）。
记录时间：2026-10-31（Asia/Shanghai），npm 账号 `feather_wch`，仓库 `FeatherHunter/featherhunter-plugin-manage`。

本文件只记录**真实做过的事**：两次真实 npm 发布、三通道实际拉取、jsDelivr 精确版本图片响应头、
README 地址改写结果与失败回滚验证。未做的真机/人工步骤集中在 §6 HUMAN-GATE，不得当成已完成。

## 1. 时间线（npm registry 实际时间戳）

| 版本 | npm `time`（UTC） | 北京时间 | dist-tag | 用途 |
| --- | --- | --- | --- | --- |
| 0.0.0-stage | 2026-10-30T16:59:30.288Z | 10-31 00:59:30 | — | 占位/首发预检 |
| 0.0.1 | 2026-10-30T17:00:26.059Z | 10-31 01:00:26 | `latest` | 第一次真实发布（票 02） |
| 0.0.2-drill | 2026-10-30T17:19:27.622Z | 10-31 01:19:27 | `drill` | 换码演练（本票） |

核验命令：`npm view dsh-featherhunter-plugin-base time --json`、`npm view dsh-featherhunter-plugin-base dist-tags --json`。
演练后 `latest` 仍是 0.0.1，`drill` 指向 0.0.2-drill；生产默认安装路径没有被演练版本影响。

## 2. 演练一：0.0.1 首次真实发布

- 命令：`npm publish`（经 `packages/base` 的 prepublish 门禁：typecheck + test + build）。
- `npm view` 约 **1.5 分钟**可见（npm 账号启用了 staged publishing，需人工/自动批准后才进公开视图）。
- 三通道首次生效（T0 = 01:00:26）：

| 通道 | 首次生效 | 证据 | 备注 |
| --- | --- | --- | --- |
| unpkg `@latest` | **约 5m14s**（01:05:40 首次返回 0.0.1） | `.tmp/cdn-poll2.log`（01:01:51–01:26:14 轮询，首行仍是 0.0.0-stage） | 与 `docs/handover/03-CI与发布.md` §4 记录一致 |
| jsDelivr `@latest` | **约 2m07s** | `docs/handover/03-CI与发布.md` §4 | 客户端回源首选 |
| npmmirror | **未生效（HTTP 403）** | `https://registry.npmmirror.com/dsh-featherhunter-plugin-base/latest/files/data/manifest.json` 返回 `not allow to unpkg files` | cnpm 白名单不代理本包文件；客户端按设计回退 jsDelivr |

- 清单内容（unpkg 与 jsDelivr 一致）：`version 0.0.1`、`revision 1`、`updatedAt 2026-10-23T00:00:00+08:00`；
  微信群 `card-wechat-2026-10-23.png` / `qr-wechat-2026-10-23.png`、`validUntil 2026-10-30`（演练时已过期，正好验证降级路径）。
- jsDelivr 精确版本图片：`@0.0.1/data/img/card-feishu.png` → **200**、`content-type: image/png`、
  `cache-control: public, max-age=31536000, s-maxage=31536000, immutable`、12292 B。
- README 同步：`readme:sync --all` 覆盖 11 个文件，二次运行零 diff（票 11 的 10 个测试用例已固化）。

## 3. 演练二：0.0.2-drill 换码

目的：验证「发布带真实清单的版本 → 换一张微码图 → 再发 patch/预发布 → 同一客户端拉到新清单与新日期图片 →
README 地址改写」整条链路，同时不污染 `latest`。

> 诚实说明：演练用本地复制的图（旧二维码改名成 2026-11-06）模拟「换一张微码图」，**不是**真实可扫的新码；
> 真实换码需要人提供新截图后跑同一条命令，再用 §6 的真机步骤验收。演练目的是验证流水线与 CDN 链路，不是验证群码本身。

换码内容（`contact/groups.json` → `data/manifest.json`，其余群不变）：

| 字段 | 0.0.1 | 0.0.2-drill |
| --- | --- | --- |
| wechat card | `card-wechat-2026-10-23.png` | `card-wechat-2026-11-06.png` |
| wechat qr | `qr-wechat-2026-10-23.png` | `qr-wechat-2026-11-06.png` |
| `validUntil` | 2026-10-30 | 2026-11-06 |
| `updatedAt` | 2026-10-23T00:00:00+08:00 | 2026-10-31T00:00:00+08:00 |
| `revision` | 1 | 2 |

发布：`--tag drill`（`npm publish --tag drill`），01:19:27 完成。

- 三通道清单：unpkg `@0.0.2-drill` **247ms** 返回 200（revision 2、wechat 2026-11-06、validUntil 2026-11-06）；
  jsDelivr `@0.0.2-drill` **914ms** 返回同内容；npmmirror 仍 403（同 §2 白名单原因）。
- jsDelivr 精确版本图片：`@0.0.2-drill/data/img/qr-wechat-2026-11-06.png` → **200**、image/png、
  长缓存 immutable、10857 B；`card-wechat-2026-11-06.png` → 200、16282 B；unpkg 同一张图 200、10857 B。
- 真实客户端：内置基线（飞书 + QQ）先渲染；回源拿到 0.0.2-drill 清单后，弹窗在 **154ms** 内从
  「已过期」切到「11 月 6 日前有效」，微信群卡片换成新日期图片（见 `docs/handover/03-CI与发布.md` §4）。

### 3.1 README 地址改写（本次复跑，用 npm 上真实 0.0.2-drill 清单驱动）

1. 从 unpkg 拉真实 `@0.0.2-drill/data/manifest.json`，临时替换 `packages/base/data/manifest.json` 后重新 `build`
   （只影响本地 dist/data；0.0.1 清单另存 `.tmp/manifest-0.0.1.json`，演练后已恢复）。
2. 在五仓 README 副本 `.tmp/drill-repos`（票 11 的演练树，11 个 README 均带托管标记）上执行：

   ```sh
   node packages/base/dist/node/cli.js readme:sync --all --repos .tmp/drill-repos
   ```

3. 结果：**10/11 个文件被改写**（deck 3、palette 3、prompt 2、im 1、ilife 1），每个文件只改 contact 块 1 行：

   ```diff
   -...@0.0.1/data/img/card-wechat-2026-10-23.png?v=20261023...
   +...@0.0.2-drill/data/img/card-wechat-2026-11-06.png?v=20261106...
   ```

   飞书/QQ 卡片同步改为 `@0.0.2-drill`；star 历史块保持 README 里已有的 12 位版本戳（`?v=202610300000`），
   符合「README 版本优先、缺失才用 manifest.updatedAt」的约定。
4. 唯一失败：`dsh-im-companion/README.md:262` 有 `>>>>>>> origin/master` 冲突残留，工具按设计拒绝改写、
   报错并退出 1（其余 10 个文件照常写入）；仓主修掉该行后重跑即可。原始/结果快照在
   `.tmp/drill-before/` 与 `.tmp/drill-repos/`，日志在 `.tmp/drill-rewrite.log`。
5. 恢复：`packages/base/data/manifest.json` 已恢复为 0.0.1 并重新 build，`git status` 干净。

## 4. 一条命令完成换码 + 发版（票 05 脚本 + 本票扩展）

```sh
cd packages/base
npm run release -- --version 0.0.2 --tag latest --image <新二维码截图> --repos <五仓父目录>
```

- 步骤顺序：preflight → worktree（脏树拒跑）→ **contact**（`--image` 时先跑 `contact:update --confirmed --no-build`）
  → data（build:data + data:check）→ version（`npm version --no-git-tag-version`）→ typecheck/test/build →
  pack → publish（`npm publish <tgz> --tag`）→ registry 轮询 → jsDelivr（必需）/ unpkg / npmmirror（best effort）
  → readme:sync --all --repos → readme --check → 报告写 `.tmp/release-<version>.json`。
- `--dry-run --image <png>` 会以 `contact-update --dry-run` 校验图片并打印计划，不写任何文件。
- 失败回滚：发布前失败 → 逐 `RELEASE_PATHS` `git checkout`，`--image` 时额外 `git clean -fdq -- contact`
  清掉新增的日期图片，并删除 `.tgz`；发布后失败 → `manual`（按 `docs/base包-发布与回滚.md` §5 走 deprecate/patch）。
- 覆盖测试：`packages/base/test/release.test.ts`（20 例，含 contact 步骤成功/失败回滚/dry-run、脏树、发布前门禁失败、
  publish 报错但 registry 可见、CDN 超时、skip-publish/skip-tests）。

## 5. 旧路径退役与「不新增 workflow」

- 提交 `950067c` 删除 `scripts/sync-contact.cjs`（186 行）并更新 `GLOSSARY.md`；
  现在仓库里写 README 的路径只剩 `packages/base` 的 `readme:init` / `readme:sync` 一条。
- 本仓根目录没有 `.github/workflows`（`glob` 为空），本票未新增任何 workflow 文件。
- ilife 的定时挂载写在 `docs/handover/03-CI与发布.md`（在它现有的 `ci.yml` 里加 `schedule:` 触发
  `npx dsh-featherhunter-plugin-base@latest readme:sync --all --repos .`），不在本仓新增 workflow。

## 6. HUMAN-GATE（机器不可代劳，交付时必须由人确认）

| # | 步骤 | 为什么必须人做 |
| --- | --- | --- |
| 1 | 用手机微信扫 0.0.2-drill 里的新二维码，确认能入群 | 只有真人能验证群码有效 |
| 2 | 在真实浏览器打开设置面板，看弹窗图片与「11 月 6 日前有效」文案 | 依赖宿主渲染与 CDN 实网 |
| 3 | 在 GitHub 网页看五仓 README 的 contact/star/thanks/MORE 四块实际渲染 | 需要真实仓库推送后的页面 |
| 4 | 在真实宿主（deck/palette/im/prompt/ilife 之一）构建链里安装本包并点开弹窗 | 需要宿主工程与打包器 |
| 5 | 中国大陆网络实测 unpkg/jsDelivr/npmmirror 三通道与图片加载 | 本地代理环境不代表用户网络 |

以上 5 项在 `.scratch/base-package/issues/13-最终验收与交接.md` 里作为交付清单保留，未勾选即不算验收完成。

## 7. 证据文件索引

| 文件 | 内容 |
| --- | --- |
| `.tmp/cdn-poll2.log` | 0.0.1 发布后 01:01:51–01:26:14 的三通道轮询原文（unpkg 首次 0.0.1 在 01:05:40） |
| `.tmp/drill-rewrite.log` | 用真实 0.0.2-drill 清单跑 readme:sync 的 10 成功 + 1 脏行报错输出 |
| `.tmp/drill-before/` / `.tmp/drill-repos/` | README 改写前/后快照（11 个文件） |
| `.tmp/manifest-0.0.1.json` | 演练前保存的 0.0.1 清单（已恢复回 `packages/base/data/manifest.json`） |
| `.tmp/fetch-images.mjs` | jsDelivr/unpkg 精确版本图片状态码、content-type、cache-control、字节数 |
| `.tmp/release-<version>.json` | 发布脚本每次运行的机器可读报告（成功时生成） |
