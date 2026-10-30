# DSH 设置面板扩展点调研（插件在设置里加一页 + 群二维码）

> 日期 2026-10-24。三条取证线，全部是一手源：
> 1. **本机安装的 DSH 0.2.1-rc.2**：`D:\DeepseekHarness\resources\app.asar`（单 asar；解包副本在 `.dsh-src/`，前缀 `dsh/node_modules/@deepseek-ai/` 已剥掉）。
> 2. **官方仓库 deepseek-ai/deepseek-harness（master = 0.2.1-rc.3）** 的源码与文档；raw 走 `master` 分支（`main` 404）。
> 3. **真实第三方插件**：`D:\dsh-plugin\dsh-wallpaper-engine`（v1.3.3，设置页签里就有 QQ / 抖音群二维码）与 `C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-bili-scroll`（设置页签 + 扫码登录二维码）。
>
> 引用格式：`路径:行号` 或 GitHub blob 链接。凡"本机 rc.2"与"master rc.3"不一致处单独标注。

---

## 0. 速览

| 问题 | 答案（含主源） |
|---|---|
| 贡献 UI 到设置页的确切 API | 客户端插件里 `ctx.slots.inject('settings.section', …)` + `ctx.slots.register({ name: 'settings.section', id, order, label }, Component)`（slots.ts:46-57） |
| 设置字段呢 | 那是**另一套**：插件 Config 里 `.volatile()` 字段，由 Plugins 页自动生成表单，与设置面板的 section 无关（添加设置卡片的官方 cookbook） |
| 能否渲染任意 UI | **能**。槽内容就是一个 React 组件（`SlotComponent<P> = (props: P) => ReactNode`），可放 `<img>`、列表、按钮，甚至自己的弹层 |
| 图片怎么到浏览器 | 本机（rc.2）**只有两条真路**：宿主侧 `ctx.webServer.register({kind:'prefix',…})` 自建路由直出 PNG/JPEG；或把图转 `data:image/png;base64,…` 随 JSON 返回。官方"包资源 `require.asset`"是 **rc.3 才有**，本机 rc.2 实测不存在 |
| 设置是每插件一页还是全局 | **全局一个模态面板 + 左侧导航多 section**；"每插件一页"= 每插件一个 section。打开路径：侧栏底部 Settings 行 / 快捷键 |
| 版本门限 | 真实插件写 `engines.dsh`：wallpaper-engine `">=0.1.5-rc.1"`，bili-scroll `">=0.1.7-rc.1"`；本机装 0.2.1-rc.2 |

---

## 1. 扩展点：`settings.section` 槽（问题 1）

### 1.1 契约定义（官方源码，权威）

