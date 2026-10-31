<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 页头操作组 ActionCluster v2 与 base 0.1.2 五仓换代 -->
<!-- DSH-STATUS: ready-for-agent -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: hac2-spec-0001 -->
<!-- DSH-CREATED: 2026-10-31T10:32:22.462Z -->

## 目的
把 base 包的页头操作组从「三件套胶囊」收敛为语义正确的 Action cluster（一个容器 + N 个独立按钮），删掉 0.1.1 残留的分段控件死规则与错误文档，修掉 hover 区分度与最后一天有效期文案问题，发布 base 0.1.2，五仓换代，最后装进 web profile 由用户本人人眼验收。

## 背景
- base 0.1.1 已发布、五仓已接入。用户已纠正设计语义：三个按钮互相独立，容器只承担归组，不是「一个按钮切三段」。
- 0.1.1 里残留两条永不命中的分段控件规则（7px 内切圆角、发丝分隔线）与多处错误注释/README 描述，需删除而非补全。
- 待修：最后一天有效期显示「0 天内」；托盘内按钮 hover 与容器同 token 可能不可见；组 aria-label 写死三项名。
- 五仓验收口径由用户确定：安装到 web profile 后由用户本人人眼验收，不以代理截图代替。

## 范围与顺序
1. 四方向原型 + 方向拍板（含 Issue 落点 / 尺寸 / 双联系入口三项口径）
2. base 预清理与最后一天文案修正
3. ActionCluster v2 + demo 状态样张（等 1、2）
4. base 0.1.2 构建与发布（等 3）
5. 五仓升 0.1.2 并打包 tarball（等 4，合为一票）
6. 装进 web profile + 用户本人目验 + HUMAN-GATE 收口（等 5）
7. base 0.1.3 远端二维码加载兜底 + 五仓换代重装（等 6 真机取证发现的缺陷；票 07）

## 验收口径
- base：vitest/typecheck/build 绿，0.1.2 三通道可读，demo 状态样张与选定方向一致。
- 票 07（真机取证后追加）：联系弹窗三张卡（飞书/QQ/微信）在冷启动首次打开即有码，离线时三卡仍有内置基线码；0.1.3 三通道可读、五仓 banner v0.1.3、重装后用户复核通过。
- 五仓：门禁与定向测试绿，产物 banner v0.1.2（票 07 后为 v0.1.3），tarball 可安装，逐仓 commit+push。
- 最终：五个插件在 web profile 中由用户本人目验并逐项记录结论；票 14 更新，规格由用户在详情页点「完成」收口。

## 说明
- web profile 安装方式：dsh plugin --profile web add <tarball>（按包内 cordis.patch.yml 自动装配 bundle 层，不手改 profile；装前备份 package.json 与 pnpm-lock.yaml）。
- 用户是技术小白：技术取舍由代理决定，票面只呈现可视化结果与可回滚方案。

## 进度
