<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: hac2-t3 -->
<!-- DSH-CREATED: 2026-10-31T10:35:02.641Z -->
<!-- DSH-BLOCKED-BY: 01, 02 -->
# 03: ActionCluster v2 按选定方向落地 + demo 状态样张


**What to build:** 按票 01 拍板的方向落地 base 页头操作区：
- 形态采用 **B 静默簇**：无容器、无边框，三枚按钮间距 4，按钮 28×28；容器不响应 hover、无选中态。
- 图标尺寸统一 16px（不再保留 18 档差异）；Issue 落点统一到 <repo>/issues 列表页（不强制 /issues/new）；只保留页头图标入口，面板底部联系整行在五仓移除（base 组件可保留给其它使用者）。
- **重做三个入口的图标**：不要现有单色线稿，改为彩色、精致、有质感的 SVG（参考玫瑰 emoji 的鲜艳度与完成度）：联系=交流群/对话气泡、Star=金色星标、Issue=反馈气泡（内感叹号）；16px 下必须清晰可辨，浅色/深色背景都要好看，不能糊。
- **状态设计**：默认 / hover / active / focus / disabled 五态；hover 用共用 HoverTip 显示原三句文案；hover 可加轻量动效（联系气泡轻浮、Star 星光闪、Issue 轻晃），必须尊重 prefers-reduced-motion 关闭；focus 用清晰 focus 环；disabled 去饱和降透明。
- 组件 API：items 数组驱动（id/icon/label/tip/href/onClick/disabled）、size 14|16|18、gap、variant（默认 quiet）、maxVisible 溢出；按钮直接渲染，不再被 HoverTip 的 span 包一层；气泡 160ms + aria-describedby；组 aria-label 泛称、每钮独立 Tab；demo 增加浅/深状态样张（默认/hover/active/focus/disabled）；旧 ActionGroup 保留一版兼容。

- [ ] 三枚彩色 SVG 图标在 16px 下语义可辨、浅深色都可读，不靠气泡也能大致猜出功能
- [ ] 五种状态在 demo 浅色、深色下肉眼可辨
- [ ] hover 微动效存在且可被 prefers-reduced-motion 关闭
- [ ] 按钮悬浮用共用 HoverTip 显示文案（不是原生 title）
- [ ] 静默簇形态：无容器、gap 4、容器不响应 hover；Issue 落点 /issues 列表；只留页头图标
- [ ] base 单测与 demo 构建绿；现有调用不被破坏

**Blocked by:** #01, #02

**Status:** resolved

- [ ] 四种状态（含 hover 与 focus）在 demo 浅色、深色下肉眼可辨
- [ ] 溢出与第 4 钮按 maxVisible 行为正确
- [ ] 无障碍：组 role/aria-label、每钮 aria-label/Tab、气泡 aria-describedby
- [ ] base 单测与 demo 构建绿；现有调用不被破坏

## Comments

### local — 2026-10-31T10:53:34.530Z
图标设计样张已出（票 03 的视觉输入，待用户确认）：prototype 分支 253b0ff，文件 packages/base/prototype/action-icon-set.html。三个彩色 SVG：联系=两枚叠放对话气泡（蓝→紫渐变）、Star=金色渐变五角星（高光+星光）、Issue=珊瑚粉渐变气泡（白色感叹号）；48/32/24/16 四档放大 + 浅/深各 5 状态（默认/hover/active/focus/disabled）+ hover 动效（floaty/twinkle/wiggle，prefers-reduced-motion 全关）+ B 静默簇页头 mock（92×28，无容器）。截图 .tmp/ui-mock/icon-set-full.png。用户确认配色与图形后即进实现。

### local — 2026-10-31T11:04:05.580Z
按用户反馈迭代图标样张 v2（prototype 分支最新 commit）：去掉悬浮/按下的灰色背景，改为 1) 悬浮=同色柔光晕 + 图标动效（联系双气泡上浮+三个白点轮流亮；Star 大星缩放旋转提亮循环+四周四颗小星光错峰眨眼+光晕呼吸；Issue 气泡左右轻摇+感叹号弹跳+小星光闪）；2) 按下=整枚下沉 1px 缩到 .88、光晕放大回落，不再有灰底；3) focus 环、disabled 去饱和保留；prefers-reduced-motion 全关。样张：packages/base/prototype/action-icon-set-v2.html，截图 .tmp/ui-mock/icon-v2-full.png，逐帧动效 .tmp/ui-mock/anim-demo.gif 与 anim-star-grid.png。等用户确认后进实现。

