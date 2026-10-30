# base 包方案 · 对抗式审查

> 审查对象：规格票 00（.scratch/base-package/spec.md，157 行）+ 方案笔记 docs/base包与联系弹窗-方案.md
> 审查方式：先按第一性原理重推约束，再逐条攻击方案里的关键假设，最后用本机实测（网络、解码器、体积、五仓源码）判定每条攻击是否成立。
> 审查轮次：第一轮 §1–§6（方案与规格）；第二轮 §7（用户拍板后的收口）；第三轮 §8（票拆分与可发布性，含 README 四块实测）。
> 审查时间：2026-10-30。

---

## 0. 结论摘要

方案骨架（一份数据 + 两个渲染器 + 一条发布通道；代码内嵌 + 数据远端）成立，但有三处硬伤、四处需要你拍板、十一处实施细则要改。

**必须改的三件（不改会踩坑）**

1. **传输通道选错地方**：现方案让用户浏览器去 GitHub 的 CDN（jsDelivr gh / raw.githubusercontent）取数据。这只证明了本机（可能经代理）能通，不能证明五仓终端用户能通；而 base 包本来就要发到 npm —— 数据放进 npm 包、走 npm CDN，更新通道与发布通道合一，少一条运维链（详见 F1）。
2. **规格里的 jsQR 解码校验不可行**：三张码只有飞书码能被开源解码器解出，QQ（渐变圆点）与微信（圆点+中心 logo）用 OpenCV / jsQR / zxing 全部失败。把它当发布门禁，每周更新必然报错，门禁会变成摆设（详见 F2）。
3. **「三行接入」不成立**：五仓构建链互不相同（deck 自研、palette 自研 mini-bundler 且要求逐文件登记依赖、im/prompt tsdown、ilife tsc -b）。base 的产物必须做成「单文件、零 import、无动态 import、无 top-level await」，且每仓还要写各自的登记/门禁条目（详见 F3）。

**需要你拍板的四件**（见 §4）：传输通道、v1 范围（是否含星图/致谢）、弹窗列数、ilife 入口位置。

> **2026-10-30 已拍板**：P-A = npm CDN、P-B = 四块全做、P-C = 4 列、P-D = ilife 总管页 1 处；规格票 00 已按此重写（见 §7）。

**另外两件我建议按默认值走**（你可以推翻）：微信码过期时的降级形态、README 联系区用整卡还是裁图。

---

## 1. 第一性原理重推

不看现有方案，只从约束推。

**不可约约束**

| 编号 | 约束 | 为什么不可约 |
| --- | --- | --- |
| C1 | 五个插件各自独立发布、独立安装，用户不同步升级 | 复用只能以「随包携带的副本」存在，不能指望共享运行时 |
| C2 | 界面跑在宿主 WebView 里的浏览器页面 | 图片、网络受浏览器规则管；只能 data URI 或可达的 HTTPS 静态地址 |
| C3 | 群二维码会周更，微信码 7 天失效 | 任何「发布时固定」的数据都必须有更新通道 |
| C4 | 五仓构建链各异且归一化程度低 | 交付物必须是任何构建链都能吞下的最低形态 |
| C5 | 维护者是单人，无 CI 值守 | 运维动作必须少、自动、失败可降级 |
| C6 | 本阶段不得修改五仓代码 | 五仓改动只能以交接文档 + 可复制补丁形式交付 |

**推导**

1. 由 C3：数据必须与代码分离 → 远程清单（D1-B 正确）。
2. 由 C1+C4：代码不能假定 React/JSX/宿主 API → 调用方注入 React、内部 createElement、零运行时依赖（正确）。
3. 由 C2+C3：数据必须放在一个「五仓用户本来就能访问」的静态主机上，且要能在几分钟内更新。**这是 F1 的根**：本机可达 ≠ 终端可达。
4. 由 C5：更新动作必须由流水线完成，不能靠维护者记得发版（F8）。
5. 由 C3：必须内置失败路径 —— 网络失败、清单非法、微码过期都有降级形态（F4/F14）。

结论：骨架成立；问题都在「落地选择」上，而不在方向上。

---

## 2. 发现清单

严重度：🔴 必须改（不改会出错）｜🟠 应该改（有明确风险）｜🟡 建议改（实施细节）

### F1 🔴 传输通道站错了地方：GitHub CDN → npm CDN

**现方案**：清单走 jsDelivr gh（主）+ raw.githubusercontent（备），图片同源。

**反证**

