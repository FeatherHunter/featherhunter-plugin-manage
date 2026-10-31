# 02 README 四块迁移

> 适用对象：deck / palette / im-companion / prompt / ilife 五个仓库的 README。
> 目标：把现在**手写**的四块内容（联系区 / 星标历史 / 致谢表 / 作者其他作品）换成由 `dsh-featherhunter-plugin-base` 的渲染器生成、由标记管理的块。以后换码、加群、改文案只改 base 仓数据，五仓只跑一条 `readme:sync`。
> 本文由 base 仓维护；执行者是各仓仓主。base 仓不包含五仓改动。

## 0. 迁移后长什么样

四块各自被一对标记包住，标记之间由引擎改写，标记之外的字节**永远不动**：

| 块 | 标记 | 渲染内容 |
| --- | --- | --- |
| 联系区 | `<!-- CONTACT-START -->` … `<!-- CONTACT-END -->` | 标题（标准变体 `<h2 align="center"><sub>CONNECT</sub><br>反馈与联系</h2>`；ilife 用 `## 反馈与联系`）+ 居中 div（欢迎语 + 三列表格 + 260 宽整卡）；图片改成 npm CDN 精确版本地址，不再往仓里拷图 |
| 星标历史 | `<!-- STAR-HISTORY-START -->` … `<!-- STAR-HISTORY-END -->` | 深浅双图用 `<picture>`，SVG 地址带分钟级 `?v=YYYYMMDDHHmm`；palette / prompt 两主题共用同一张 SVG，渲染器只输出单张 `<img>`；保留 deck 的 star-history.html 外链、im 的 width 与角注 |
| 致谢表 | `<!-- THANKS-TABLE-ZH-START -->` … `<!-- THANKS-TABLE-ZH-END -->`（en 用 `-EN-`） | 三列表格（贡献者 / 致敬 / 贡献），保留编号、花数与准入规则；标记沿用现有名字 |
| 作者其他作品 | `<!-- MORE-START -->` … `<!-- MORE-END -->` | 标准 HTML 标题 `<h2 align="center"><sub>MORE</sub><br>作者的其他作品</h2>` + 引导句 + 4 行 `**[repo](url)** —— 一句话`；prompt 两个文件保留 `## … <sub>MORE</sub>` Markdown 变体；英文标题沿用各仓现有形态（`More from the author` / `More by the author`）；每仓排除自己；ilife 新增该块（带建设中标识） |

渲染器版本在五仓**钉精确版本**（写进各仓 devDependency）；数据（群码、插件文案）随 CDN `@latest` 走——所以换码不用升级依赖，升级渲染器是独立动作（见《03-CI与发布.md》）。

## 1. 目标文件清单（11 个）

| 仓库（目录名） | README 路径 | 语言 |
| --- | --- | --- |
| dsh-mattpocock-skills-deck | `README.md` | zh |
| dsh-mattpocock-skills-deck | `package/README.md` | zh |
| dsh-mattpocock-skills-deck | `docs/README.en.md` | en |
| dsh-opencode-palette | `README.md` | zh |
| dsh-opencode-palette | `package/README.md` | en |
| dsh-opencode-palette | `docs/README.en.md` | en |
| dsh-im-companion | `README.md` | zh |
| dsh-im-companion | `docs/README.en.md` | en |
| dsh-prompt | `README.md` | zh |
| dsh-prompt | `docs/README.en.md` | en |
| ilife | `README.md` | zh |

语言不用手写配置：引擎从现有块的标题文字自动识别（英文标题 → en）。

**星图资产前置条件**：星图块引用仓内 `docs/star-history-dark.svg` 与 `docs/star-history-light.svg`（palette / prompt 是两主题共用的 `docs/star-history.svg`）。仓库还没有这些资产时（目前是 ilife），`readme:init` 会**跳过**星图块而不是写入坏图，`doctor` 的 `<repo>/star-assets` 会报缺失并指到本文。先按各仓既有星图生成流程补齐资产，再跑 init；已有资产但改名过的仓，改 `packages/base/src/node/targets.ts` 的 `star.darkPath` / `star.lightPath` 即可。

## 2. 迁移步骤（每个仓）

```sh
# 1) 在仓根插入标记与首版内容（幂等：已有标记的块只校验不重写）
npx dsh-featherhunter-plugin-base@1 readme:init --root .

# 2) 逐文件看 diff，确认四块成员 / 顺序 / 链接 / 文案与原手写一致（见第 3 节预期）
git diff -- README.md docs/README.en.md package/README.md

# 3) 门禁：无漂移时退出码 0
npx dsh-featherhunter-plugin-base@1 readme:sync --root . --check

# 4) 提交；以后数据变化只需要跑 sync（CI 里也是这一步）
git add README.md && git commit -m "docs: migrate README blocks to dsh-featherhunter-plugin-base"
```

**多 README 的仓**：`--root <dir>` 只处理该目录下的 `README.md`，不适合一次处理 11 个文件。全量请用

```sh
npx dsh-featherhunter-plugin-base@1 readme:init --all --repos <五仓父目录>
npx dsh-featherhunter-plugin-base@1 readme:sync --all --repos <五仓父目录>
```

它会按第 1 节清单一次处理 11 个文件（含 `package/README.md` 与 `docs/README.en.md`），单文件失败不影响其余文件，最后汇总退出码。单仓调试时才用 `--root`。

## 3. 逐文件 diff 预期（迁移报告口径）

