# GLOSSARY

## 联系区

**联系区**:
各插件 README 尾部统一的联系区块 = 联系标题 + 欢迎语 + 群表横排，除此之外不加任何文案；群数量不限，当前实例为 3 列。
_Avoid_: 反馈与联系（仅指标题文字时）、群组（仅指群集合时）、联系我（指源图与同步功能时）、三群 / 三群表（已废弃，写死数量）、加入我们 / Join / Connect / 交流群 / 话题群（已废弃）

**联系标题**:
居中两行 `<sub>CONNECT</sub>` + `反馈与联系`，英文页为 `Feedback and Contact`（ilife 用 Markdown 二级标题对等落地）。
_Avoid_: 反馈与联系直呼（不分标题与区时）、CONNECT 直呼

**欢迎语**:
“👏欢迎提交PR、ISSUE。星星之火可以燎原🔥有任何建议、意见、想法、吐槽、idea都可以进群交流。”标题与群表之间唯一一句话。
_Avoid_: 欢迎词、介绍语、Bug 与需求走 ISSUE 分流句（已删除）

**群表**:
N 列横排的群二维码表，一群一列，列序见列序规则；当前实例 3 列：飞书群（主）→ QQ 群（新）→ 微信群（新）。
_Avoid_: 三群表（已废弃，写死数量）、二维码表、群列表

**群列名**:
表头一群一格，形如 `{平台}群（{主/新}）`；当前实例 3 格：`飞书群（主）` / `QQ群（新）` / `微信群（新）`，英文页为 `Feishu Group (Main)` / `QQ Group (New)` / `WeChat Group (New)`。
_Avoid_: 群名（指卡内群名时）、表头直呼

**群卡片**:
每列的一张群卡 = 群名 + 二维码图 + 角注。飞书卡深色，QQ 卡浅色圆角，微信卡白色。
_Avoid_: 卡片直呼（指市场插件卡时）、二维码直呼（仅指图时）

**群名**:
各卡统一 `DSH 插件交流群`（微信卡写作 `群聊：DSH 插件交流群`）。
_Avoid_: 交流群、话题群（已废弃）

**群号与组织**:
QQ 卡独有 `群号：1020866453`；飞书卡为 `用户418832的组织`，不是群号；微信卡无号。
_Avoid_: 群号直呼（不指明 QQ 时）、组织直呼

**有效期注**:
飞书卡 `该二维码永久有效`；QQ 卡无有效期字样（源图常驻）；微信卡 `该二维码7天内有效，重新进入将更新`，每周换图。
_Avoid_: 有效期页脚（已删除的旧写法）、7天直呼（不指微信时）

**群组**:
管理仓维护的联系群集合，数量不限；当前 3 个成员：飞书群（常驻，主）`contact-feishu-permanent.png`、QQ 群（常驻新）`contact-qq-permanent.jpg`、微信群（限时新）`contact-wechat-weekly.png`。
_Avoid_: 三群（已废弃，写死数量）、联系区（指整节时）、联系我（指功能时）

**列序规则**:
主先新后，新内常驻先限时后，同级按接入时间；当前实例：飞书（主，常驻）→ QQ（新，常驻）→ 微信（新，限时）。
_Avoid_: 排序直呼（不指明群表列序时）、三群顺序、固定顺序

## 管理项目简称

本仓库管理的五个项目目录的固定中文简称。说简称即指该仓库目录本身，不指其内部单品、工作区备份与演示目录。

**matt插件**:
`D:\dsh-plugin\dsh-mattpocock-skills-deck` 仓库（npm 包 `dsh-mattpocock-skills-deck`）。
_Avoid_: deck、skills-deck、matt-demo-*、MattSkillsDeckUseDemo、dsh-matt-* 工作区

**助理插件**:
`D:\dsh-plugin\dsh-im-companion` 仓库（npm 包 `dsh-im-companion`），增强 dsh-im 的 companion 插件。
_Avoid_: dsh-im、dsh-im-main、IM 本体、助理概念（未落到 companion 插件时）

