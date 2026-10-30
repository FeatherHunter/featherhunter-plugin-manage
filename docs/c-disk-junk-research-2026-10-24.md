# C盘空间极速减少：垃圾/临时文件全量排查报告（2026-10-24）

> 采样时间：2026-10-24 14:46~14:50（Asia/Shanghai）
> 测量方式：本机文件系统实测（`Get-ChildItem -Recurse -Force`逐文件求和，primary source = 文件系统本身）
> 结论前置：C盘已到生死线，可安全清理约 **65~75GB**，其中 **npm-cache 53GB** 是“极速减少”的主犯，48小时新增 **28.83GB**。

## 1. 总览：C盘只剩 0.25GB

| 项目 | 数值 | 来源 |
|---|---|---|
| C盘已用 | 199.75GB | `Get-PSDrive C` 实测 |
| C盘剩余 | 0.25GB（约269MB） | 同上 |
| pagefile.sys | 18.00GB | `C:\pagefile.sys` |
| hiberfil.sys | 12.72GB | `C:\hiberfil.sys` |
| swapfile.sys | 0.02GB | `C:\swapfile.sys` |
| C:\Users | 109.78GB | 顶层目录逐文件求和 |
| C:\Windows | 38.01GB | 同上 |
| C:\Program Files (x86) | 8.60GB | 同上 |
| C:\Program Files | 2.99GB | 同上 |

顶层求和约159GB + 页面/休眠文件约30GB ≈ 190GB，与已用199.75GB吻合。`System Volume Information`因权限显示0，需管理员另查（本次未计入，还原点可能另占空间）。

## 2. 元凶定位：48小时谁在吃空间

| 增长点 | 48h增量 | 证据 |
|---|---|---|
| `AppData\Local\npm-cache\_cacache` | **28.83GB / 360个文件** | 按`LastWriteTime > 48h`求和 |
| 超大单文件（>400MB） | 29个，共14.2GB，每个约494MB | `content-v2\sha512\**`，时间戳全是10-23~10-24 |
| `billion-context\sessions\index.db` | 6682MB，常驻大文件但2分钟内无增长（14:47→14:49同为6.526GB） | 两次采样对比，属“存量大”非“极速涨” |
| `.dsh-mattskillsdeck-cache\logs\2026-10-23.log` | 180MB（单日） | 最近文件TOP |

**判断：极速减少 = npm缓存今日持续写入 + 本就只剩几百MB。** npm索引样例指向`https://registry.npmmirror.com/@jest%2ftransform`等，属正常`npm install`缓存，但体量失控。

## 3. 全部垃圾/临时文件清单（按体积排序，附可删等级）

> 等级：✅可直接清（应用自带命令/删文件） / ⚠️按步骤清（需专用工具） / ❌别手动删

### 3.1 第一梯队：>5GB（清一个就回血）

