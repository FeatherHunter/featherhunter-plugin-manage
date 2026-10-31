# dsh-featherhunter-plugin-base

这是库，不是插件：不注册任何 DSH 槽位、不读写宿主存储，由调用方注入 React 后使用。

FeatherHunter DSH 插件共用的 base 包：设置面板里的**联系作者弹窗 / 作者插件推荐卡**，
以及 **README 四块内容**（联系区、star 历史、致谢、MORE）的渲染与同步工具。

- 纯 ESM，零运行时依赖，单包三入口。
- `./client` 不 import React：宿主把 React 传进 `createBaseUI(React, options)`，共享宿主的 reconciler。
- 数据唯一真源在仓库 `contact/`，构建后发布为 `data/manifest.json` + `data/img/`，经 npm CDN 分发。
- 首次渲染用包内置基线（飞书 + QQ），随后回源更新；二维码过期时降级为链接。

## 入口

| 入口 | 内容 |
| --- | --- |
| `dsh-featherhunter-plugin-base/core` | 类型、manifest 校验、排序 / 语言 / 有效期工具、内置基线 |
| `dsh-featherhunter-plugin-base/client` | `createBaseUI(React, options)`：`ContactButton` / `StarButton` / `IssueButton` / `ActionButtons` / `ActionGroup` / `HoverTip` / `ContactRow` / `AuthorPlugins` / `openContactModal` / `closeContactModal` / `preloadContent` |
| `dsh-featherhunter-plugin-base/node` | README 四块渲染器 + `verifyBlock` + CLI（`readme:init` / `readme:sync` / `doctor`；`contact:update` 只在源码仓用 `npm run` 跑，发布包不带图像工具） |

## 使用

```ts
import { createBaseUI } from "dsh-featherhunter-plugin-base/client";

const base = createBaseUI(React, {
  lang: "zh",
  selfId: "deck",
  repoUrl: "https://github.com/FeatherHunter/dsh-mattpocock-skills-deck",
});
// 联系 / Star / Issue 三枚独立图标按钮：
// <base.ActionButtons size={18} />
// 窄页头用三项合一的胶囊（1px 边框 + 细分隔线）：
// <base.ActionGroup size={18} />
// 鼠标悬停文案由公共 HoverTip 提供（Star：您的🌟是我夜空中最亮的星🌹）：
// <base.HoverTip content="任何建议都欢迎">…</base.HoverTip>
// 整行入口：<base.ContactRow />；作者插件卡：<base.AuthorPlugins />
```

```sh
npx dsh-base readme:sync --check
npx dsh-base doctor
```

## 页头三件套

- **`ActionButtons`**：联系（QR 线稿，点开弹窗）/ Star（五角星线稿，跳仓库）/ Issue（圆形感叹号线稿，跳 issues）三枚独立按钮，2px 间距，14 / 16 / 18 三档图标尺寸。
- **`ActionGroup`**：同样三项收进一枚胶囊（1px 边框 + 内部分隔线），适合放不下三枚独立按钮的窄页头。
- **`HoverTip`**：公共悬浮文案控件（移植自 deck）。文案在触发控件上方，靠近视口边缘自动翻到下方并左右让位；同一时刻只显示一个悬浮提示；键盘聚焦同样触发，Esc 隐藏。三句内置文案可用 `texts` 覆盖，Star 默认「您的🌟是我夜空中最亮的星🌹」。
- 图标全部 24×24 viewBox、`currentColor`、1.8 线宽圆头，跟随宿主深浅色。

## 开发

```sh
npm install
npm run typecheck
npm test
npm run build
npm run build:demo   # demo/index.html 可直接用浏览器打开
npm run contact:update -- <二维码截图> [--group wechat]   # 换码：刷新 contact/ 源数据
```

数据从源图到发布清单的完整流程见票 03；CDN 分发与回滚见票 02。

## License

MIT