- 本机 curl 三个端点都 200（jsDelivr gh、raw、npmmirror），但本机网络是否经代理未知，**无法证明中国大陆终端可达**；而 raw.githubusercontent 在中国大陆长期是「时通时不通」，一旦时通时不通，用户看到的是「微信码一直加载失败」，且这种故障无法从维护者机器复现。
- 更强理由：base 包**本来就要 npm publish**（五仓靠 npm 依赖）。npm 上的文件天然带 CDN 镜像（jsDelivr npm / unpkg / npmmirror），把数据放进 npm 包 = 更新数据与发版共用一条通道，少一条运维链、少一套凭据。
- 已定 D2-A（代码放本仓 packages/base），manage 仓现已建好且是公开仓（github.com/FeatherHunter/featherhunter-plugin-manage，main，初始提交 e5c088e）——但「仓公开」只解决「能被 CDN 读到」，不解决「终端用户能访问」。

**修正后的取数设计**

| 数据 | 通道 | 理由 |
| --- | --- | --- |
| 清单 manifest.json | unpkg 的 @latest（max-age 60 / s-maxage 300） | 够新：几分钟内生效 |
| 图片 | manifest 内写成**精确版本路径**（jsDelivr npm @x.y.z，immutable 1 年） | 文件名带日期 + 版本路径 = 永久缓存安全 |
| 大陆兜底 | npmmirror 的 /files/ 精确版本路径 | 国内镜像，1 年缓存 |

关键设计：**清单是唯一可变的那一个文件，图片全部不可变**。清单里由构建工具写入精确版本 URL，客户端拿到清单后图片走 immutable 路径，既不会被缓存坑，也不会因为 CDN 回源失败而退化成旧图。

副作用：每周数据更新会 bump 一个 patch 版本；但五仓消费者**不需要跟着升级**（数据是运行时远程取的）。

证据见附录 A。

### F2 🔴 「能解码」不能当发布门禁（规格里这一条要删）

**实测**：三张源图（900×1600）裁出二维码后，用 OpenCV 5.0.0 QRCodeDetector 与 jsQR 1.4.0 解码：

| 码 | 全图解码 | 裁图解码 | 说明 |
| --- | --- | --- | --- |
| 飞书（永久） | 成功 | 成功（400/350/260/200/165/150/120px 全通过） | 标准风格 |
| QQ（永久） | 失败 | 失败 | 蓝紫渐变圆点，风格化 |
| 微信（限时） | 失败 | 仅 350px 偶然成功一次 | 圆点 + 中心 logo，遮挡模块 |

另外：cv2 5.0.0 不含 wechat_qrcode 解码器；pyzbar 在当前环境缺 libzbar-64.dll。

**结论**：规格票 00 里「用 jsQR 解出 URL 才允许发布/裁图」的门禁**不可行**——QQ 码永远过不了，微信码要碰运气。如果保留，维护者每周只能手动跳过门禁，门禁形同虚设。

**修正**

1. 裁图：OpenCV detect() 定位框自动裁（飞书/微信有效），QQ 失败时允许 `--box x,y,w,h` 手填；
2. 校验：只做几何检查（三个定位图形都在、白边 ≥ 4 模块、尺寸 ≥ 320px、无裁切），不做解码；
3. 人工确认：每次 update 自动生成「原图 vs 裁图」对比图，人工 30 秒确认；真机扫一次。

规格票 00 的测试接缝 4（spec:134）与实现决策里的解码门禁（spec:52）需同步修改。

### F3 🔴 「三行接入」不成立：五仓构建形态差异是接入成本的根

| 仓 | 构建 | 对 base 产物的硬要求 |
| --- | --- | --- |
| deck | node scripts/build.mts（自研，模块拼单文件；seam 里 const React = require("react")，build.mts:234；portal.ts:21-26 用 createPortal） | 单文件、可被拼进去 |
| palette | scripts/build-client.ts（零依赖 mini-bundler，INLINE_PACKAGES 表要求逐文件登记依赖，:77-110；产物 window.__ModuleLoader__ CJS） | 单文件、零 import、额外登记 entry |
| im | tsdown | ESM/CJS 双形态 |
| prompt | tsdown + scripts/build.mjs | 同上 |
| ilife | tsc -b + 每包 build:host/build:client | 能被 tsc 消费的 d.ts + 无 node API |

**修正**：交付物 = 包 + 「每仓接入补丁」（文件级 diff 片段 + 登记条目 + 回滚方法），写进三份交接文档。README 里的「三行接入」改成「见交接文档 01，约 10-30 行改动」。

### F4 🟠 远程清单是单点：一次坏发布会让五个插件弹窗全空

- manifest 加 `schema`（版本号）、`revision`（自增）、`minClient`（最小客户端版本）；
- 客户端校验：至少 1 组、每组有 label 与 image、image 必须是白名单域名 + https；
- 校验失败 → 用会话缓存（30 分钟）→ 再用内置基线；**不做「空清单 = 清空」的解释**；
- 数据更新工具发布前自己跑一次同样的校验（防止坏数据进 npm）。