| # | 路径 | 体积 | 内容 | 等级 | 清法 |
|---|---|---|---|---|---|
| 1 | `C:\Users\辰辰洋洋\AppData\Local\npm-cache\_cacache\content-v2` | 52.83GB（总npm-cache 53.42GB） | npm下载缓存，29个>400MB大文件 | ✅ | `npm cache clean --force`；另查`C:\Users\辰辰洋洋\npm-cache`旧目录2.82GB，同命令或手动删 |
| 2 | `C:\Users\辰辰洋洋\.local\share\billion-context\sessions\index.db`（+wal 8MB） | 6.68GB（所属sessions 8.11GB） | Harness会话索引库 | ⚠️ | 别直接删！在应用内做压缩/归档，或备份后`vacuum`；直接删会丢会话检索 |
| 3 | `C:\Users\辰辰洋洋\.dsh\logs\dsh-im-companion\` | 7.24GB / 1504个文件×5MB | IM伴侣日志轮转失控（`2026-10-22.*.log`、`2026-10-23.*.log`） | ✅ | 删7天前日志，保留近3天；修轮转（加保留数/总大小上限） |
| 4 | `C:\Windows\WinSxS` | 18.77GB | 系统组件存储 | ⚠️ | 只能`Dism.exe /Online /Cleanup-Image /AnalyzeComponentStore`后按提示`/StartComponentCleanup`，**禁手动删** |

### 3.2 第二梯队：1~5GB

| 路径 | 体积 | 内容 | 等级 | 清法 |
|---|---|---|---|---|
| `C:\Users\辰辰洋洋\AppData\LocalLow\NVIDIA` | 4.20GB | NVIDIA着色器/DX缓存 | ✅ | NVIDIA App清 shader cache，或删`DXCache/GLCache`内容 |
| `C:\Users\辰辰洋洋\Documents\WeChat Files` | 3.85GB | 微信文件（含聊天图片/视频） | ✅ | 微信→设置→存储空间→清理缓存/管理聊天数据 |
| `C:\Users\辰辰洋洋\AppData\Roaming\LarkShell` | 3.56GB（sdk_storage 1.48GB、aha 1.27GB、sandbox_runtime 605MB、screenshot 52MB） | 飞书壳消息库`messages.db 42MB/contact.db 38MB/search_v2 38MB`+沙箱运行时 | ✅ | 飞书/Lark→清理缓存；`screenshot\20261023*.mp4 52MB`可直接删；`aha/sandbox_runtime`旧env删 |
| `C:\Users\辰辰洋洋\AppData\Roaming\Code` | 2.49GB（WebStorage 941MB异常、CachedExtensionVSIXs 567MB、Crashpad 383MB、CachedData 191MB） | VSCode缓存 | ✅ | 删`Crashpad`、`CachedExtensionVSIXs`旧vsix、`Cache/GPUCache`；`WebStorage 941MB`需在VSCode内清或删后重登插件状态会丢，需备份 |
| `C:\Users\辰辰洋洋\AppData\Roaming\Tencent`（xwechat 39MB wxapkg等）+ `Documents\Tencent Files 0.69GB` | 2.21+0.69GB | QQ/微信缓存 | ✅ | QQ/微信内置清理 |
| `C:\Users\辰辰洋洋\AppData\Roaming\npm\node_modules` | 2.02GB | 全局npm包 | ⚠️ | `npm ls -g --depth=0`审查后`npm uninstall -g <包>`，别整目录删 |
| `C:\Users\辰辰洋洋\AppData\Local\pnpm` | 1.58GB | pnpm全局/store | ✅ | `pnpm store prune` |
| `C:\Users\辰辰洋洋\AppData\Local\GitHubDesktop` | 1.53GB（app-3.6.6 716MB + app-3.6.7 582MB双版本 + packages 270MB） | 旧版本残留 | ✅ | 卸载重装最新版，或手动删`app-3.6.6`旧目录 |
| `C:\Users\辰辰洋洋\AppData\Local\Microsoft`（含OneDrive 128MB×2重复安装包） | 1.50GB | OneDrive/Teams缓存 | ✅ | 删`OneDrive\Update\OneDriveSetup.exe`重复、`26.189.0928.0007`旧版目录（保留当前用版本） |
| `C:\Users\辰辰洋洋\AppData\Roaming\Kingsoft` | 1.19GB | WPS缓存 | ✅ | WPS→清理缓存 |
| `C:\Users\辰辰洋洋\AppData\Roaming\IQIYI Video`（含`QyUpdate\setup 86MB`、`EdgeWebView Cache 47MB`） | 1.03GB | 爱奇艺缓存+安装包 | ✅ | 删`QyUpdate\*.exe`，应用内清缓存 |

### 3.3 第三梯队：0.1~1GB（顺手清）

| 路径 | 体积 | 清法 |
|---|---|---|
| `C:\Users\辰辰洋洋\AppData\Local\pnpm-cache` 0.77GB + `C:\Users\辰辰洋洋\.pnpm-cache` 0.08GB | 0.85GB | `pnpm store prune`后复查 |
| `C:\Users\辰辰洋洋\AppData\Local\ms-playwright` 0.53GB | 0.53GB | `npx playwright uninstall --all`后只装要测的浏览器 |
| `C:\Windows\SoftwareDistribution\Download` 433MB + `C:\Windows\Logs` 245MB + `C:\Windows\System32\winevt\Logs` 428MB | ~1.1GB | 管理员：`net stop wuauserv`后清空Download后`net start wuauserv`；`wevtutil el \| % {wevtutil cl "$_"}`清事件日志（先确认无需审计） |
| `C:\$SysReset` 699MB | 0.68GB | 非重置期可整目录删（需管理员） |
| `C:\actions-runner` 970MB | 0.95GB | 清`_work/_diag`旧job目录 |
| `C:\Users\...\AppData\Local\uv` 0.43GB | 0.43GB | `uv cache prune` |
| `.dsh/profiles/desktop/.dsh-mattskillsdeck-cache/logs`（10-23 180MB + 10-22 62MB + 10-24 59MB） | ~0.3GB | 同IM日志策略删 |
| `C:\Users\...\AppData\Local\Google` 0.39GB、`YLH\...\Cache data_3` 60MB、`QQEX Cache data_3` 36MB、`Tencent\xwechat\applet`等 | ~0.5GB | 浏览器/QQ内置清缓存 |
| `C:\Users\...\AppData\Local\Microsoft\Windows\Explorer`缩略图 47MB、`INetCache` 0.1MB、`Temp` 38MB/1508文件、`C:\temp` 0.3MB | ~0.09GB | `cleanmgr /d C:`勾选临时文件/缩略图；`Temp`可全删跳过占用 |
| `C:\ProgramData\Microsoft\Windows\WER` 6.4MB、`C:\Windows\Panther` 0.1MB | 小 | WER报告可清 |
| 回收站（SID-1003） | 1.8MB | 当前极小，仍建议`rd /s /q C:\$Recycle.Bin`后系统重建（或桌面清空） |

### 3.4 系统级大但不能直接删（给出正规瘦身）

| 路径 | 体积 | 正规做法 |
|---|---|---|
| `hiberfil.sys` 12.72GB | 12.72GB | 不用休眠则管理员`powercfg /hibernate off`立省12GB；要用则保留 |
| `pagefile.sys` 18GB | 18GB | 按内存/崩溃转储需求调小或移到D盘，勿直接删（系统→高级→虚拟内存） |
| `C:\Windows\System32` 11.6GB、`SysWOW64` 1.15GB等 | 系统本体 | `cleanmgr /d C:` + `Dism /Online /Cleanup-Image /StartComponentCleanup` |

## 4. 立即可执行的止血顺序（按收益/风险比）

```powershell
# 1) 先看命：确认剩余
Get-PSDrive C