**调色板插件**:
`D:\dsh-plugin\dsh-opencode-palette` 仓库（npm 包 `dsh-opencode-palette`），品牌名为 OpenCode调色板。
_Avoid_: 调色盘插件、色板、palette 直呼

**提示词插件**:
`D:\dsh-plugin\dsh-prompt` 仓库（npm 包 `dsh-prompt`）。
_Avoid_: dsh-prompt-wt、_pr-dsh-prompt-*、prompt 直呼

**爱生活套件**:
`D:\dsh-plugin\ilife` 仓库（一个仓库、七个可独立安装的插件的居家生活套件）。
_Avoid_: 爱生活插件（单数指代仓库时）、ilife 单品直呼、dsh-life-pack（仅指爱生活卡本身）、爱生活卡（仅指卡时）

## 市场与图表

**A市场**:
`D:\dsh-plugin\awesome-dsh-plugin` 精选列表仓库及其发布的市场索引（`index.json`，数据源层）。
_Avoid_: awesome-plugin 直呼、dshmarket 插件（展示层）、dshmarket.com、Discover 发现页、dsh-plugin-mall 等其他市场

**市场插件**:
npm 包 `dshmarket`（如截图的 `v1.66.47`），装好后在 DSH 里打开的 `插件市场` UI（展示层），消费 A市场索引展示同一批插件。
_Avoid_: A市场（数据源）、awesome 直呼、Discover 发现页、dshmarket.com 网站直呼

**插件卡片**:
市场插件列表里一个插件的一张卡（如提示词插件那张黑卡）。卡上字段统称卡字段。
_Avoid_: 条目（那是 A市场 yml 侧的说法）、详情页

**插件名**:
卡片标题，如 `dsh-prompt`、`billion-context`。
_Avoid_: 包名直呼（口语可通，落词用插件名）

**作者名**:
插件名下的 GitHub 登录名，如 `FeatherHunter`、`ranxianglei`。
_Avoid_: 作者直呼（不带名时）、昵称

**版本号**:
作者名后的 `vX.Y.Z`，如 `v0.4.38`，指该卡当时展示的市场侧版本。
_Avoid_: 已安装版本（卡上 `已安装` 状态另说）、commit 号

**近30天下载**:
`↓ 11.5k / 近30天` 这组数字，近 30 天增量。
_Avoid_: 下载量（总量/增量不分时）、下载数直呼

**星数**:
`★ 73` 这组数字，GitHub stars 快照数。
_Avoid_: 星图（那是 `star-history.svg` 曲线）、徽章、收藏数

**简介**:
卡片里那段一句话，如“将一切重复、烦躁的模板化提示词保存下来”。
_Avoid_: 描述的文本、描述文本、description 直呼

**预览图**:
卡片里的截图轮播，来源是各仓 `screenshots.json` 声明的截图。
_Avoid_: README 配图、截图直呼（来源不分时）、视频直呼

**宿主要求**:
`DSH >=0.2.0-rc.2` / `未声明宿主要求` 药丸，对 DSH 版本的门槛声明。
_Avoid_: DSH门槛、版本要求、兼容性直呼

**分类标签**:
`UI 增强` 这类药丸，A市场分类在市场插件里的投影。
_Avoid_: 标签直呼（和宿主要求混时）、类别

**安装状态**:
卡片右上的 `已安装` vs `安装` 按钮，当前 profile 是否已装。
_Avoid_: 已装、装上、下载状态

**星图区**:
README 内 `docs/star-history.svg` 的星标增长曲线图，挂在联系区之后独立 `div`，图片走 `raw.githubusercontent.com` 绝对直链 + `?v=YYYYMMDDHHMM` 缓存戳。
_Avoid_: 星图（仅指曲线线条时）、star 图标、徽章（badge）、star-history.json 数据直呼

**星图标题**:
图内居中 `⭐ Star History`，图外不再另起段标题。
_Avoid_: 标题直呼（指联系/致谢标题时）

**左轴与右轴**:
左轴红色 `Total Stars`（累计星数），右轴青色 `Daily New`（每日新增），两轴共用同一日期横轴但量纲各自独立。
_Avoid_: Y轴直呼（不分左右时）、刻度直呼