### F5 🟠 4 列 × 约 160px 的可扫性未验证，但风险可控

- 尺寸：设置面板 800px 宽，内容区约 752px；4 列每列约 179px，二维码显示约 150-160px。飞书码约 45-49 模块 → 3.1 CSS px/模块 ≈ 0.8mm/模块，整码约 40mm；微信/QQ 模块数更少，物理尺寸更大。
- 判断：理论上可扫（微信扫码下限约 2cm），但屏幕缩放、模糊、摄像头质量会吃掉余量。**要求真机验证一次**，列数做成可配置，窄屏（<768px）降 2 列或 1 列。
- 内置基线的体积（实测）：320px、16 色不透明 PNG = 53.4KB 原始 ≈ 71KB base64（三码全内置）；只内置两个常驻码 ≈ 49KB base64。
- **不要用 4 色**：对比图经视觉判读，4 色明显掉对比（飞书变灰、QQ 发白），有扫不动风险；8 色 QQ 局部发花；16 色最接近原图。

### F6 🟠 README 迁移实际是 9~10 个文件，且会和现有定时任务抢提交

- README 变体：README.md、docs/README.en.md、deck/palette 的 package/README.md（ilife 只有中文）。
- 致谢标记已存在（THANKS-TABLE-ZH-START/END，五仓都有）；**联系区没有标记**，现在靠正则定位（scripts/sync-contact.cjs:50），迁移时要新增 CONTACT-*-START/END。
- 五仓已有每日定时任务：star-history.yml（cron 17 2）、thanks.yml（cron 37 2 / 47 2 / 47 2 / 37 2），ilife 没有。
- 如果再加一个 readme:sync 定时 workflow：① 会和已有任务在同一份 README 上竞争提交（非快进失败）；② 公开仓 60 天无活动会被 GitHub 自动禁用（GitHub 官方文档原文已核）。
- **修正**：不新增定时 workflow；改成手动 `npm run readme:sync` + 每仓 CI 加 `--check` 门禁；若要自动化，等第二阶段并入现有 thanks workflow 的同一次提交。

### F7 🟠 星图 / 致谢收编收益低、风险高（与已定 D3-B 冲突，需你拍板）

- 五仓已有成熟致谢脚本（325-376 行 ×5，gh CLI 增量拉编号，--render-only 模式），并有每日定时任务；ilife 本来就没有 star/thanks workflow。
- 把渲染收编进 base 的收益只是「风格统一」；风险是仓主要删掉自己成熟的脚本和 workflow，且 base 的渲染要覆盖 9~10 个 README 变体。
- 建议：v1 只交付「联系块」（弹窗 + README 联系区）；星图/致谢放 v2，且**先只做渲染、不动 workflow**。这推翻了此前 D3-B 的「一次性做完三块」。

### F8 🟠 发布自动化缺失：「数据更新 = 发版」会卡在维护者手上

- 修正：base 仓加 contact-publish.yml（push contact/ 触发或手动 dispatch）：bump patch → npm publish → 打 tag。
- 一次配置，之后微信码周更只需提交图片 + manifest，自动生效。
- 前提：npm token / trusted publishing（交接文档 03 写清）。

### F9 🟡 隐私与流量：默认只在打开弹窗时请求（正确）

- 建议：设置面板挂载时不请求；弹窗 open 时才 fetch；会话缓存 30 分钟；超时从 1500ms 放宽到 3000ms 并做双通道 race（unpkg / jsDelivr / npmmirror）。

### F10 🟡 i18n 不要硬依赖宿主 locale 服务

- 已取证宿主有 locale 服务（palette types/dsh.d.ts:67-71：getLocale()/register/subscribe）；im-companion 的回退链是 html[lang] → navigator.languages → zh（src/client/i18n/install.ts:42-72）。
- base 照抄这条回退链 + 允许显式覆盖即可，避免在 ilife（没有 React 注入、也不一定有 locale 服务）等场景失败。

### F11 🟡 弹层生命周期：设置面板关闭时 dialog 不能残留

- openContactModal 返回 close()；调用方在面板 unmount 时调用；base 内部监听 dialog 的 close 事件自动清理；Esc、点遮罩同样处理。
- 弹层用原生 <dialog>.showModal()（top layer，真机验证过 z-index 压不住），不用自绘 modal。

### F12 🟡 字节级快照不存在基线：首跑会产生大 diff

- 修正：先 `readme:sync --write` 跑一次产生「迁移基线」，人工确认后作为快照；之后 CI 只检查 marker 区块内一致。

### F13 🟡 包名容易被误解为「可安装的 DSH 插件」

- README 第一行写明「这是库，不是插件；不注册任何槽位」。

### F14 🟡 移动端无法自扫：要有兜底

