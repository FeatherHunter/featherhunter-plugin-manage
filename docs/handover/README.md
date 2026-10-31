# 给五个插件仓的接入说明（入口）

这目录是给 **deck / palette / im-companion / prompt / ilife 五个仓的仓主** 看的操作手册：每个仓照文档做即可接入 base 包，不需要读实现源码，也不需要改本仓以外的文件。

base 包本身是库、不是插件：不注册任何槽位，不改宿主存储，由各仓在自己的设置面板里调用。

## 先看哪一份

| 你的目标 | 读这份 | 预计 |
| --- | --- | --- |
| 设置面板加「联系我们」入口 + 作者其他插件推荐卡 | [01-接入联系弹窗与推荐卡.md](01-接入联系弹窗与推荐卡.md) | 每仓 1 次改动 |
| README 的联系 / 星图 / 致谢 / 作者作品四块改成统一渲染 | [02-README四块迁移.md](02-README四块迁移.md) | 每仓 11 个 README 文件里属于本仓的那几个 |
| 让 README 每周自动跟上最新群码（挂已有 workflow） | [03-CI与发布.md](03-CI与发布.md) | 只改本仓已有 workflow，不新增文件 |

推荐顺序：01（代码接入）→ 02（README 迁移）→ 03（CI 挂载）。三份互不阻塞，但 02 的星图资产前置条件要先满足。

## 最短路径（以 deck 仓为例）

```sh
# 1) 在五仓父目录，先看 README 四块是否已跟上（退出 0 即通过）
npx -y dsh-featherhunter-plugin-base@1 readme:sync --check --all --repos <五仓父目录>

# 2) 首次迁移：插入标记与首版内容（幂等）
npx -y dsh-featherhunter-plugin-base@1 readme:init --all --repos <五仓父目录>

# 3) 逐文件看 diff，提交；以后数据变化只跑 sync
npx -y dsh-featherhunter-plugin-base@1 readme:sync --all --repos <五仓父目录>

# 4) 一条命令回答「哪个仓没跟上」
npx -y dsh-featherhunter-plugin-base@1 doctor --repos <五仓父目录>
```

代码侧只需在设置面板里调用 `createBaseUI(React, { lang, selfId })` 产出的组件，具体三行示例见 01 §3。

## 谁负责什么

- **base 仓维护者**：数据（`contact/`）、发布（`npm run release`）、CDN、本仓 doctor/readme 工具。周更换码只改数据并发版，不需要五仓发版。
- **五仓仓主**：按 01/02/03 改本仓代码、README 与已有 workflow；确认 HUMAN-GATE 五项；决定本仓的旧实现何时删除。
- 本仓不代替五仓执行任何写操作（规格 P-F 五仓零改动），所有改动都在各仓自己的分支上完成。

## 验收口径

- 每仓自动门禁：`readme:sync --check` 退出 0、`doctor` 全绿、本仓构建与测试通过。
- 人工门禁（HUMAN-GATE，代理不得自判）：真机扫码、真实浏览器 dialog、GitHub 四块观感、本仓真实构建链吃下产物、大陆网络降级。逐条清单见 01 §7.2、03 §6。
- 全仓整体验收记录见 [../base包-最终验收记录.md](../base包-最终验收记录.md)；有意偏离与理由见 [../adr/0001-base-package-implementation-deviations.md](../adr/0001-base-package-implementation-deviations.md)。

## 数据与文案维护边界

群组、二维码图、作者插件清单都只有一份真源（本仓 `contact/`），五仓与十个 README 都由同一份数据渲染。仓主不要在自己仓里手改已由标记块托管的内容——改了会在下次 `readme:sync` 时被覆盖；要改文案或加群，走本仓的数据变更与发布流程（03 §4）。
