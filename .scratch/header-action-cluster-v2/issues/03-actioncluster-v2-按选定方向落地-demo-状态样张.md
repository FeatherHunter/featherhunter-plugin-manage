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

**Status:** ready-for-agent

- [ ] 四种状态（含 hover 与 focus）在 demo 浅色、深色下肉眼可辨
- [ ] 溢出与第 4 钮按 maxVisible 行为正确
- [ ] 无障碍：组 role/aria-label、每钮 aria-label/Tab、气泡 aria-describedby
- [ ] base 单测与 demo 构建绿；现有调用不被破坏

## Comments

### local — 2026-10-31T10:53:34.530Z
图标设计样张已出（票 03 的视觉输入，待用户确认）：prototype 分支 253b0ff，文件 packages/base/prototype/action-icon-set.html。三个彩色 SVG：联系=两枚叠放对话气泡（蓝→紫渐变）、Star=金色渐变五角星（高光+星光）、Issue=珊瑚粉渐变气泡（白色感叹号）；48/32/24/16 四档放大 + 浅/深各 5 状态（默认/hover/active/focus/disabled）+ hover 动效（floaty/twinkle/wiggle，prefers-reduced-motion 全关）+ B 静默簇页头 mock（92×28，无容器）。截图 .tmp/ui-mock/icon-set-full.png。用户确认配色与图形后即进实现。

### local — 2026-10-31T11:04:05.580Z
按用户反馈迭代图标样张 v2（prototype 分支最新 commit）：去掉悬浮/按下的灰色背景，改为 1) 悬浮=同色柔光晕 + 图标动效（联系双气泡上浮+三个白点轮流亮；Star 大星缩放旋转提亮循环+四周四颗小星光错峰眨眼+光晕呼吸；Issue 气泡左右轻摇+感叹号弹跳+小星光闪）；2) 按下=整枚下沉 1px 缩到 .88、光晕放大回落，不再有灰底；3) focus 环、disabled 去饱和保留；prefers-reduced-motion 全关。样张：packages/base/prototype/action-icon-set-v2.html，截图 .tmp/ui-mock/icon-v2-full.png，逐帧动效 .tmp/ui-mock/anim-demo.gif 与 anim-star-grid.png。等用户确认后进实现。

## 进度