- QQ 群号可点击复制/展示纯文本；微信/飞书码在窄屏下放大显示；过期时给「点此获取最新群二维码」链接。

### F15 🟡 README 联系区图片：整卡还是裁图

- 现状：五仓 README 用整卡图（900×1600，260px 宽），卡片上 baked-in 了群名与有效期文字。
- 保持「外观一致」→ README 继续用整卡（远程 URL）；代价是 contact/ 数据包要存整卡（约 440KB），npm 包体积可接受。
- 换成「裁图 + 文字」更清爽、体积小，但改变现状外观 → 默认按「保持现状」走。

---

## 3. 修正后的目标架构

```
manage 仓（github.com/FeatherHunter/featherhunter-plugin-manage，public）
├── contact/                        ← 数据真源（唯一）
│   ├── manifest.json               ← schema/revision/updatedAt/minClient/groups
│   ├── feishu-permanent.png        ← 整卡（README 用）
│   ├── qq-permanent.jpg
│   ├── wechat-YYYY-MM-DD.png
│   └── qr/                         ← 裁图（弹窗用，320px 16 色）
├── packages/base/                  ← npm 包 dsh-featherhunter-plugin-base
│   ├── src/core|client|node/
│   ├── scripts/contact-update.ts   ← 裁图 + 校验 + 写 manifest + 打印对比图
│   ├── scripts/readme-sync.ts
│   └── dist/                       ← 单文件、零 import 的 client 产物
├── .github/workflows/contact-publish.yml  ← 提交 contact/ 自动 patch 发布
├── docs/handover/01|02|03*.md      ← 五仓接入补丁 / README 迁移 / CI 与发布
└── scripts/sync-contact.cjs        ← 迁移到 packages/base 的 readme-sync，双跑一段时间
```

**数据流**

1. 维护者拿到新微信码 → `npm run contact:update -- 新图.png`（自动裁图、几何校验、生成对比图、写 manifest、清理 8 周前旧图）；
2. 提交 contact/ → CI bump patch 并 npm publish；
3. 五仓用户浏览器：打开弹窗 → fetch unpkg @latest manifest（1~5 分钟内可见）→ 校验收到的精确版本图片 URL → 加载图片；
4. 维护者每周只做第 1、2 步；五仓**不用发版**。

**代码与数据的分工**

| 层 | 内容 | 更新频率 |
| --- | --- | --- |
| 代码（npm 包） | 弹窗组件、README 渲染器、CLI、内置基线 | 功能迭代时 |
| 数据（同包 contact/） | 清单、整卡、裁图、有效期 | 每周 |
| 五仓 | 只加一个依赖 + 几行入口 + workflow 片段 | 一次性 |

---

## 4. 需要你拍板

### P-A 传输通道（推荐 npm CDN）

| 选项 | 说明 |
| --- | --- |
| A1 npm CDN（推荐） | 清单 unpkg @latest、图片 jsDelivr npm 精确版本、npmmirror 兜底；与 npm 发布共用一条链 |
| A2 继续 GitHub CDN | 少动规格，但终端可达性不可证，且多一条运维链 |
| A3 双写 | 两套都发，成本翻倍，不推荐 |

### P-B v1 范围（推荐只做联系块）

| 选项 | 说明 |
| --- | --- |
| B1 只做联系块（推荐） | 弹窗 + README 联系区；星图/致谢 v2 且只做渲染不动 workflow |
| B2 三块都做（原 D3-B） | 符合你此前的决定，但要迁 9~10 个 README 变体、与五套现有自动化协调 |

### P-C 弹窗列数（推荐 4 列，需真机验证一次）

| 选项 | 说明 |
| --- | --- |
| C1 4 列（推荐） | 与 README 联系区「三列」不同但面板更宽；码约 150-160px |
| C2 3 列 | 码更大更稳，但 800px 面板偏空 |

### P-D ilife 入口位置（推荐总管页 1 处）

| 选项 | 说明 |
| --- | --- |
| D1 总管页 1 处（推荐） | dsh-life-pack 的 section 加「联系我们」按钮；子页不加 |
| D2 每个子页各 1 处 | 6-7 个入口，用户更容易找到，但重复且改动面大 |

**我建议按默认值走的两个小项**（你可以推翻）：

- E 微信码过期时：隐藏微信卡 + 显示「点此获取最新群二维码」链接（推荐），而不是灰卡警示；
- F README 联系区：继续用整卡图（保持现状外观，推荐），不改成裁图 + 文字。

---

## 5. 拍板后要改的规格（规格票 00）