**累计线与新增线**:
红实线为累计总数（单调上升），蓝虚线为每日新增（波动）。红线只读左轴，蓝线只读右轴；轴名横排染色兼作色键，不另画图例。
_Avoid_: 红线蓝线直呼（不说清累计/新增时）、曲线直呼

**峰值标注**:
两线各自最高点直接标数字（`data-peak="total"/"daily"`），描边用背景色衬底。
_Avoid_: 标注直呼、最大值

**日期轴与星图脚注**:
横轴 `Date` 为 UTC 日（首日前一天补零星起点）；右下角 `N stars · YYYY-MM-DD` 为总量与截止日快照。
_Avoid_: 时间轴、更新时间

## 推荐区

**推荐区**:
README 内 `MORE` 整节 = 推荐标题 + 推荐引导语 + 兄弟条目四行，位于 THANKS 之前，整段左对齐。
_Avoid_: MORE 直呼、作者的其他作品直呼（仅指标题文字时）、友链、广告区

**推荐标题**:
居中两行 `<sub>MORE</sub>` + `作者的其他作品`，英文页为 `More from the author`。
_Avoid_: MORE直呼（不分标题与区时）

**推荐引导语**:
“喜欢这个插件的话，这几个你可能也用得上：”（各仓措辞以门禁定稿句为准）。
_Avoid_: 导语、开场白

**兄弟条目**:
一行一个兄弟插件 = `**[插件名](链接)** —— 定稿简介`，恰好四条（除本仓外的兄弟），ilife 排最后。
_Avoid_: 条目（指 A市场 yml 或致谢行时）、插件列表、MORE行

**条目顺序**:
`dsh-prompt → dsh-mattpocock-skills-deck → dsh-im-companion → ilife`，门禁按此顺序逐字核对。
_Avoid_: 排序直呼（指致谢排名或三群列序时）

**建设中尾巴**:
ilife 行句尾 `⚠️建设中⚠️待正式发布`（英文页 `⚠️Work in progress⚠️pending official release`），状态标记前置或后置以各仓定稿句为准。
_Avoid_: 施工中、内测中、在建直呼

**致谢区**:
README 尾部的 `THANKS` 整节 = 标题 + 引言 + 致谢表 + 结语四件套。
_Avoid_: 致谢表（仅指表格）、THANKS 直呼

**致谢标题**:
居中两行 `THANKS` + `致谢`（ilife 用 Markdown 二级标题对等落地）。
_Avoid_: 致谢直呼（不分标题正文时）、感谢贡献者（对齐后废弃）

**致谢引言**:
“感谢每一位提交 Issue、PR 与参与讨论的朋友，是你们让这个插件一点点变好。”划定三类人。
_Avoid_: 欢迎语、开头句

**致谢表**:
引言与结语之间的三列表，行 = 人，列 = 谁/多少/凭什么。
_Avoid_: 致谢区、thanks 直呼、手工致谢名单、两列异形表

**贡献者列**:
`| 贡献者 |`，`[@login](https://github.com/login)` 可点跳转。
_Avoid_: 作者、贡献人、致谢人

**致敬列**:
`| 致敬 |`，`rosesFor(总数)` 打出的花串，长度即贡献计数。
_Avoid_: 花列、排名列、数量列

**贡献列**:
`| 贡献 |`，该人全部 `#n` 按组内号升序排成的链接串。
_Avoid_: 编号列、事项列、链接列

**致敬花**:
最小单位 `🌹` = 1 次贡献。
_Avoid_: 郁金香、花朵、emoji、🌷

**花数**:
一行花串的长度。
_Avoid_: 花朵数、星数

**贡献编号**:
`[#n]` 单个可点证据，指向 `issues|pull|discussions/n`。
_Avoid_: #号、Issue号直呼（PR/Discussion 也算时）

**贡献计数**:
`花数 = 编号数 = issues+prs+discussions+去重后comments`（同一人同一串评论只计一次）。
_Avoid_: 总数（不说清口径时）、提交数

**致谢结语**:
“也感谢在评论区与讨论区留下想法的每一位朋友……”收容无编号贡献并转成提 Issue 邀请。
_Avoid_: 页脚、结尾句

