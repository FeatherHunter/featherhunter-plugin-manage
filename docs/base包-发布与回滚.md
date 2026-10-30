# base 包发布与回滚

适用范围：`packages/base`（npm 包 `dsh-featherhunter-plugin-base`）。
对应票：`.scratch/base-package/issues/02-首次真实发布与三通道冒烟.md`。

## 0. 结论速览

| 动作 | 命令 |
| --- | --- |
| 发布 | `cd packages/base && npm publish --access public` |
| 一条命令发布（含换码与 README 同步） | `cd packages/base && npm run release -- --version <x.y.z> --tag latest --image <新码截图> --repos <五仓父目录>` |
| 三通道冒烟 | `npm run test:network`（默认不进常规测试，需要网络与真实发布） |
| 72 小时内回滚 | `npm unpublish dsh-featherhunter-plugin-base@<version>` |
| 超过 72 小时回滚 | `npm deprecate dsh-featherhunter-plugin-base@<version> "<原因>"` + 发补丁版本 |
| 凭据 | 交互式 `npm login`；token 只在用户级 `~/.npmrc` 或 CI secret 里，**永不进仓库** |

## 1. 前置条件

- Node >= 18、npm >= 9（`engines` 要求）。
- 账号是包 owner/member：`npm owner ls dsh-featherhunter-plugin-base`。
- 已登录：`npm whoami` 应返回账号名。
- 网络能到 `registry.npmjs.org`（发布必需）。三条 CDN 通道（unpkg / npmmirror / jsDelivr）的可达性单独测。

## 2. 发布前检查

```sh
cd packages/base
npm ci
npm run build:data        # contact/ 源数据 -> data/manifest.json + data/img/ + src/core/baseline.ts
npm run data:check        # 确认生成物与源数据一致（无漂移）
npm run typecheck
npm test                  # 常规测试，网络用例默认跳过
npm run build
npm pack --dry-run        # 核对 files 清单：dist/ data/ README.md LICENSE
npm view dsh-featherhunter-plugin-base version   # 线上当前版本
```

版本号按语义化推进：

- 只更新数据（换码、改有效期、改文案）→ **patch**
- 客户端行为变化（新增控件、交互调整）→ **minor**
- 破坏性接口变化 → **major**

`prepublishOnly` 会自动执行 `typecheck && test && build`，所以不要在发布前跳过构建。

## 3. 发布

```sh
cd packages/base
npm publish --access public
```

- 包名没有 scope，`--access public` 可省略，但显式写上更稳。
- 账号开了 2FA 时按提示输入一次性密码；CI 用 automation token 或 `--otp`。
- 发布成功后记下时间 **T0**，用于计算三通道首次生效耗时（见 §4）。
- 发布前确认工作区干净：`git status --short` 不应有凭据文件（`.npmrc` 已在根 `.gitignore` 中忽略）。

## 4. 三通道冒烟（手动用例）

自动方式（推荐，可重复执行）：

```sh
cd packages/base
npm run test:network
# 想留一份耗时报告：
DSH_BASE_CDN_SMOKE_REPORT=.tmp/cdn-smoke.json npm run test:network
```

- 用例文件：`test/network/cdn-smoke.test.ts`，默认 `describe.skipIf` 跳过，不进 CI。
- 环境变量：`DSH_BASE_CDN_SMOKE_TIMEOUT_MS`（每条通道轮询上限，默认 300000）、`DSH_BASE_CDN_SMOKE_POLL_MS`（轮询间隔，默认 5000）。
- 它检查：`npm view` 能看到版本与 `files`；三通道 `@latest` 清单 200 且 `version` 等于本地版本且能通过 `parseManifest`；jsDelivr 精确版本图片 200、`content-type: image/*`、`cache-control` 带长 `max-age`。

手动方式（PowerShell，便于现场排查）：

```powershell
$v = (Get-Content package.json | ConvertFrom-Json).version
curl.exe -sS -L "https://unpkg.com/dsh-featherhunter-plugin-base@latest/data/manifest.json"
curl.exe -sS -L "https://registry.npmmirror.com/dsh-featherhunter-plugin-base/latest/files/data/manifest.json"
curl.exe -sS -L "https://cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base@latest/data/manifest.json"
curl.exe -sS -I  "https://cdn.jsdelivr.net/npm/dsh-featherhunter-plugin-base@$v/data/img/card-feishu.png"
```

预期：三份 JSON 的 `version` 都是刚发布的版本；jsDelivr 图片响应头 `content-type: image/png`，`cache-control` 含 `max-age`（精确版本 URL 不可变，属长缓存）。

### 首次生效耗时记录

发布后立即开始计时，各通道第一次返回新版本的时刻记入下表（票 02 验收要求）。