| 位置 | 现状 | 改成 |
| --- | --- | --- |
| spec:52 裁图 + jsQR 校验 | 解码通过才发布 | detect 定位 + 几何校验 + 人工确认 |
| spec:89 取数通道 | jsDelivr gh 主 / raw 备 | npm CDN（unpkg 清单 + jsDelivr 精确版本图片 + npmmirror 兜底） |
| spec:134 测试接缝 4 | jsQR 解码 | 几何校验 + 快照 |
| 包体积估算 | 约 100KB 级 | 约 71KB base64（三码）/ 约 49KB（两码） |
| 新增 | 无 | manifest schema 校验、contact-publish workflow、不新增定时 workflow 的约束 |

---

## 6. 证据附录

### A. CDN 端点实测（本机，Asia/Shanghai）

| 端点 | 状态 | 缓存头 |
| --- | --- | --- |
| registry.npmmirror.com/react/18.3.1/files/package.json | 200 | public, max-age=31536000 |
| cdn.jsdelivr.net/npm/react@18.3.1/package.json | 200，CORS * | immutable, 1 年 |
| cdn.jsdelivr.net/npm/react@latest/package.json | 200 | max-age=604800, s-maxage=43200（7 天，太旧，不用） |
| unpkg.com/react@latest/package.json | 200 | max-age=60, s-maxage=300（够新，用） |
| github.com/FeatherHunter/featherhunter-plugin-manage | 200（公开仓） | — |
| registry.npmjs.org/dsh-featherhunter-plugin-base | 404（包名未占用） | — |

### B. 二维码解码实测

- OpenCV 5.0.0 QRCodeDetector：飞书成功（内容为 applink.feishu.cn 链接，长 118）；QQ 失败；微信失败。
- jsQR 1.4.0：飞书成功；QQ/微信失败。
- 裁图定位框：飞书 [260,682,642,1064]（382×382）；QQ [158,527,772,1141]（614×614）；微信 [141,582,761,1202]（620×620）。
- 裁图文件：.scratch/probe/crops/；对比图：.scratch/probe/opt/all-compare.png。

### C. 裁图体积实测（加 12% 白边后缩放）

| 码 | 240px 16 色 | 320px 16 色 | 320px 原图 |
| --- | --- | --- | --- |
| 飞书 | 9.4KB | 13.4KB | 33.1KB |
| QQ | 14.2KB | 23.1KB | 99.9KB |
| 微信 | 12.0KB | 16.9KB | 50.5KB |

### D. 五仓构建形态（详见 F3 表）

deck 自研 build.mts；palette 自研零依赖 mini-bundler；im/prompt tsdown；ilife tsc -b。

### E. 五仓定时任务

| 仓 | star-history.yml | thanks.yml |
| --- | --- | --- |
| deck | 17 2 * * * | 37 2 * * * |
| palette | 17 2 | 37 2 |
| im | 17 2 | 47 2 |
| prompt | 17 2 | 37 2 |
| ilife | 无 | 无 |

### F. 已核文档

- GitHub Docs（禁用与启用 workflow）：公开仓 scheduled workflows 连续 60 天无活动会被自动禁用（原文已抓取核对）。
- DSH 宿主 locale 服务：palette types/dsh.d.ts:67-71。

---

## 7. 拍板结果与规格落实（2026-10-30）

### 7.1 拍板映射

| 审查项 | 用户决策（原话见规格票「维护者原话」第二条） | 规格落实位置 |
| --- | --- | --- |
| P-A 传输通道 | **npm CDN**：清单 unpkg @latest、图片 jsDelivr 精确版本、npmmirror 兜底 | spec.md §3 |
| P-B v1 范围 | **四块全做**：联系 / 星图 / 致谢 / 作者其他插件 | spec.md §6 |
| P-C 弹窗列数 | **4 列**，窄屏降 2/1 列 | spec.md §5 |
| P-D ilife 入口 | **总管页 1 处**，六个子品页不改 | spec.md §8 |
| 新增：推荐位 | 「一物两版」：设置面板控件 + README 中英两版 | spec.md §4、§6 |
| 默认 E | 微码过期只降级该卡为链接、绝不展示过期码 | spec.md §2 规则 4、§5 降级 |
| 默认 F | README 联系区用整卡（260 宽），弹窗用裁图 | spec.md §6、§5 |

### 7.2 审查发现 → 处置

| 发现 | 处置 |
| --- | --- |
| F1 传输通道（硬伤） | 采纳：改 npm CDN，规格 §3 已重写 |
| F2 jsQR 门禁不可行（硬伤） | 采纳：门禁改「OpenCV 检测框 + 覆盖比 + 尺寸 + 真机确认」，规格 Testing Decisions 已写明理由 |
| F3 三行接入不成立（硬伤） | 采纳：产物限定单文件零 import；交接文档逐仓写登记方式；规格 §1、§8 |
| F5 列数与可扫性 | 采纳：4 列确定，但码面 ≥150px 与「真机确认」列为验收项 |
| F6 README 文件数 / 不可新增定时 workflow | 采纳：11 个文件写进规格；同步走本地 `--all` 或挂现有 workflow，不新增 schedule |
| F8 contact 发布自动化 | 部分采纳：周更不额外造 pipeline，复用 `npm version patch && npm publish` |
| F9 预取 / 缓存 / i18n / dialog 生命周期 / 快照基线 / 移动端兜底 | 全部写进规格 §3、§4、§5、Testing Decisions |
| F7 星图 / 致谢「收益低」 | **被用户决策推翻**：用户明确要求四块全做，保留但把风险写进交接文档 |