**中英两表**:
中文表（`| 贡献者 | 致敬 | 贡献 |`）与英文表（`| Contributor | Tribute | Contributions |`）同源渲染，包内说明第三处跟英文表走。
_Avoid_: 翻译表、副本

**准入规则**:
维护者本人、`ghost`、机器人不进表；无可引用 `#n` 的纯想法只进结语不进表。
_Avoid_: 过滤规则、排除规则

**排名规则**:
总数降序，同分看 `lastActive` 晚者在前，还同按登录名字典序，保证渲染逐字节稳定。
_Avoid_: 排序规则、顺序规则

**进位规则**:
`10000💎/1000👑/100🏆/10💐/1🌹` 从大到小贪心拼串（如 11=`💐🌹`）。
_Avoid_: 花升级、花升级规则、换算规则

## 联系我体系

**联系我**:
群二维码功能的统称，含根目录群码集与同步脚本（`scripts/normalize-contact.py`、`scripts/sync-contact.cjs`），群数量不限当前 3 图。
_Avoid_: 反馈与联系（仅指 README 区块标题）、群组（仅指群集合）、三群（已废弃，写死数量）

**群码**:
一群一图的源二维码统称，`contact-*.png/jpg`，随群增减当前 3 个：飞码 / Q码 / 微码。
_Avoid_: 二维码直呼（不指明哪群时）、三码

**飞码**:
`contact-feishu-permanent.png`，飞书群（常驻、主）二维码，排序第一。
_Avoid_: 飞书二维码、飞书群直呼

**Q码**:
`contact-qq-permanent.jpg`，QQ 群（常驻、新）二维码，排序第二。
_Avoid_: QQ二维码、QQ群码、QQ群直呼

**微码**:
`contact-wechat-weekly.png`，微信群（限时、新，7 天有效每周更新）二维码，排序第三。
_Avoid_: 微信二维码、微信群码、微信群直呼

## 设置面板通用件

**联系弹窗**:
设置面板里点动作行后弹出的群码弹层 = 联系标题两行 + 欢迎语 + 群表横排，与 README 联系区同源同形，只是渲染介质不同（静态 Markdown vs React 弹层）；由通用件提供，各插件只引入不实现。

_Avoid_: 弹窗、二维码弹窗、扫码弹窗、三群弹窗

**动作行**:
设置面板里触发弹层的 `<button>` 行（与「作者其他插件」那种 `<a target="_blank">` 外链行相对），点击在当前页上层弹出联系弹窗而不跳转。

_Avoid_: 按钮、入口按钮、链接行

**联系按钮**:
设置面板里代表「联系我」的 SVG 图标按钮（`<ContactButton/>`，aria-label「联系我们」），点击在当前页上层打开联系弹窗，不跳转。

_Avoid_: 图标按钮、二维码按钮、联系我们按钮

**base 包**:
`dsh-featherhunter-plugin-base`，本仓 `packages/base` 下开发并发布到 npm 的通用件包，三入口 `./core`（数据与纯函数）、`./client`（浏览器 UI）、`./node`（README 生成与校验）；不是 DSH 插件，不要装进 DSH。

_Avoid_: 基础包、公共包、工具包、组件库

**远程清单**:
`contact/manifest.json`，经 CDN 与 raw 通道暴露；联系弹窗打开时拉取，决定微信码文件与有效期，过期或取不到一律降级为链接，绝不展示过期码。

_Avoid_: 配置、远端配置、二维码配置

**群组条目**:
联系弹窗与 README 联系区里的一张群卡的数据形态：`id`、`platform`、`title`、`subtitle`、`qr`（bundled / remote / url）、`note`、`validUntil`、`order`。渲染器只认条目数组，不认具体平台，所以加群是加数据而不是改代码。

_Avoid_: 群配置、二维码项、卡片数据

**内置基线**:
随 base 包发布的默认群组集合（当前飞书 / QQ / 微信三个）；远程清单只能按 `id` 覆盖或追加，永远删不掉基线里的群。

_Avoid_: 默认配置、内置列表、fallback 群