### local — 2026-10-31T11:20:14.056Z

### local — 2026-10-31T11:20:17.718Z
commit 495c6b7 落地 ActionCluster v2（B 静默簇 + 彩色图标 + 动效 + 共享 HoverTip + maxVisible 溢出）；typecheck exit 0、vitest 338 passed（6 个 CDN smoke skipped）、build 与 build:demo exit 0，demo 浅/深五状态截图已核对
## 实现完成（B 静默簇 + 彩色图标 + 动效）

**代码**：commit 495c6b7（9 files, +1314/-81）
- 新增 `packages/base/src/client/cluster.ts`：`createActionCluster(React, deps)` → `ActionCluster` 组件。items 数组驱动（id/icon/label/tip/href/onClick/disabled/className），默认三条目 contact + star(repoUrl) + issue(`issuesUrl` 或 `<repo>/issues`，不再 /issues/new)；`size` 14|16|18（默认 16，按钮 = 图标 + 12）、`gap`（默认 4）、`variant` quiet|tray、`maxVisible` 溢出「⋯」菜单。B 静默簇 = 无外框、无分隔线、容器不响应 hover，只有 N 枚独立按钮。
- 新增 `packages/base/src/client/cluster-icons.ts`：三枚彩色渐变 SVG（联系=蓝紫叠气泡+白点呼吸；Star=金色渐变星+径向光晕+四颗小星光；Issue=珊瑚粉气泡+白色感叹号）+ 溢出三点图标。
- 新增 `packages/base/src/client/hover-tip.ts` 共享 `mountTip` 引擎：气泡挂在 body、160ms 离开延迟、同屏一枚、视口钳制、Escape 关闭，按钮 `aria-describedby` 指向气泡；按钮本身直接渲染（不再被 HoverTip 的 span 包裹）。
- 改写 `styles.ts`：去掉 hover/active 灰底，改为每枚按钮的径向柔光（蓝/金/粉）；hover 动效（气泡轻浮 + 白点脉冲 / 星光闪烁 + 光晕呼吸 / 气泡轻晃 + 感叹号弹跳）；active 收紧、focus 2px 蓝环、disabled 去饱和；`prefers-reduced-motion: reduce` 全关动画。
- 接线 `index.ts`（`ui.ActionCluster` + `ui.clusterIcons`，host 侧 uid 保证 SVG 渐变 id 唯一）、`types.ts`（ActionClusterItem/Props、ClusterIconSet）、`texts.ts`（moreActions / 更多操作）。旧 `ActionGroup`/`ActionButtons` 保留一版兼容。
- demo/main.tsx 重写：浅/深两套五状态样张（默认 / 悬浮 / 按下 / focus / disabled）、14/16/18 三档、第 4 项溢出菜单、旧控件对照、常驻气泡与弹窗/ContactRow/作者插件卡。

**验证**：
- `npm run typecheck` exit 0
- `npx vitest run` → 27 files passed | 1 skipped；338 tests passed | 6 skipped（6 个为 CDN 网络 smoke）
- `npm run build` 与 `npm run build:demo` 均 exit 0
- demo 截图：`.tmp/ui-mock/cluster-demo-crop.png`（整页）、`cluster-demo-part1/2.png`；页头浅/深色、五状态、三档尺寸、溢出菜单、focus 环、disabled 灰态均肉眼确认（彩图 16px 清晰，深浅色都可读）

**遗留**：`packages/base/.tmp-render-trio.mjs` 为临时脚本未跟踪；尺寸三档仅 demo 展示，五仓实际统一 16（票 05 落地）。

## 进度

- 进度：100%（2026-10-31T19:20:12+08:00）：ActionCluster v2、彩色三图标、五状态动效、共享气泡与溢出菜单落盘；typecheck/build/build:demo/vitest 全绿，demo 截图人工确认