### 7.3 新发现 F16（本次调研补充）

**作者其他插件区在设置面板与 README 里已严重漂移，且 README 版此前未被纳入维护链。**

- 设置面板五份实现各不相同：deck 4 行含自己（`src/client/views/SettingsPage.ts:29-35`）、palette 3 行不含自己（`runtime/client.ts:1701-1766`）、prompt 4 行含自己（`src/client/settings-links.ts:22-30`）、im 仅 2 行（`src/client/components/panel.ts:162-166`）、ilife 4 行不含自己（`packages/plugin-manager/src/nav.ts:141-168`）。
- README 已有 10 处 MORE 块（deck 3、palette 3、im 2、prompt 2），ilife 缺失；全部排除自己、都含 ilife，但文案数字互相矛盾（panel 说 27/34/24/9，另一处说 25/38，README 说 38 款 / 27 个技能 / 30 万 star）。
- ilife 已于 2026-09-18 拍板「文案不写数字」，但该口径没有传导到其他四仓。
- **2026-10-30 仓主定稿（推翻禁数字口径）**：五条文案逐字给定（deck「近 30 万 star…27 个技能」、prompt、palette「38 款…20+自定义主题」、im、ilife「⚠️建设中⚠️…」），顺序 deck → prompt → palette → im → ilife，落库 `contact/plugins.json`；每条带 `verifiedAt`，`doctor` 超 90 天未核对提醒。禁数字建议作废，但仍禁止「无来源随手编数字」。
- 结论：推荐位必须与联系区同源同链（manifest.plugins + 两个渲染器），否则每加一个插件要改 15 处；规格已把它列入 v1 范围。

### 7.4 仍未消除的风险（交接时提醒仓主）

1. **中国大陆可达性**：本机实测 unpkg / jsDelivr / npmmirror 均 200，但可能是代理结果；三通道全失败时靠内置基线兜底（功能不中断，只是没有最新微码）。
2. **4 列可扫性**：4 列 × 约 165px 卡宽下码面约 150px，理论可扫（飞书裁图在 120px 仍可解），但 QQ/微信码风格特殊，必须真机确认；`columns` 参数保留可降列。
3. **iLife 只测总管页**：子品页不放入口是产品决策，若仓主后来想加，属于新需求。
4. **npm 发布凭据**：包名未被占用，但发布需要 NPM_TOKEN 或 trusted publishing 配置，属仓主侧一次性动作。

## 8. 拆分与可发布性审查（2026-10-30，/to-tickets 之前）

### 8.1 第一性原理：这份交付的真实价值路径

交付价值只有三条，其余都是手段：

1. **一份数据 → 五个设置面板 + 十一个 README 文件**：改一次，五仓一起变。
2. **周更换码 → 一条命令 + 一次发布**：不再改五仓。
3. **五仓零改动接入**：包必须能被四种异构构建链原样吃下。

由此推出五个「不成立就全盘作废」的假设，票序必须按它们排序，而不是按代码层排序：

| 编号 | 假设 | 不成立会怎样 | 最早可验证点 |
| --- | --- | --- | --- |
| R1 | 我真的能把包发布到 npm，并从三个 CDN 端点拉到它 | 远程清单、图片、README 图全废 | 首次真发布（不能只 mock） |
| R2 | 四种构建链能原样吃下 client 产物 | 「零改动接入」承诺破产 | dist 契约测试 + fixture 消费测试 |
| R3 | `<dialog>.showModal()` 真能在设置页上层显示、且二维码可扫 | 核心需求不成立 | 真浏览器 demo + 真机扫码 |
| R4 | README 四块能被确定性重生成且不丢内容 | 迁移即破坏五个仓库的门面 | 现状 fixture 与差异矩阵 |
| R5 | 周更换码闭环（数据发布 → README 同步 → 客户端取新清单）真的闭合 | 「不再改五仓」的承诺破产 | 两次真实发布演练 |

### 8.2 拆分时的四个自欺（初稿已在修订版中改掉）

