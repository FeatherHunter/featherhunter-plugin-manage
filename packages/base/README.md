# dsh-featherhunter-plugin-base

这是库，不是插件：不注册任何 DSH 槽位、不读写宿主存储，由调用方注入 React 后使用。

FeatherHunter DSH 插件共用的 base 包：设置面板里的**联系作者弹窗 / 作者插件推荐卡**，
以及 **README 四块内容**（联系区、star 历史、致谢、MORE）的渲染与同步工具。

- 纯 ESM，零运行时依赖，单包三入口。
- `./client` 不 import React：宿主把 React 传进 `createBaseUI(React, options)`，共享宿主的 reconciler。
- 数据唯一真源在仓库 `contact/`，构建后发布为 `data/manifest.json` + `data/img/`，经 npm CDN 分发。
- 首次渲染用包内置基线（飞书 / QQ / 微信三码全部内联），随后回源更新；远端图片失败时保留基线码（60 秒后可重试），二维码过期时降级为链接。

## 入口

| 入口 | 内容 |
| --- | --- |
| `dsh-featherhunter-plugin-base/core` | 类型、manifest 校验、排序 / 语言 / 有效期工具、内置基线 |
| `dsh-featherhunter-plugin-base/client` | `createBaseUI(React, options)`：`ActionCluster` / `clusterIcons` / `ContactButton` / `StarButton` / `IssueButton` / `ActionButtons` / `ActionGroup`（旧版托盘，兼容保留）/ `HoverTip` / `ContactRow` / `AuthorPlugins` / `openContactModal` / `closeContactModal` / `preloadContent` |
| `dsh-featherhunter-plugin-base/node` | README 四块渲染器 + `verifyBlock` + CLI（`readme:init` / `readme:sync` / `doctor`；`contact:update` 只在源码仓用 `npm run` 跑，发布包不带图像工具） |

## 使用

```ts
import { createBaseUI } from "dsh-featherhunter-plugin-base/client";

const base = createBaseUI(React, {
  lang: "zh",
  selfId: "deck",
  repoUrl: "https://github.com/FeatherHunter/dsh-mattpocock-skills-deck",
});
// 页头操作组：联系 / Star / Issue 三枚彩色按钮，默认 16px、间距 4、无外框（静默簇）：
// <base.ActionCluster />
// 自定义条目直接给 items（图标用 clusterIcons，也可以传自己的 SVG）：
// <base.ActionCluster items={[{ id: "contact", icon: base.clusterIcons.contact(16), label: "联系我们" }]} />
// 三枚完全独立的线稿按钮（14 / 16 / 18 三档）：<base.ActionButtons size={18} />
// 旧版托盘容器（一个 1px 外框托住三枚按钮，0.1.x 兼容保留）：<base.ActionGroup size={18} />
// 鼠标悬停文案由公共 HoverTip 提供（Star：您的🌟是我夜空中最亮的星🌹）：
// <base.HoverTip content="任何建议都欢迎">…</base.HoverTip>
// 整行入口：<base.ContactRow />；作者插件卡：<base.AuthorPlugins />
```

```sh
npx dsh-base readme:sync --check
npx dsh-base doctor
```

## 页头操作组

- **`ActionCluster`**（推荐）：联系 / Star / Issue 三枚**彩色图标按钮**——蓝紫双气泡、金色星标、珊瑚粉反馈气泡。默认 `size={16}`（图标 16px、按钮 28×28）、`gap={4}`、`variant="quiet"`（无外框，容器只表达归组，不响应 hover、没有选中态）。按钮是容器的直接子元素，不被任何包层包住；组 `role="group"` 用泛称 `aria-label="快捷操作"`，每一枚有自己的 `aria-label`、Tab 停靠点和悬浮文案。`items` 可自定义条目（`id` / `icon` / `label` / `tip` / `href` / `onClick` / `disabled`），内置图标用 `base.clusterIcons.contact(16)`；`maxVisible` 把超出的条目收进「更多操作」菜单；`variant="tray"` 可换回 1px 托盘外观。
- **五态**：默认 / hover（彩色柔光 + 各自的小动效：气泡轻浮、星光闪烁、反馈气泡轻晃）/ active（按下不换灰底，缩到 0.88）/ focus-visible（2px 蓝环）/ disabled（去饱和 + 降透明）。hover 动效遵循 `prefers-reduced-motion`。
- **`ActionButtons`**：三枚独立的线稿按钮（24×24 viewBox、`currentColor`、1.8 线宽圆头，跟随宿主深浅色），14 / 16 / 18 三档，适合需要明显按钮感的场景。
- **`ActionGroup`**：旧版托盘容器（一个 1px 外框托住三枚线稿按钮），0.1.x 兼容保留，新面板请直接用 `ActionCluster`。
- **`HoverTip`**：公共悬浮文案控件（移植自 deck）。文案在触发控件上方，靠近视口边缘自动翻到下方并左右让位；同一时刻只显示一个悬浮提示；键盘聚焦同样触发，Esc 隐藏；`ActionCluster` 通过它显示气泡并挂 `aria-describedby`。三句内置文案可用 `texts` 覆盖，Star 默认「您的🌟是我夜空中最亮的星🌹」。
- **`AuthorPlugins`**：作者插件推荐卡自带外框（`.dsh-base-plugins`），宿主不要再套一层卡片容器，否则会出现双层边框。

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