`packages/client/ui-settings/src/client/contract/slots.ts:46-57`
（[GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-settings/src/client/contract/slots.ts#L46-L57)）：

```ts
/**
 * One settings page per list entry. Registrant options carry the nav
 * identity: 'id' (section key, drives 'only' filtering), 'order' (nav
 * position), 'label' (registrant-localized display text — the registrant
 * re-registers with fresh text on locale change, so the shell never
 * subscribes locale state; the ledger bump doubles as the shell's
 * re-render trigger). Sections render inside the panel content column.
 */
'settings.section': { kind: 'list'; scope: 'root'; owner: SettingsSectionOwnerProps }
```

ownerProps（同文件 `slots.ts:119-129`）：

```ts
/**
 * Owner share of a settings section entry. The shell owns modal visibility
 * and navigation; a section's data arrives through its own inject faces and
 * stores. 'close' is the one shell affordance a section receives …
 */
export interface SettingsSectionOwnerProps {
  /** Close the settings panel (the shell owns the open state). */
  close: () => void
}
```

要点：**注册选项只有 `id / order / label` 三项**，没有 icon、没有 description、没有 schema。`kind: 'list'` = 每个条目是导航里的一行；`scope: 'root'` = 全局一份。

### 1.2 本机 rc.2 的机器生成契约表（同一份契约，带 registerOptions）

`.dsh-src\dsh-cordis-client-runner\lib\client.js:5292-5344` 是从 TS 类型生成的槽位账本，`settings.section` 条目原文（节选）：

```js
key: "settings.section",
kind: "list",
scope: "root",
summary: "One settings page per list entry.",
source: "packages/client/ui-settings/src/client/contract/slots.ts:57",
registerOptions: [
  { name: "id",    requirement: "required", type: "string", doc: "Your cell key…" },
  { name: "order", requirement: "optional", type: "number", doc: "…default 0" },
  { name: "label", requirement: "optional", type: "string | (() => string)" },
],
ownerProps: [ { name: "close", type: "() => void" } ],
declaredBy: "an entry in 'sidebar.settings' (client-ui-settings-general), so it exists while that entry is mounted",
occupants: "agent-presets / account / general / models / plugins",
example: "ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'my-entry', order: 100, label: 'My entry' }, () => React.createElement('div', null, 'hello')))",
replaceRisk: "none",
```

- `label` 的类型是 `SlotLabel = string | (() => string)`（`dsh-cordis-client-runner/lib/client.js:2250`），即**支持 thunk**：语言切换后导航那一行会自己换词，不用重注册。
- 槽内容是 `SlotComponent<P> = (props: P) => ReactNode`（同文件 `:2222`）——**任意 React 组件**，这就是"能渲染任意 UI"的类型依据。
- `replaceRisk: "none"`：新增 id 只多一行，不会顶掉内置项。

### 1.3 注册 API 与生命周期

`ctx.slots.inject(key, callback)`（`.dsh-src\dsh-cordis-client-runner\lib\client.js:1384`）：

```ts
inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void
// 为 slot 的每次「声明生命周期」装 effect：声明已存在则同步跑，
// 否则在声明方 register() 提交后跑；callback 属于调用方 fiber，
// 插件卸载会取消等待并移除贡献。
```

**必须用 `inject` 而不是裸 `register`**：`settings.section` 的声明方是设置外壳（ui-settings-general 的 `sidebar.settings` 条目），外壳还没挂时注册会丢；`inject` 会等声明就绪，并在外壳卸载时自动撤贡献。

### 1.4 实测样例（两个在跑的插件，同一形）

bili-scroll（`client.js:567-573`）：

```js
// ⭐ 进「设置」：label 就是左侧导航里那一项（抄 dsh-meme 的写法）
const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
if (!slots) return
slots.inject('settings.section', () => slots.register(
  { name: 'settings.section', id: 'bili-scroll', order: 30, label: '刷B站' },
  () => h(Panel),
))
```

同一文件 `client.js:11-19` 有一句第一版踩坑留下的注释，值得抄走：

```js
*   ⇒ **别自己糊一个标题栏按钮 + 全屏 overlay** ✗（第一版就是这么干的，使用者一眼看出"跟别的插件不一样"）。
```

wallpaper-engine（`src/client.js:5528-5541`）：

```js
// 2. Settings page as a FIRST-LEVEL settings section (mirrors the skin-center
//    in dsh-web-ui-all: its own nav entry, rendered inside the panel content column).
//    'label' 用 **thunk**（官方 SlotLabel 支持"每次读取时求值"）：语言切换后设置导航里的
//    那一行跟着换文字，不需要重注册座位。
if (ctx.slots) {
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      { name: "settings.section", id: "wallpaper-engine", order: 500, label: () => weT("壁纸引擎") },
      () => React.createElement(WallpaperPickerSection),
    ),
  );
}
```

### 1.5 同一面板里还有哪些槽

| 槽 | kind | 用途 | 源 |
|---|---|---|---|
| `settings.section` | list | **一整页**（本需求要的就是它） | slots.ts:57 |
| `settings.general.item` | list | 「通用」页里的一行偏好（无需独立页面时用它） | slots.ts:78-92 |
| `settings.plugins.tab` | list | 「插件」页里的一枚页签 | slots.ts:58-66 |
| `settings.action` | list | 内容列头部（关闭按钮左边）的按钮，**只对当前页可见** | slots.ts:33-39 |
| `settings.trigger` | single | 侧栏底部触发器内容（替换整行） | slots.ts:20-28 |
| `settings.header / .close` | single | 面板标题文本 / 关闭按钮的无障碍标签 | slots.ts:29-45 |
| `settings.launcher` | single | 侧栏账号区的启动器（可打开面板） | slots.ts:12-13 |
| `shell.overlay` | list | 全框浮层（徽标/toast），**点击穿透**，条目自行接管 pointer events | `dsh-cordis-client-runner/lib/client.js:5433-5437` |

即：要做"点开一整页显示若干二维码"，正确落点是 `settings.section`；要做"页头一个小按钮弹层"，可用 `settings.action`（但弹层内容要自己画）。

---

## 2. 能不能渲染任意 UI，约束是什么（问题 2）

**能。** 三条依据：

1. 槽内容的类型就是 `(props) => ReactNode`（`SlotComponent<P>`，见 `1.2），不是字段 schema。
2. 官方 README：`packages/client/ui-settings/README.zh.md`「设置界面会注册进本包声明的 slot 类型。外壳…位于 ui-settings-general；功能页面注册 `settings.section` 贡献」。
3. 真实插件已在做：wallpaper-engine 在 section 里渲染 `<img src=…>` 二维码卡片（见 `3.1）；bili 在 section 里渲染 `<img src={login.qr}>`（见 `3.2）。

### 硬约束（逐条有源）

| 约束 | 事实 | 源 |
|---|---|---|
| 同一时刻只挂载当前 section | 外壳 `renderSlot("settings.section", { close }, { only: active })`；切走即卸载、组件状态丢失 | `.dsh-src\dsh-client-ui-settings-general\lib\client.js:337`（active 计算在 `:276`） |
| 组件 props 只有 `close` | 其余数据"经你自己的 inject 面与 store 取" | slots.ts:119-129 |
| **导航图标不能自定义** | 外壳 `navIcon(id)` 是硬编码映射，未知 id 一律兜底齿轮（"Nav glyph by section id; unknown ids fall back to the settings gear."） | `dsh-client-ui-settings-general/lib/client.js:243-269` |
| 想换图标只能 DOM 补丁 | wallpaper-engine 的做法：补丁失败保留齿轮、不抛不重试 | `dsh-wallpaper-engine/src/client.js:5543-5546` |
| 面板几何固定 | 800×800（受视口约束），内容列内部滚动；<768px 变全屏、导航变横向条带 | 官方 `packages/client/ui-settings-general/README.zh.md`；本机 CSS 串 `…/lib/client.js:60` |
| 面板是**模态**、挂在 `#root` 之外 | 关闭三条路：头部按钮、点遮罩、Escape（仅 open 期挂 document 监听） | 本机 `…/lib/client.js:228-231, 271-274` |
| 主题只能用 token | `--dsw-alias-bg-layer-2 / --dsw-alias-border-l2 / --dsw-alias-label-tertiary / --dsw-radius-panel / --dsw-elevation-prominent` 等 | 本机 CSS 串 `…/lib/client.js:60`；bili `client.js:50-90` |

实践建议：**在 section 里做"页内卡片网格"而不是再套一层 dialog**——外壳已经是模态；再叠一层要处理 Escape 竞争、焦点陷阱与遮罩层级（外壳 overlay `z-index:1000`）。若确有"点一下看大图"，用同组件内 `<details>` / 局部 state，或 portal 到 `document.body` 并把 Esc 处理限制在自己打开期间。

---

## 3. 图片资源怎么送到浏览器（问题 3）

### 3.1 机制 A：宿主侧自建路由直出（本机 rc.2 唯一稳妥的"随包图片"通道）

**这是 wallpaper-engine 现在跑着的那套**，也是本需求最该抄的一套。

宿主侧调用（`lib/index.js:1425`；`BASE` 在 `:122` = `'/wallpaper-engine'`，about 目录在 `:146` = `resolve(dirname(fileURLToPath(import.meta.url)), 'about')`）：

```js
registerAboutQrRoutes(webServer, { disposers, base: BASE, aboutDir: ABOUT_DIR, serveFile });
```

路由实现全文 88 行（`lib/routes/about-qr.js`），关键片段：

```js
// :36
const ABOUT_QR_FILES = ['qq-group.png', 'douyin-group.png', 'update-notice.jpg'];

// :62-88
export function registerAboutQrRoutes(webServer, c) {
  const { disposers, base: BASE, aboutDir, serveFile } = c;
  disposers.push(webServer.register({
    kind: 'prefix',
    path: BASE + '/about-qr',
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') { res.statusCode = 405; res.end(); return; }
      const headOnly = method === 'HEAD';
      // new URL 会先把 .. / %2e%2e / 反斜杠点段规范化掉（WHATWG 语义）
      let url; try { url = new URL(req.url || '/', 'http://x'); } catch { res.statusCode = 400; res.end('bad url'); return; }
      const rest = url.pathname.slice((BASE + '/about-qr').length).replace(/^\/+/, '');
      if (!rest || rest.includes('/')) { res.statusCode = 404; res.end('not found'); return; }
      let name; try { name = decodeURIComponent(rest); } catch { res.statusCode = 400; res.end('bad encoding'); return; }
      const abs = aboutQrFile(name, aboutDir);      // 白名单 + relative() 目录包含性复查
      if (!abs) { res.statusCode = 404; res.setHeader('Cache-Control', 'no-store'); res.end('not found'); return; }
      serveFile(abs, req, res, headOnly, { revalidate: true });   // 按扩展名给 mime；ETag/304
    },
  }));
}
```

`aboutQrFile()` 里两个安全点值得照抄（`lib/routes/about-qr.js:44-60`）：
- 白名单用 `String` 精确比较（`===`）：`qq-group.png.bak`、`./qq-group.png`、末尾带斜杠一律不过；
- 目录包含性判定用 `relative()` 而不是 `startsWith(dir + '/')`：**前缀写法在 Windows 上必然判 null**（`:52-57` 的注释记了 CI 上真实翻车：本机 macOS 全绿、windows-latest 红）。

静态文件助手（`lib/serve.js`）：`serveFile(absPath, req, res, headOnly, opts)`（`:348`）→ 按扩展名 `mimeFor`（`:137`）→ `Content-Type`（`:282`）→ `ETag`（`:288`）；`revalidate` 打开时加 `Cache-Control: private, max-age=0, must-revalidate`（`:286-290`），**默认是关的**（`:258`）。PNG/JPEG 混排不需要在路由里分支。

宿主侧 API 本体（`.dsh-src\dsh-host-webserver\lib\index.js:320-333`）：

```js
/** Register a named route. Duplicate (kind, path) throws … @returns the disposer */
register(route) {
  const table = route.kind === "exact" ? this.exact : this.prefixes;
  if (table.has(route.path)) throw new Error("webserver: duplicate " + route.kind + " route " + JSON.stringify(route.path));
  table.set(route.path, route);
  return () => { table.delete(route.path); };
}
```

官方 README 把边界写得很清楚（`packages/host/webserver/README.zh.md`）：
- 「它**不提供任何文件服务**——`/api` 桥接、插件 bundle、HMR、SPA dist 都属于注册它们的插件」；
- 匹配顺序**固定**：先精确、再最长前缀、最后回退；
- 重复路径抛错（"路由模式是组合层约定，冲突即配置错误"）。

⚠️ **rc.2 只有 `register(handler)`**：在 `.dsh-src\dsh-host-webserver\lib\index.js` 里 grep `resource` 只命中 3 处，都与 route 无关；master 文档里的 `register({ resource })`（Fetch `Request → Response`、只放行 GET/HEAD）是 **rc.3 的新增**。

客户端侧只存路径（`src/about-assets.js:21-22`）：

```js
const ABOUT_QR_QQ_PATH = "/about-qr/qq-group.png";
const ABOUT_QR_DOUYIN_PATH = "/about-qr/douyin-group.png";
```

拼 URL 必须过 `apiUrl()`（`src/api-client.js:36-47`）：已带 scheme（含 `data:` / `blob:`）或以 BASE 开头的原样返回，否则补 BASE。注释记了原因：`dsh-app://` 这类自定义协议 origin 下重拼会畸形、封面恒 404。

渲染（`src/panel-tabs.js:288-311, 375-386`）：

```js
const qrCards = [
  { key: "qq",     title: weT("🐧 QQ 群 · DSHWE | LLM 讨论群"), src: apiUrl(ABOUT_QR_QQ_PATH),     alt: weT("QQ 群二维码"),   hint: … },
  { key: "douyin", title: weT("🎵 抖音群 · dsh 交流群"),        src: apiUrl(ABOUT_QR_DOUYIN_PATH), alt: weT("抖音群二维码"), hint: … },
];
// 注释：渲染一次 map 两遍，免得两段几乎一样的 createElement 各自演化
```

> 这条"表驱动 + map 渲染"就是本需求"二维码以后能加渠道"的现成骨架：加一个渠道 = 表里加一行 + 目录里放一张图。

打包：`package.json:41-50` 的 `files` 里**显式写了 `"lib/about/"`**；实物 `lib/about/qq-group.png`（99,790 B）、`douyin-group.png`（83,520 B）、`update-notice.jpg`（89,198 B）。源图放 `assets/about/`、不进包，裁到码区的派生版进 `lib/about/`（`assets/about/README.md:6-8`；同文件 `:57` 一句教训："**不要再转 base64 内联**"）。

### 3.2 机制 B：data URI 内联（没有宿主路由时的退路）

bili-scroll 的扫码登录二维码（`index.js:1310-1316`）：

```js
if (req.method === 'POST' && path === '/api/bili-duty/login/start') {
  const { key, url } = await loginStart()
  const png = await renderQrPng(cfg.pythonPath, stateDir, url)
  let qr = null
  if (png) { try { qr = 'data:image/png;base64,' + readFileSync(png).toString('base64') } catch { qr = null } }
  return sendJson(res, 200, { ok: true, key, url, qr })
}
```

客户端直接 `<img src={login.qr}>`（`client.js:532-533`）。它的路由在 `index.js:1333-1343`（`ctx.effect(() => ctx.webServer.register({ kind:'prefix', path:'/api/bili-duty', handler }))`），客户端用 `fetch('/api/bili-duty/…', { credentials: 'same-origin' })`。

适合：图片小、或本来就是运行时生成（登录码）。不适合几张固定 PNG：会撑大 client bundle，且改图要重新构建——wallpaper 的 assets 说明写的正是从内联 base64 迁到路由的动机。

### 3.3 机制 C：官方"包资源"（master/rc.3 有，本机 rc.2 **没有**）

官方 `packages/client/modules/README.zh.md` 的「包资源」节：

- 「同一个 `/plugins` 路由也提供客户端包通过其 `"./assets/*": "./lib/assets/*"` 导出发布的图片」；
- 构建期在扩展名前插入内容 revision（SHA-1 前 12 位），import / CSS `url()` 编译成 `require.asset("plugins/<package>/assets/<emitted path>")`；
- 宿主对 `/plugins/<package>/assets/…` 做一次百分号解码，再用包的 manifest + `require.resolve` 解析，**由包的 exports 决定哪些文件存在**；只认 `.svg/.png/.webp/.jpg/.jpeg`，其余 404；
- 响应带 `cache-control: public, max-age=31536000, immutable`、`etag: "<requested path>"`、`nosniff`；SVG 额外 `content-security-policy: script-src 'none'`；`If-None-Match` 命中回 304；
- 「仓库外构建的包必须输出同样的形式」。

**本机 0.2.1-rc.2 没有这条通道**，三项实测（可复现）：
1. `.dsh-src\dsh-client-modules\lib\index.js`（宿主半侧，42,342 B）里 `asset` 出现 0 次，`svg` / `nosniff` / `encodeURIComponent` 均 0 次；
2. 该文件的响应表只发两种 contentType：`text/javascript; charset=utf-8` 与 `application/json; charset=utf-8`（`:675-697`），路由常量 `PLUGIN_ROUTE = "/plugins"`（`:202`）；
3. 全仓解包的 185 个文件里 grep `require.asset` / `resolveAsset` = 0；manifest `exports` 含 `./assets` = 0；浏览器 shell bundle（`dsh-web-frontend/dist/assets/index-CN7NIWNw.js`，921 KB）里也 grep 不到 `asset(` 或 `"/plugins`。

结论：**rc.2 上 `/plugins` 只发 bundle 与 sourcemap，别把它当图片目录**。要用包资源得升到 0.2.1-rc.3+，包要声明 `"./assets/*": "./lib/assets/*"`，并用官方 clientBundle 预设产出 `require.asset(...)` 调用——该预设在 `packages/client/tsdown.client.ts`，**不在任何已发布包里**，仓外要自己复刻（`docs/cookbook/adding-a-settings-card.zh.md` `5）。

### 3.4 别踩的坑

- **别在 `dsh.client.inject` 里找资源声明**：那里是模块请求清单（`dsh-client-modules/README.zh.md:34, 51`）。wallpaper 只写了 `["@deepseek-ai/dsh-client-runtime"]`（`package.json:89-93`）照样注册成功 —— 说明**注册 section 本身不依赖 inject 里出现 ui-settings**。
- **路由注册是宿主启动期的一次性动作**：白名单/路由表里没有的文件名不会热生效，要重启宿主；而 client bundle 是每次开页面现读的。两者时间差会造成 404 裂图。→ 二维码若要"以后能加"，**别用硬编码白名单**，改成"请求时 readdir + 扩展名白名单"或"读一份随包的 `qr/manifest.json`"。
- **绝对/相对 URL**：Electron 下页面可能不是 http origin，统一走 `apiUrl()` 那类函数。
- **CSP**：官方只在 SVG 上加 `script-src 'none'`；PNG 无额外限制，但别把 `data:image/svg+xml` 塞进 `<img>` 又在同页允许脚本。

---

## 4. 面板结构与被打开的方式（问题 4）

**一个全局模态面板 + 左侧导航多 section**，不是"每插件一个独立设置页"。官方（`packages/client/ui-settings-general/README.zh.md`）：

> 使用本包可为 dsh Web 客户端提供 Settings 面板、连接恢复控件、由功能包贡献的导航 …
> 「设置面板采用各页面共享的 800 × 800 布局，并受视口大小约束。较长的页面在内容栏内部滚动」
> 「外壳渲染模态面板、由 `settings.section` 条目构建的导航，以及每次只挂载一个的引导步骤」

本机实现（`.dsh-src\dsh-client-ui-settings-general\lib\client.js`）：

- `:228-231` 头注释：侧栏底部触发行 + 居中模态（figma 2552:26025，760×500）+ 分区导航栏；
- `:1138-1152` 导航行来自 `ctx.slots.entries("settings.section")`，按 `order` 升序；同时订阅槽变更与 locale（`:1154-1161`）；
- `:447-463` 侧栏触发器：`<button aria-haspopup="dialog" aria-expanded={open} onClick={actions.open()}>`；
- `:1187-1204` 快捷键：`ctx.shortcuts.register({ id: "settings.open", aliases: ["settings","preferences"], defaults: { "desktop:windows": { code: "Comma", modifiers: ["primary"] } … } })`。

用户怎么打开（官方 README 口径）：
1. **侧栏底部 Settings 行** → 弹出模态；左侧导航点你那一行 = 打开你那一页（这是本需求要的"点开"）；
2. 快捷键：Desktop `Mod+,`；Windows/macOS Web `Mod+Alt+,`；`Mod+/` 是快捷键速查；
3. 账号菜单 → 通用设置（落在 `general` 页，不是你的页）。

补充：**"插件自己的配置页"是另一套**，在「设置 → 插件（内置插件）」里，由 `plugins.item / plugins.bundle.config / plugins.row.config` 等槽承载（见 `docs/五仓设置面板现状盘点.md` 与 `packages/client/ui-plugin-manager/README.zh.md`），与本需求"设置里加一页"不是同一条路，别混用。

---

## 5. 版本与兼容（问题 5）

| 项 | 本机安装 | master（GitHub） |
|---|---|---|
| 版本 | **0.2.1-rc.2**（`dsh-web-frontend` / `dsh-client-modules` / `dsh-host-webserver` / `dsh-settings` / `dsh-client-ui-settings` 的 package.json 全是 0.2.1-rc.2） | **0.2.1-rc.3**（仓根 `package.json`） |
| `settings.section` | 有（契约表 `dsh-cordis-client-runner/lib/client.js:5292-5344`） | 有（`slots.ts:57`，形状未变） |
| `webServer.register(handler)` | 有（`lib/index.js:326-333`） | 有，且新增 `register({ resource })`（Fetch 语义，GET/HEAD） |
| `/plugins/<pkg>/assets/…` | **无**（实测见 `3.3） | 有（modules README「包资源」节） |
| `require.asset()` | **无** | 有 |
| `dsh.client.external` | 有（parseDshClient 校验 `.dsh-src\dsh-client-modules\lib\index.js:62-76`） | 有 |

**最低版本建议**：用 `settings.section` + 自建 `webServer.register` 路由这套写法，实际下限是 **0.1.5-rc.1**（wallpaper-engine 的 `engines.dsh` 就写 `">=0.1.5-rc.1"`，且它跑在本机 0.2.1-rc.2 上）；bili 保守写 `">=0.1.7-rc.1"`。要用 `require.asset` 则门限抬到 **>=0.2.1-rc.3**，还得自己复刻 tsdown 预设。

**弃用**：0.1.5-rc.1 → 0.2.1-rc.3 这段没找到 `settings.section` 的弃用或改签名记录（两个跨 0.1.5 / 0.1.7 门限的插件用同一形；契约表 `replaceRisk: "none"`）。唯一"实践层面已弃用"的是**自造标题栏按钮 + 全屏 overlay**（bili `client.js:11-19` 明确 ✗）。

---

## 6. 对本次需求的结论

### 6.1 可行性判定

| 判断 | 置信度 | 依据 |
|---|---|---|
| 能加"设置里的一页"，点开显示二维码 | **确定** | `1、`2；两个在跑的插件同形 |
| 能放多张 PNG/JPG，且以后能加渠道 | **确定**（宿主路由 + 表驱动 / 目录扫描） | `3.1 的 `qrCards` 表；白名单可换成目录扫描 |
| 能给这一页自定义导航图标 | **不能**（只能兜底齿轮，或 DOM 补丁这种脆弱手段） | `2 约束表；官方 `navIcon` 硬编码 |
| 能只用官方"包资源 `require.asset`" | **本机不能**（rc.2 无；rc.3 才有） | `3.3 三项实测 |
| 能做成"独立设置页" | **不能**，设置是全局一个面板 | `4 |

### 6.2 推荐落点与骨架

**落点**：一个 `settings.section`（`id` 与包名一致，如 `'featherhunter'`；`order` 取 200+ 排后面；`label: () => t('联系与群二维码')` 用 thunk 跟语言走）。
**不要**用 `settings.plugins.tab`（那是"插件"页里的页签，语义不同），**不要**自造标题栏按钮。

客户端（懒 CJS factory，`window.__ModuleLoader__.load({ id, factory })`）：

```js
exports.apply = (ctx) => {
  const slots = (ctx.get && ctx.get('slots')) || ctx.slots
  if (!slots) return
  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'featherhunter', order: 200, label: () => t('联系与群二维码') },
    () => h(QrPage),
  ))
}
// QrPage 内部：
//   const [groups, setGroups] = useState(null)
//   useEffect(() => { fetch(API + '/groups', { credentials: 'same-origin' }).then(r => r.json()).then(setGroups) }, [])
//   groups.map(g => h('figure', { key: g.id },
//     h('img', { src: apiUrl(g.src), alt: g.alt, draggable: false }),
//     h('figcaption', null, g.title)))
```

宿主（`lib/index.js`）：一条 prefix 路由直出图片 + 一条 JSON 路由给"有哪些渠道"，**渠道清单不要硬编码在客户端**：

```js
ctx.effect(() => ctx.webServer.register({
  kind: 'prefix',
  path: '/featherhunter/qr',
  handler: (req, res) => { /* 与 wallpaper about-qr.js 同形：只 GET/HEAD、new URL 归一化、
                              拒绝含 '/' 的 rest、decodeURIComponent、目录 scan + 扩展名白名单、
                              Content-Type 按扩展名、ETag、304 */ },
}))
```

"可扩展"的两种落地（推荐第 1 种）：
1. **目录即清单**：`lib/qr/*.png` 每张配一个同名 `.json`（`{id,title,alt,hint,order}`），宿主合成 `/featherhunter/qr/index.json`；**加渠道 = 丢两个文件**，不用改代码。代价：若在启动时扫描，新文件要重启才出现；要零重启就每次请求现扫（图只有几张，开销可忽略）。
2. **单表 + 白名单**（wallpaper 现形）：`const QR = [{ key:'qq', file:'qq-group.png', … }]`；加渠道要改代码 + 重新构建，但审查最容易。

### 6.3 落地时必须一起做的四件小事

1. `package.json` 的 `files` 里显式加上图片目录（wallpaper `:50` 写 `"lib/about/"`；`docs/五仓设置面板现状盘点.md` 已点名 dsh-prompt / dsh-opencode-palette 的 `files` **不含 assets** 这个坑）；
2. 客户端拼 URL 统一走一个 `apiUrl()`（自定义协议 origin 问题）；
3. 图用 `figcaption` 给标题、`alt` 给无障碍文本；二维码保留白底（深色主题下透明 PNG 会扫不出来）；
4. 卸载/热重载：路由用 `ctx.effect(() => disposer)` 包住（bili `index.js:1334`、wallpaper `disposers.push(...)` 同形），否则重复注册会撞 `webserver: duplicate prefix route`。

### 6.4 不确定 / 未核实

- **官方有没有专门讲 `settings.section` 的独立文档页**：没找到。`docs/cookbook/adding-a-settings-card.zh.md` 只讲"即时配置表单 + `plugins.detail.*`"；section 的权威说明只有 `slots.ts` 的类型注释与各包 README。
- **宿主有没有"插件静态目录"这种一等公民**：rc.2 只看到"自建路由"与"data URI"两种真实做法；rc.3 的"包资源"是第三种，但本机不可用。
- **宿主 RPC 通道（取图/base64 的 `ctx.rpc` 之类）**：没查证确切 API；本需求不需要。
- **`label` 变更是否必须重注册**：`slots.ts:47-56` 的注释说"registrant re-registers with fresh text on locale change"，但本机外壳 `:1154-1161` 订阅了 locale 且 `resolveSlotLabel` 支持 thunk —— **thunk 实测可用**（wallpaper 就这么发的），"重注册"这条路没验证。

---

## 7. 一页速查：抄哪个文件

| 要什么 | 抄这个文件 | 关键行 |
|---|---|---|
| 注册一个设置页 | `D:\dsh-plugin\dsh-wallpaper-engine\src\client.js` | 5534-5541（含注释与 thunk label） |
| 更简的注册（无 thunk） | `C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-bili-scroll\client.js` | 567-573 |
| 宿主侧直出二维码 PNG | `D:\dsh-plugin\dsh-wallpaper-engine\lib\routes\about-qr.js` | 36, 44-60, 62-88（全文 88 行，可直接改） |
| 静态文件 + ETag 助手 | `D:\dsh-plugin\dsh-wallpaper-engine\lib\serve.js` | 348（serveFile）、137（mimeFor）、282/288（响应头） |
| 客户端表格驱动的二维码卡 | `D:\dsh-plugin\dsh-wallpaper-engine\src\panel-tabs.js` | 288-311（数据表）、375-386（渲染） |
| URL 前缀处理（自定义协议） | `D:\dsh-plugin\dsh-wallpaper-engine\src\api-client.js` | 36-47 |
| data URI 退路 | `…\dsh-bili-scroll\index.js` | 1310-1316 |
| 契约原文 | [slots.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-settings/src/client/contract/slots.ts#L46-L57) | 46-57 |