1. **把横向层伪装成纵向票**：「四个渲染器」各一张票、最后一张集成票——这是按层切，不是按用户可验证的路径切。修订为「一个 README 区域 = 一条垂直切片：渲染器 + fixture 同步 + `--check` 一次做完」。
2. **等价基准缺席**：没有先把五仓现状提取成 fixture，任何「迁移前后等价」都是自证；等所有渲染器写完再比，差异已经无法归因。修订为 fixture 票优先于全部渲染器票。
3. **把发布链放到最后**：R1/R5 在真发布之前只能用 mock 证明，等于没证明。修订为骨架之后立刻做一次 `0.0.1` 真发布冒烟。
4. **人类门禁不标注**：真机扫码、浏览器 top-layer、GitHub 实际渲染、五仓真实 bundler 接入，代理都无法自动验证；票里必须写 `HUMAN-GATE`，禁止代理自判「通过」。

### 8.3 新发现 F17–F30（README 四块实测 + 发布链复推）

**F17 README 四块的现状并不统一，统一必然改变外观。** 2026-10-30 实测 11 个文件：

- 星图四种形态：deck `<a href=…star-history.html><picture>` 双图＋外链；im `<picture>` 双图＋`width="720"`＋`<sub>` 角注；palette/prompt 单张 Markdown 图；ilife **完全没有**。
- 作者其他作品区：标题三种（HTML `<h2><sub>MORE</sub>`、`## 作者的其他作品 <sub>MORE</sub>`、en 的 `More from the author` / `More by the author`）；引言句、`<div align>`、行分隔符（`——` vs `—`）各不相同；**行集与顺序 6 种**；ilife 缺失。
- 联系区：10 个文件同形 + ilife 用 `## 反馈与联系`；图片是各仓 `assets/` 相对路径（`assets/…` 与 `../assets/…` 两种前缀，package README 第三种）。
- 致谢区：标记与三列表结构一致（五仓同源生成器），ilife 是空表；这一块才是真正可「语义等价」的。

**F18 「语义等价」（story 40）与「长得一样」（story 30）互相矛盾。** 建议改口径为：**内容等价**（成员/链接/文字/宽度/致谢数据一致）＋**模板统一**（允许外观微调），并**保留各仓既有功能元素**（deck 星图外链、im 的 width 与角注、ilife 的 Markdown 标题）；否则统一会静默删掉功能。故事 40 按新口径改写。

**F19 限时码在 README 的新鲜度闭环断裂。** 新方案把 README 图片指向 npm CDN 后，README 的图片 URL 必须随周更换版本而改写；四仓有每日常驻 workflow，**ilife 只有 push 触发的 ci.yml**。若不管，ilife README 的微码每周过期（直接违反 story 10）。最小修法：交接文档要求仓主在 ilife 现有 `ci.yml` 加 `schedule`（不新增 workflow 文件），退路是写明滞后并保留日期兜底。

**F20 「图片地址带精确版本号 + 永不换图」与「微码每周换」冲突。** 精确版本解决的是「不会拿到别的图」，但不能让旧 URL 变成新码；GitHub 的 camo 图片代理按 URL 缓存，换图不换 URL 会继续显示旧图。规则修正为：常驻码可钉任意已发布版本；限时码 = 精确版本 + 日期文件名 + `?v=YYYYMMDD`，由日更同步改写 URL（各仓星图 SVG 的 `?v=` 已证明这条路可行）。另：README 图片经 `camo.githubusercontent.com` 代理、由 GitHub 服务端抓取，**弹窗的客户端可达性问题不会传导到 README 图片**。

**F21 ilife README 需要「新增」两块而不是「迁移」**：星图与作者其他作品区它现在都没有。验收要允许新增，且新增的 HTML 形态要与其他仓一致（标题仍用它的 Markdown 风格？星图区建议随其他仓用 HTML；MORE 区保留它自己的 Markdown 标题）。

**F22 README 里存在脏行**：im `README.md:262` 有 `</div>>>>>>>> origin/master`（合并冲突残留）。`readme:init` 不能假设结构干净，遇到可疑行必须停手报错；`--check` 要能把它列为待人工处理。

**F23 新旧两条同步链路会双写**：新链路上线后，manage 仓 `scripts/sync-contact.cjs` 必须退役（删除或归档），否则两边都能改 README，必然打架。该动作放进周更流水线票的验收，不放交接文档（这是我们自己的仓）。

**F24 图像处理依赖不该进包**：裁图框由固定模板一次性标定并固化进 `crops.json`（周更只换图、不重标），OpenCV 只用于 2026-10-30 取证，不进依赖；16 色量化只用于内置基线（一次性生成后提交），远端微码用常规压缩 PNG；避免为周更在 npm 包里塞 sharp/OpenCV。

**F25 「产物零 import」口径过宽**：只对 `./client` 成立；`./node` 的 CLI 必须能用 `node:fs`。需按入口分别约束，并加 dist 契约测试（client 无 `import`/`require`/动态 import/TLA）。