| 版本 | 通道 | 首次生效耗时 | 验证时间 | 备注 |
| --- | --- | --- | --- | --- |
| 0.0.1 | unpkg | 约 5m14s（01:05:40 首次可见） | 2026-10-31 01:05:40 | 轮询原文 `.tmp/cdn-poll2.log`；npm 可见约 1.5 分钟（staged publishing） |
| 0.0.1 | npmmirror | 未生效（HTTP 403） | 2026-10-31 01:26 | 返回 `not allow to unpkg files`：cnpm 白名单不代理本包，客户端回退 jsDelivr |
| 0.0.1 | jsDelivr | 约 2m07s | 2026-10-31 01:02 前后 | 客户端回源首选通道 |

> 2026-10-31 另有一次换码预发布 `0.0.2-drill`（`--tag drill`，不覆盖 `latest`）：unpkg 247ms、jsDelivr 914ms 即返回新清单，
> 精确版本图片 200 且长缓存。完整记录见 `docs/base包-发布演练记录.md`。

> 经验值：unpkg 与 jsDelivr 在发布后通常 1–5 分钟可见；npmmirror 走同步任务，可能更慢。CDN 缓存对 `@latest` 有短期缓存，用精确版本 URL 可立即验证发布是否成功。

## 5. 回滚

**72 小时内**（npm 允许撤回）：`npm unpublish dsh-featherhunter-plugin-base@<version>`。
注意：撤回会改变包的历史，只在必须时使用；撤回后 `@latest` 会回到上一个版本。

**超过 72 小时**（npm 不允许撤回）：`npm deprecate dsh-featherhunter-plugin-base@<version> "<原因>"`，然后发补丁版本修正。`deprecate` 只是给安装者警告，不改变可安装性。

**数据回滚**：`git revert` 数据提交 → `npm run build:data` → 发新的 patch 版本。

**README 回滚**：README 里图片 URL 钉精确版本（`@<version>`），把版本号改回旧值并重新同步即可（渲染器与同步命令见票 08/11）；旧版本图片在 CDN 上仍然可用（不可变 URL）。

**顺序建议**：先 `deprecate`（立刻减少新装用户受影响）→ 再发修复版本 → 最后视情况 `unpublish`。

## 6. 凭据管理（不落库）

- 交互式 `npm login`：token 存在用户目录的 `~/.npmrc`，不在仓库内。
- CI / 自动化：token 放 secret（如 GitHub Actions 的 `NPM_TOKEN`），仓库只提交模板：
  ```
  //registry.npmjs.org/:_authToken=${NPM_TOKEN}
  ```
- 发布前自查：`git check-ignore -v .npmrc` 应命中忽略规则；`git status` 不应出现 `.npmrc`、`.env`、token 文件。
- 团队协作：用 `npm owner add` / `npm access` 授权成员，不共享 token。

## 7. 常见失败

| 现象 | 处理 |
| --- | --- |
| `EOTP` | 输入 2FA 验证码；CI 用 automation token |
| `EPUBLISHCONFLICT` | 该版本已存在，改版本号 |
| `E403 must be logged in` | `npm whoami` 检查，重新 `npm login` |
| `ECONNRESET` / TLS handshake 失败 | 网络/代理问题，换出口重试 |
| CDN 404 | 等传播（unpkg/jsDelivr 1–5 分钟；npmmirror 更慢），并确认 URL 里版本正确 |
| 发布体积异常 | `npm pack --dry-run` 检查 `files`；dist 未构建会被漏掉 |
| 安装后 `data/manifest.json` 缺失 | 检查 `files` 是否含 `data`，重新发布 |

## 8. 首次发布记录（票 02）

| 项目 | 结果 |
| --- | --- |
| 版本 | 0.0.1 |
| 发布时间 | 2026-10-31 01:00:26（Asia/Shanghai；npm `time` = 2026-10-30T17:00:26.059Z） |
| `npm view` 版本/files | `version` → 0.0.1；`files` = dist/ data/ README.md LICENSE（`npm pack` 报告 30 files / 308654 B） |
| unpkg / npmmirror / jsDelivr | unpkg 200（revision 1、updatedAt 2026-10-23、wechat validUntil 2026-10-30）；npmmirror 403（白名单）；jsDelivr 200（同清单） |
| jsDelivr 精确版本图片缓存头 | `@0.0.1/data/img/card-feishu.png` → 200、image/png、`cache-control: public, max-age=31536000, s-maxage=31536000, immutable`、12292 B |

## 9. 换码演练（0.0.2-drill）

2026-10-31 01:19:27 以 `--tag drill` 发布 `0.0.2-drill`：微信卡片/二维码换成 2026-11-06 版本、
`validUntil` 与 `updatedAt` 同步推进，`latest` 保持 0.0.1。三通道清单、精确版本图片、
真实客户端 154ms 切换、README 地址改写（10/11 文件，im 根 README 因冲突残留按设计拒绝）与 HUMAN-GATE
清单见 `docs/base包-发布演练记录.md`。
