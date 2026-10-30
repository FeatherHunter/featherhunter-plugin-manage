# base 包与联系弹窗 — 方案（已对齐）

> 状态：方向已定，等待用户执行 /to-spec 生成规格 issue。
> 约束：**不修改其余五个插件的仓库代码**；五仓需要做的事一律写成交接文档。
> 决策：D1-B（微信码运行时远程取）、D2-A（代码放当前工作区，用户自建仓库）、D3-B（一次性做完三块）、D4-A（SVG 图标按钮）。

## 0. 一句话

把「联系区」从五份手工复制的 README 片段，改成 **一份数据 + 两个渲染器 + 一条发布通道**；设置面板里的 SVG 按钮与弹窗只是这份数据在浏览器侧的第二个出口。

## 1. 为什么这样切（第一性原理）

1. **变化频率不同的东西不绑在同一次发布里。** 代码（月级）、群与二维码（周级）、星标与贡献者（天级）。现在三者都塞在 README 与五个仓里，导致换一张微信码要五个仓提交、改一句欢迎语要动五个文件。
2. **一份数据，多个渲染出口。** 联系区内容 = 群组数据 + 文案 + 列序规则 + 有效期规则。README 是 Markdown 渲染，弹窗是 DOM 渲染，两者必须同源。
3. **复用靠版本与传播链，不靠复制源码。** 包会被内联进五个插件的构建产物，包本身传播不动，必须配发布链。
4. **依赖只能由每个插件自带。** 不能让用户「先装一个联系人插件，其他插件就有弹窗」——没装的那个会没有功能。必须是编译期依赖。

## 2. 决策记录

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| D1 | 微信群码周更 | **B**：常驻两码内置，微信码打开弹窗时远程取；取不到给兜底链接 |
| D2 | 代码位置 | **A**：当前工作区（manage）新增 `packages/base`，用户自建 GitHub 仓库并发布 |
| D3 | 交付范围 | **B**：一次性做完「弹窗 + 联系区 + 星图 + 致谢」四块工具 |
| D4 | 入口形态 | **A**：SVG 图标按钮（aria-label「联系我们」），点击开弹窗 |
| C1 | 五仓改动 | 一律不碰；只产出包 + 交接文档 |
| C2 | 包的技术形态 | 单包三入口 `./core` `./client` `./node`，纯 ESM、零运行时依赖、不 import React（注入 createElement） |
| C3 | 弹层 | 原生 `<dialog>.showModal()`，不用 portal / z-index / 自绘遮罩 |
| C4 | 视觉 | 沿用 README 联系区语言（CONNECT / 反馈与联系、欢迎语、三列、细竖线）；颜色走宿主主题令牌 |
| C5 | 文案 | 内置 zh/en，调用方传 `lang`，缺省读宿主界面语言 |
| C6 | README 三块 | 统一由 `./node` 渲染；联系区/星图新增标记注释，致谢沿用现有标记 |
| C7 | 传播 | 一条命令改版本 + 五仓 PR 清单；每仓 CI 加 `doctor` 门禁；不做运行时自更新 |
| C8 | 测试 | vitest + jsdom；README 渲染用「五仓现状字节级快照」回归 |
| C9 | 群数量 | 数据驱动（群组数组）；弹窗/README 每行最多 3 列换行；远程可追加不可删除 |

## 3. 数据放哪（唯一真源）

`contact/` 是唯一真源。**群是数组，不是写死的三张卡**：

```
contact/
  manifest.json              # 远程清单：只描述变化（图片 / 有效期 / 角注）
  feishu.png                 # 常驻码（内置进包）
  qq.png                     # 常驻码（内置进包）
  wechat-2026-10-30.png      # 周更码，文件名带日期
```

群组条目（`./core` 的类型，也是调用方唯一需要理解的东西）：

| 字段 | 作用 |
| --- | --- |
| `id` | 稳定标识，远程清单按它覆盖；不许重复 |
| `platform` | 平台标签，自由字符串（内置 feishu / qq / wechat） |
| `title` | 卡头标题，如「飞书群（主）」 |
| `subtitle` | 可选，群号 / 组织名 |
| `qr` | 图片来源：`bundled`（包内资源键）/ `remote`（清单相对路径）/ `url`（https 白名单） |
| `note` | 可选静态角注，如「该二维码永久有效」 |
| `validUntil` | 可选 `YYYY-MM-DD`；有值则动态拼有效期并做过期判断 |
| `order` | 可选排序；缺省按数组顺序 |