**内容等价**是验收口径（成员集合、链接目标、表头/标题文字、图片宽度、alt 文本、致谢表数据一致），允许模板统一带来的外观微调；所有有意差异都必须能在这张表里对上：

| 文件 | 预期变化 |
| --- | --- |
| deck `README.md` / `package/README.md` | 联系区图片从 `assets/contact-*.png` 换成 CDN 精确版本地址；星图保留 star-history.html 外链，`?v=` 从日期升为分钟级；致谢表数据不变（仅白空格/属性顺序规范化）；作者作品区改为标准标题 + 4 行（palette / prompt / im / ilife，排除自己） |
| deck `docs/README.en.md` | 同上英文版；作者作品区**移除 `dsh-chinese-skill-patch` 行**（不在定稿 5 仓清单里）；`---` 之后的提问 / 版权声明段落**保持原样**，不被 MORE 块吞掉 |
| palette `README.md` | 联系区换 CDN 地址；星图保留**单张主题中性图**（两主题共用 `docs/star-history.svg`，不再输出双 source）；作者作品区标准 4 行（含 deck、prompt、im、ilife） |
| palette `package/README.md` / `docs/README.en.md` | 英文同上；package/README 也是英文 |
| im `README.md` | 联系区换 CDN 地址；星图保留 width=720 与角注；**先手工修掉 `</div>>>>>>>> origin/master` 脏行**，否则 init/sync 报错且一个字节不写；作者作品区标准 4 行 |
| im `docs/README.en.md` | 英文同上 |
| prompt `README.md` / `docs/README.en.md` | 联系区换 CDN 地址；星图保留**单张主题中性图**（两主题共用 `docs/star-history.svg`）；作者作品区保留 `## 作者的其他作品 <sub>MORE</sub>` **Markdown 标题变体**；英文标题沿用现有形态 |
| ilife `README.md` | 联系区保留 `## 反馈与联系` Markdown 变体、换 CDN 地址；**先补 `docs/star-history-{dark,light}.svg` 再新增星标历史块**（缺资产时该块跳过、doctor 报 `star-assets`）；**新增作者作品区**（带 ilife 自己的「⚠️建设中⚠️」标识）；致谢表若为空按规则处理（保留空表结构或按引擎规则省略，以 `--check` 结果为准） |

图片不再拷进五仓：迁移完成后 `assets/contact-*.png` 等旧图可以删（建议单独一个 commit，先删再跑一次 `--check` 确认没被引用）。星图的 SVG 生成脚本与定时任务**不在迁移范围**，不要动。

## 4. `--check` 门禁

```sh
npx dsh-featherhunter-plugin-base@1 readme:sync --check --all --repos <五仓父目录>
```

- 退出码 0 = 11 个文件都无漂移；1 = 有漂移或错误；2 = 用法错误。
- 错误分四类，都带文件路径，可直接贴进 CI 日志：
  - **漂移**：`managed blocks are out of date; run readme:sync to fix`
  - **缺块**：`markers are missing; run readme:init first`
  - **脏行**：`suspicious merge-conflict residue ... refusing to modify the README, fix it manually first`
  - **标记错误**：`unpaired / duplicate / end marker appears before start marker`
- 脏行与标记错误必须**人工修**，引擎不会猜。

## 5. 五仓 README 的日更闭环（限时码新鲜度）

微码周更换版本后，五仓 README 的微信图 URL 要在下一个日更周期内自动改写。做法：在各仓**已有的** thanks / star-history workflow 里加一步 `npx dsh-featherhunter-plugin-base@1 readme:sync`（不新增 workflow 文件），并保留 `--check` 作为门禁。YAML 片段与权限设置见《03-CI与发布.md》。

## 6. 常见失败与回退

- **init 报「cannot locate the legacy … block」** → 该文件的旧块结构与已知形态都不匹配（手工改过？）。把文件恢复到迁移前，或手工在正确位置加一对标记后再跑 sync。
- **init/sync 报脏行** → 先修脏行（im 的 `</div>>>>>>>> origin/master` 是最典型的一处），再重跑；修之前引擎保证不写文件。
- **diff 里出现标记外的改动** → 不应该发生；如果发生，说明标记放错位置（例如 MORE 块把后面的版权段吞了）。用 `git checkout -- <file>` 回退，检查标记位置后重来。
- **整体回退**：`git checkout -- <README 路径>` 即可；引擎只改标记之间，标记外内容与提交前一致。
- **想暂停某个块**：删掉该块标记对并手工保留内容，`--check` 会报缺块（预期），引擎不会再改它；恢复时重新 init。

## 7. 每仓执行清单

- [ ] 确认星图资产齐全：`npx dsh-featherhunter-plugin-base@1 doctor <仓目录>` 的 `star-assets` 为 ok（ilife 先补资产，见第 2 节）。
- [ ] 五仓父目录下跑 `readme:init --all --repos <dir>`，确认 11 个文件都被处理（逐文件摘要行）。
- [ ] 按第 3 节逐文件核对 diff，把与预期不符的差异记录进迁移报告。
- [ ] `readme:sync --check --all --repos <dir>` 退出 0。
- [ ] 第二次 `readme:sync` 零 diff（幂等）。
- [ ] 删除不再引用的旧图片资源（单独 commit）。
- [ ] 在现有 workflow 里加 `readme:sync` 步骤并设置写权限（见 03）。
- [ ] GitHub 上四块实际观感确认（HUMAN-GATE：深色/浅色、图片宽度、表格对齐）。
