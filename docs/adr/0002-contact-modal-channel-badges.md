# ADR-0002 联系弹窗群卡标题行加渠道官方徽标

- 状态：已接受（2026-11-01，票 `.scratch/contact-channel-badges/issues/01` 实施时补记）
- 相关：`.scratch/base-package/spec.md` §2 规则 9 / §5 群卡、`docs/base包与联系弹窗-方案.md`、票 14 的 C4/C6 观感证据

## 背景

规格 §5 把群卡定义为「标题（13px 600）/ 副行 / 二维码 / 角注」，§2 规则 9 又把弹窗版字段分工写成「`title` / `subtitle` / `note` / `qr` + `validUntil` 角注」，两处都没有徽标位。结果是弹窗三张卡的标题全是同一句「DSH 插件交流群」：README 联系区靠表头文字区分渠道，弹窗没有表头，三张卡在视觉上无法区分。

owner 2026-11-01 观感复核要求卡片名前加渠道官方 LOGO（各品牌政策允许标识平台身份），拍板方案 B（18px 彩色圆角块 + 白色官方标志），并明确要求「以后增加渠道时也能轻易加 logo」。

本 ADR 记录的是**规格字段表之外的新增**：避免后来者把徽标当成越界实现删掉，也避免被当成与规格冲突的 bug 重新评审。

## 决定

1. 群卡标题行 = 渠道徽标 + 群名。徽标 `aria-hidden`，渠道名以 `.dsh-base-visually-hidden` 文本放在可见群名前，读屏器读「渠道 + 群名」；可见群名保持原样。
2. 渠道标识表放 `packages/base/src/client/channel-badges.ts`：一条渠道 = 一行（`platform` / `labelKey` / 品牌色 / viewBox / paths / fillRule）。新增渠道 = 加表项 + `contact/groups.json` 加一条数据，渲染器不动；未知 `platform` 静默不出徽标。
3. 官方标来源与商标归属写在模块头注释：飞书 = ByteDance IconPark `lark`（#3370FF）；QQ = Simple Icons `tencentqq`（#12B7F5）；微信 = Simple Icons `wechat`（#07C160）。只用于标识平台身份，不重绘、不改品牌色。
4. 渠道名走与其它文案相同的 `texts` 覆盖机制（`channelFeishu` / `channelQq` / `channelWechat`），宿主可整体替换。
5. 微信卡删除与标题重复的副行「群聊：DSH 插件交流群」；渠道名由徽标 + 读屏文本承担。

## 后果

- 含徽标的 base 版本合入后，票 14 的 C4/C6 群卡观感截图作废，需按票 14 口径重做（票 14 保持 open 等 owner 重验）。
- 改动属于 `packages/base/**`，超出 base-package-rollout 规格范围，由独立票承载；README 联系区不变（仍用表头 + `readmeTitle`）。
- 离线 baseline 的 `BUNDLED_PLATFORMS`（`packages/base/scripts/build-data.ts`）仍按三渠道写死；新增渠道若要在断网时也有内置码，还要补内置二维码图与 crops，这与徽标表解耦。