manifest 只写变化：

```json
{
  "schema": 2,
  "updatedAt": "2026-10-30T14:00:00+08:00",
  "groups": [
    { "id": "wechat",
      "qr": { "kind": "remote", "path": "wechat-2026-10-30.png" },
      "validUntil": "2026-11-06" }
  ]
}
```

合并规则（弹窗与 README 渲染器共用同一函数）：

1. **内置基线**：包里自带三个群（飞书 / QQ / 微信），远程永远删不掉；
2. **按 id 覆盖**：清单条目只替换该群提供的字段（图片、有效期、角注）；
3. **按 id 追加**：清单出现新 id 就往末尾加一张卡（前提是 `qr` 为 `remote` / `url`，内置资源键不能凭空新增）；
4. **整份降级**：清单损坏、结构不合法、取不到 → 整份忽略，回到内置基线。

## 4. 扩展性：3 个群 → N 个群

需求里明确可能变成五个群五个码，所以渲染层**不认识具体平台，只认识群组数组**。

| 关注点 | 规则 |
| --- | --- |
| 加一个群 | 改数据：加一条群组条目（或写进远程清单），不改代码、不发版（远程群）；常驻图要内置则随包发版 |
| 弹窗列布局 | 桌面每行最多 3 列，超出换行（5 个群 = 3+2）；窄屏降 1 列；不做横向滚动 |
| README 列布局 | 同一规则：`<table>` 每行最多 3 个 `<td>`，列宽 260，5 个群渲染成两行，不挤爆 GitHub 版心 |
| 有效期 | 按群独立，多个周更群互不影响 |
| 排序 | 显式 `order` 优先，缺省按数组顺序；「主 / 新」只是标题约定，不是渲染规则 |
| 删除群 | 只允许发版删内置群；远程清单**只能加不能删**（宁可一张卡降级，也不让一次推送让所有人少一张卡） |
| 文案 | 不出现「三个群」这类计数词，加群不用改文案 |
| 暂不做 | 分组标题（超过 6 个群再议）、横向轮播、折叠 |

## 5. 联网取最新：怎么做到

### 5.1 托管

- 文件在 base 仓库的 `contact/` 目录，仓库**必须公开**（npm 包本身也是公开的）。
- 客户端从仓库地址推导出 CDN 地址；地址集中在一个常量里，仓库改名只改一处 + 重新构建。
- 主通道 jsDelivr（国内外可达性最好）：`https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/contact/manifest.json?v=<小时戳>`
- 备通道 raw.githubusercontent.com（允许跨域，作为 CDN 失败兜底）。
- 两者都用 `?v=<小时戳>` 让 CDN 当成新 URL，避免吃到旧缓存。

### 5.2 打开弹窗的流程

```
openContactModal()
  ├─ 1 立即渲染（离线可看）：CONNECT/反馈与联系 + 欢迎语 + 内置基线群卡（3 张）
  ├─ 2 并行请求远程清单（AbortController，1500ms 超时，不重试）
  ├─ 3 成功且 validUntil ≥ 今天 → 微信卡换成远程图，有效期文案按真实日期拼
  ├─ 4 成功但已过期 / 结构不合法 → 微信卡显示兜底链接
  ├─ 5 失败/超时 → 微信卡显示「点此获取最新群二维码」→ README 联系区
  └─ 6 关闭即销毁；会话内缓存 30 分钟，避免反复请求
```

### 5.3 正确性不靠缓存新鲜，靠日期校验

- 即使 CDN 拿到旧清单（分支引用有缓存），只要 `validUntil < 今天` 就一定降级成链接，**绝不展示过期码**。
- 图片文件名带日期 → 永久的 CDN 缓存也不会返回错误的图。

### 5.4 安全边界

- 只允许预置域名（jsDelivr / raw.githubusercontent）、只允许 https。
- 校验 JSON 结构、字段长度、图片大小上限（512KB）。
- 不 eval、不用 innerHTML、不渲染清单里的任何 HTML 文本。
- 请求失败静默降级，不弹错误、不写告警。

