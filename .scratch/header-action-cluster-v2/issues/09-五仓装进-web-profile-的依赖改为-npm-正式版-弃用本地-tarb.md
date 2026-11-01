<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: hac2-t09 -->
<!-- DSH-CREATED: 2026-11-01T04:33:30.233Z -->
# 09: 五仓装进 web profile 的依赖改为 npm 正式版（弃用本地 tarball）

**What to build:** owner 要求「不要挂本地形式的」——把 web profile 里五个插件的 `file:D:/temp/hac2-pack/b015x/*.tgz` 依赖换成 npm 正式版本，并确认 UI 与本地包一致。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 发布 dsh-mattpocock-skills-deck 1.9.0-beta.33（npm + GitHub Release）
- [x] 发布 dsh-im-companion 0.2.26（npm + GitHub Release）
- [x] web profile 五个依赖改为 npm 精确版本：dsh-prompt@0.4.40 / dsh-opencode-palette@2.1.11 / dsh-life-pack@0.3.86 / dsh-mattpocock-skills-deck@1.9.0-beta.33 / dsh-im-companion@0.2.26
- [x] profile 的 package.json 与 pnpm-lock.yaml 不含任何 file: 依赖
- [x] 重启 web 实例后五个插件设置页仍渲染彩色快捷操作簇（1 容器 + 3 钮），版本文案与 npm 版本一致
- [x] 作者插件卡悬浮气泡、联系弹窗三卡二维码居中仍正常

## 完成记录（2026-11-01 12:40 +08:00）

### 补发两仓（旧 npm 版不含 base 0.1.5 UI）

| 仓 | commit | npm shasum | 发布通道 |
| --- | --- | --- | --- |
| dsh-mattpocock-skills-deck | 80788911（发布管道） | 9c42bbff4f329be7806afa35eee25776beeb643e（672 files / 2,028,781 B） | npm dist-tags beta+latest=1.9.0-beta.33；Release v1.9.0-beta.33（两资产，固定名 sha1 与 npm 一致）；run 41272933352 success |
| dsh-im-companion | e947af7 | f31248ba35fac71b770ec284c0e8958a78bce79c（100 files / 1,174,140 B） | npm latest=0.2.26；Release v0.2.26；run 41272354524 success |

两仓发布管道均为新增 `.github/workflows/publish.yml`（workflow_dispatch、幂等 publish、pack、tag + Release）。deck 前三次 run 红在管道细节（pnpm version 冲突 / git 身份 / gh release upload 相对路径），修复见 commit 34d26637、0e957cf4、80788911。

### web profile 切换（关键命令）

```
dsh plugin --profile web add --save-exact dsh-prompt@0.4.40 dsh-opencode-palette@2.1.11 dsh-life-pack@0.3.86 dsh-mattpocock-skills-deck@1.9.0-beta.33 dsh-im-companion@0.2.26 --registry=https://registry.npmmirror.com/ --reporter=append-only
```

结果：EXIT 0；pnpm 日志逐条 `Replaced "<pkg>" ("file:D:/temp/hac2-pack/b015x/...tgz") with "<version>" from a different source`；`Packages: +6`；10.9s。

profile `package.json` dependencies 现为：dsh-im-companion 0.2.26 / dsh-life-pack 0.3.86 / dsh-mattpocock-skills-deck 1.9.0-beta.33 / dsh-opencode-palette 2.1.11 / dsh-prompt 0.4.40 / dsh-plugin-update 0.18.38 / dshmarket ^1.66.44；bundles 仍 8 个。`package.json` 无 file:；`pnpm-lock.yaml` 无 file:（唯二匹配是 settings 键 `lockfileVersion:` 与 `excludeLinksFromLockfile:` 的子串）。

切换前置：先给 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 minimumReleaseAgeExclude 逐行补 5 条（0.4.40 / 2.1.11 / 0.3.86 / 1.9.0-beta.33 / 0.2.26），否则 pnpm 24h 新版等待期会挡住；安装前备份到 `D:/temp/hac2-pack/web-profile-backup-20261101-1215`（package.json / pnpm-lock.yaml / pnpm-workspace.yaml）。

### 真机复验（重启后 CDP，127.0.0.1:3080）

| 设置页 | 版本文案 | 集群 |
| --- | --- | --- |
| 提示词模板 | 0.4.40 | 1 容器 + 3 钮 |
| MattSkills | 1.9.0-beta.33 | 1 + 3 |
| OpenCode调色板 | v2.1.11 | 1 + 3 |
| 爱生活 | dsh-life-pack 0.3.86 | 1 + 3 |
| IM机器人增强 | v0.2.26 | 1 + 3 |

- 作者插件卡：MattSkills 页 4 行，hover 首行 `.dsh-base-tip` 恰 1 枚、role=tooltip、opacity 1，文本「经常反复重复的模板化提示词，存成自定义模板，选中后直接注入，不再需要耗费精力。」
- 联系弹窗：3 卡 data-group-id=feishu/qq/wechat，三张 `.dsh-base-modal__qr` 均 data:image/png、natural 320×320、computed box-sizing=border-box；dialog open=true。
- 截图：`.tmp/web5-settings.png`、`.tmp/web5-five-pages.png`、`.tmp/web5-mattskills.png`、`.tmp/web5-contact-npm.png`。

### 版本口径

- base 实际新 UI 版本 = 0.1.5；五仓 devDependency 仍精确 0.1.5（未变）。
- 五个插件本次发/用的版本：prompt 0.4.40、deck 1.9.0-beta.33、palette 2.1.11、life-pack 0.3.86、im-companion 0.2.26。
- 本地 tarball 仅作历史备份保留在 `D:/temp/hac2-pack/`，profile 已不再引用。

## Comments

### local — 2026-11-01T04:34:18.596Z
收口：tarball file: 依赖已全部替换为 npm 语义化版本；profile 备份 D:/temp/hac2-pack/web-profile-backup-20261101-1215；详情见正文完成记录。

### local — 2026-11-01T04:34:18.669Z
web profile 依赖已全部切换为 npm 正式版（prompt 0.4.40 / deck 1.9.0-beta.33 / palette 2.1.11 / life-pack 0.3.86 / im-companion 0.2.26），package.json 与 lock 无 file: 依赖；重启后五插件设置页版本与 UI 复验通过（CDP 证据见票面）。deck beta.33 与 im 0.2.26 已同时发布 npm + GitHub Release。

## 进度

- 2026-11-01 12:40 · 100% · npm 正式版接管 web profile，五页 + tooltip + 弹窗真机复验通过