# 2) 最大一刀：npm缓存（预计回53GB）
npm cache verify
npm cache clean --force
# 旧目录如已迁移可删：
# Remove-Item "C:\Users\辰辰洋洋\npm-cache" -Recurse -Force -ErrorAction SilentlyContinue

# 3) 日志失控：IM伴侣 + skillsdeck（预计回7.5GB）
# 保留近3天，其余删（示例：删10-22及之前）
Get-ChildItem "C:\Users\辰辰洋洋\.dsh\logs\dsh-im-companion" -File |
  Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-3)} |
  Remove-Item -Force
Remove-Item "C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-10-22.log" -Force -ErrorAction SilentlyContinue

# 4) 包管理器缓存（预计回2~3GB）
pnpm store prune
uv cache prune
# playwright如近期不用：
# npx playwright uninstall --all

# 5) 系统更新+事件日志（需管理员，预计回0.8~1GB）
net stop wuauserv
Remove-Item C:\Windows\SoftwareDistribution\Download\* -Recurse -Force
net start wuauserv
wevtutil el | ForEach-Object { wevtutil cl "$_" }

# 6) 磁盘清理器兜底
cleanmgr /d C:
# 管理员再跑：
# Dism.exe /Online /Cleanup-Image /AnalyzeComponentStore
# Dism.exe /Online /Cleanup-Image /StartComponentCleanup
# 不用休眠才跑：powercfg /hibernate off
```

> `.local/share/billion-context/sessions/index.db`不要直接删。先在Harness内归档旧会话，或全量备份该目录后再做`sqlite3 index.db "VACUUM;"`。若持续膨胀，重点查“每2分钟写库”的后台任务。

## 5. 复查与防复发

- 每天跑一次：`Get-PSDrive C` + `Get-ChildItem npm-cache\_cacache -Recurse | Measure`，若`_cacache`日增>2GB，检查是否CI/脚本在死循环`npm install`。
- 给`.dsh/logs/dsh-im-companion`加保留策略：按数量（如保留50个）或总大小（如1GB）滚动，超限自动删最旧。
- `npm config set cache-maxszie`（npm无原生上限，靠定期`clean`或换pnpm content-addressable store）。
- Lark/微信/QQ/VSCode开“退出自动清理缓存”，截图录屏改存D盘。
- 还原点：管理员跑`vssadmin list shadowstorage`确认占比，本次因权限未拿到，若开启建议限5%以内。

## 附：原始测量备忘

- `C:\Users\辰辰洋洋` 109.62GB = AppData 85.98GB（Local 61.62 + Roaming 19.52 + LocalLow 4.84）+ .dsh 11.36GB + .local 8.98GB + Documents 7.28GB + npm-cache旧目录2.82GB。
- AppData\Local中npm-cache 53.42GB一家独大，次名pnpm 1.58GB、GitHubDesktop 1.54GB、Microsoft 1.50GB。
- Windows中WinSxS 18.77GB、System32 11.60GB，其余更新/日志类合计约1GB。
- C根`$SysReset 699MB`、`actions-runner 970MB`属可删运维残留。

*报告文件位置：`docs/c-disk-junk-research-2026-10-24.md`*