### 5.5 平时怎么更新（三步，不发布代码）

1. 微信里取新群码 → 存成 PNG；
2. 工作区跑 `npm run contact:update -- <图片路径>`：校验图片、按 `wechat-YYYY-MM-DD.png` 落盘、更新 manifest 的 generatedAt/validUntil、清理 8 周前的旧图、打印 diff 摘要；
3. `git add contact && git commit && git push`，1~10 分钟生效。

## 6. 包结构

```
packages/base/
  package.json          # name: dsh-featherhunter-plugin-base, exports: ./core ./client ./node
  src/core/             # 群组数据、文案、列序规则、有效期纯函数（零依赖、无 DOM）
  src/client/           # createContactUI(React) → { ContactButton, openContactModal }
  src/node/             # README 三块的 render / verify / sync + CLI（node:fs、fetch）
  assets/               # 构建时从 contact/ 拷贝并生成 base64 模块（产物提交，构建可复现）
  test/                 # vitest：快照、jsdom 弹窗、假时钟有效期、清单校验
```

调用方只看得到：

```ts
import { createContactUI } from 'dsh-featherhunter-plugin-base/client'

const { ContactButton, openContactModal } = createContactUI(React)

<ContactButton lang="zh" />   // 设置面板里的 SVG 图标按钮
openContactModal()             // 也可以由代码主动打开
```

## 7. README 三块

| 块 | 现状 | 目标 |
| --- | --- | --- |
| 联系区 | manage 仓 `scripts/sync-contact.cjs` 用 6 个各不相同的正则替换五仓 | `./node` 渲染 + 新增 `<!-- CONTACT-*-START/END -->` 标记，替换确定性 |
| 星图 | deck/im 深浅双图、palette/prompt 单图、ilife 没有 | 统一 `<picture>` 深浅双图 + 分钟戳；ilife 补上 |
| 致谢 | 五套生成器（.ts/.mts/.mjs）+ 五套门禁 | `renderThanks/verifyThanks` 纯函数；五仓脚本降到 3~5 行 |

迁移方式：一次性在五仓插入标记（由交接文档指导，维护者自己跑 `base readme:init`），此后 `base readme:sync --check` 可做 CI 门禁。

## 8. 发布与传播

- base 发版：`npm run release`（test → build → 版本 → 发布），CI 用 npm trusted publishing。
- 传播：改版本只能靠五仓各自升级。提供 `base doctor` 一条命令输出：声明版本 / 内联版本 / README 三块是否过期，各仓 CI 加一行即可。
- 不做运行时自动更新：客户端代码是内联的，没有运行时通道；硬做等于让插件启动时执行远程代码。

## 9. 交接文档（给五仓看，本仓不替他们改）

`docs/handover/` 下三份，每份都能独立执行：

1. `01-接入联系弹窗.md`：装包、三行代码、按钮放哪、删除旧实现（im-companion 自绘弹窗）、验收清单。
2. `02-README三块迁移.md`：标记初始化、联系区切换、星图改双图（palette/prompt）、ilife 补星图、致谢生成器替换、`verify` 命令。
3. `03-CI与发布.md`：workflow 模板（星图/致谢定时刷新、doctor 门禁）、base 升级流程。

## 10. 验收标准

- 包能构建、测试全绿；五仓 README 三块的生成结果与现状**字节级一致**（用现状文件做快照）。
- 弹窗在本地 demo 页可打开、可关闭、Esc/遮罩可用、深色模式正常、窗口窄时降为单列。
- 扩展性快照：3 个群 = 一行三列；5 个群 = 3+2 两行；7 个群 = 3+3+1；README 表格同规则。
- 离线时：飞书/QQ 正常显示，微信卡给兜底链接。
- 清单里 `validUntil` 过期时：不显示二维码，只显示兜底链接。
- 交接文档按步骤可在任一仓完成接入，不需要读代码。

## 11. 非目标

- 不改五个插件的代码与 README（他们自己按交接文档执行）。
- 不做运行时远程加载代码、不做二维码在线生成、不做「作者其他插件」卡片（可作 v1.2）。