**F26 消费侧集成无法在本仓验证**（P-F 硬约束）：用 fixture 消费测试兜底——用 esbuild 把 dist 打成 plugin-like bundle、在 jsdom 里执行并渲染；palette 的逐文件登记 mini-bundler 是最高风险，写进残余风险与交接文档。

**F27 星图生成器不能被「统一」误删**：各仓 `star-history` workflow 仍在生成双色 SVG，渲染器只接管 README 引用；交接文档必须写「保留 SVG 生成器，只删 README 内联片段」。

**F28 版本节奏会失控**：每周 patch = 一年 52 个版本。渲染器在五仓钉死精确版本（不用 `^`），数据走 `@latest`：代码版本与数据版本解耦，一次坏版本不会一夜之间影响五个仓库。

**F29 README 图片 URL 应从绝对地址出**：现为三种相对前缀，迁移时统一成 CDN 绝对 URL，反而消掉了路径歧义（camo 会自行抓取）。

**F30 P-C 的「4 列」与只有 3 个群矛盾**：解释为「每行最多 4 列」（组数不足取组数、不留空列），或确实要补第 4 个码；需仓主确认。

### 8.4 修订后的切片（13 张，按依赖顺序）

| # | 票 | 阻塞于 | 交付的可验证行为 |
| --- | --- | --- | --- |
| 01 | 包骨架、三入口契约与 demo 壳 | — | 构建/测试/pack 门禁；dist 契约测试；demo 壳可加载 |
| 02 | 首次真实发布冒烟（0.0.1）与三通道可达性 | 01 | 真发布后 unpkg / jsDelivr / npmmirror 实测拉取 |
| 03 | 群组数据链与内置基线 | 01 | 数据可复现构建、几何门禁、基线模块与体积上限 |
| 04 | 联系弹窗 v1（内置基线） | 03 | demo 点开弹窗、生命周期、降级占位、jsdom 测试 |
| 05 | 远程清单通道与换码演练 | 02、04 | 三通道/超时/缓存/有效期降级；真实换码一次 |
| 06 | 作者插件推荐卡 AuthorPlugins | 03 | 面板卡 5 条、排除 self、顺序与样式 |
| 07 | README 现状 fixture 提取与等价口径 | 01 | 11 文件四块 fixture、差异矩阵、规范化比较器 |
| 08 | README 联系区渲染与同步（init/sync/--check） | 03、07 | 标记定位、两变体、CDN URL、幂等 |
| 09 | README 作者其他插件区渲染与同步 | 06、08 | 标题变体、行集统一、ilife 新增、旧行移除 |
| 10 | README 星图区与致谢区渲染 | 07、08 | 双图＋时间戳、保留外链/宽度/角注、ilife 新增、致谢标记 |
| 11 | 全量同步门禁与 doctor | 09、10 | 五仓 fixture `--all`、`--check` 非零退出、doctor 结论 |
| 12 | 周更发布流水线与两次真实发布演练 | 05、11 | `contact:update`、周更脚本、旧 sync-contact 退役、换码两次发布 |
| 13 | 三份交接文档＋最终验收走查 | 04、06、11、12 | 逐仓可执行步骤、YAML、HUMAN-GATE 清单、残余风险 |

关键边：02 与 03/07 可并行（02 只依赖骨架）；07 不依赖任何 UI 代码，应该尽早开工；11 是全量门禁，必须在 09/10 之后；13 必须最后。

### 8.5 无法自动验证、必须 HUMAN-GATE 的部分

1. 真机扫码：飞书 / QQ / 微信各一次（4 列布局下 150~165px 码面）。
2. 真实浏览器 top layer：设置页滚动容器内打开 dialog、遮罩、焦点回归。
3. GitHub 上四块的实际观感（camo 抓图、深浅色 README 主题）。
4. 任一仓真实构建链吃下产物（尤其 palette 的逐文件登记 mini-bundler）。
5. 中国大陆网络下的弹窗远程清单表现（三通道全失败时是否优雅降级）。

### 8.6 需要仓主拍板（影响规格与票）

| 编号 | 待拍板 | 推荐 |
| --- | --- | --- |
| D-a | 「4 列」是否按「最多 4 列、组数不足取组数」解释 | 是（3 群三等分，不留空列；`columns` 仍可覆盖） |
| D-b | deck `docs/README.en.md` 现有的 `dsh-chinese-skill-patch` 行（不在 5 条定稿清单内） | 移除（保留则需加进 plugins.json 变 6 条） |
| D-c | README 外观：内容等价 + 模板统一，保留各仓既有功能元素 | 是（否则 star 外链、im 角注会被静默删掉） |
| D-d | ilife README 补星图 + MORE 两块；并在 ilife 现有 `ci.yml` 加 `schedule` 保微码新鲜 | 是（否则 ilife 微码每周过期） |

