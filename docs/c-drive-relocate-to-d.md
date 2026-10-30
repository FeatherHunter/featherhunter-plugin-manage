# C盘瘦身：哪些目录可以 Link（Junction）到 D 盘

> 采集时间：2026-10-25 12:0x（Asia/Shanghai）
> 方法：本机实测（`Get-ChildItem -Recurse -Force` 逐文件求和；已区分 junction 与真实目录）
> 盘现状：C 200GB/剩 **54.0GB**（刚清掉 51.7GB npm 缓存后）；D 1693GB/剩 **564.6GB**；E 931GB/剩 309GB

## 0. 先纠正一个认知：你的"桌面/文档"大部分已经在 D 盘了

`cmd /c dir /AL C:\Users\辰辰洋洋` 实测，以下已是 **Junction → D 盘**：

| 路径 | 状态 | 真实位置 |
|---|---|---|
| `C:\Users\辰辰洋洋\Documents` | ✅ 已是链接 | `D:\Users\辰辰洋洋\Documents`（7.29GB） |
| `C:\Users\辰辰洋洋\Pictures` | ✅ 已是链接 | `D:\Users\辰辰洋洋\Pictures`（0.43GB） |
| `C:\Users\辰辰洋洋\Music` | ✅ 已是链接 | `D:\Users\辰辰洋洋\Music` |
| `Videos`（注册表） | ✅ 已指向 | `D:\Videos` |
| `Downloads` | ✅ 已在 D | `D:\Users\辰辰洋洋\Downloads`（18.06GB） |
| `C:\Users\辰辰洋洋\Desktop` | ❌ 仍在 C | 0.12GB（太小，迁了也省不出空间） |
| `C:\Users\辰辰洋洋\Favorites` | ❌ 仍在 C | ~0GB |

**所以再重复迁移"桌面/文档"没有收益**。真正占 C 盘的是下面这些缓存和运行时目录。

## 1. C盘真实构成（不跟随 junction）

| 目录 | 真实占用 | 可否迁 D |
|---|---|---|
| `C:\Windows` | 38.02GB | ❌ 系统核心，只可 DISM 瘦身 |
| `C:\Users\辰辰洋洋` | **42.07GB** | ⚠️ 其中 ~26GB 可迁 |
| `C:\Program Files (x86)` | 9.54GB | ⚠️ 不建议 junction（更新会坏） |
| `C:\Program Files` | 2.99GB | 同上 |
| `C:\ProgramData` | 1.23GB | 部分可 |
| `C:\actions-runner` | 0.95GB | ✅ 可直接删/迁 |
| `C:\$SysReset` | 0.68GB | ✅ 可删（需管理员） |
| `C:\pagefile.sys` | 18.00GB | ✅ **可迁 D**（系统设置，官方支持） |
| `C:\hiberfil.sys` | 12.72GB | ✅ **可关休眠回收**（不能迁） |

> 已用 146GB 与以上求和有约 19GB 差额：属于无权限读取的系统文件/元数据（`$Extend`、`Recovery`、SVI 等），管理员下 `WizTree`/`Dism` 可复核，不影响下述方案。

## 2. 推荐迁移清单（按收益排序，全部实测体积）

> Junction = `mklink /J`，**普通用户权限即可创建**（本机已实测成功）；程序完全无感，路径不变。被移目录内文件被占用时移动会失败——失败即停，不会损坏。

### 2.1 普通权限即可做（关掉对应程序后执行）

| # | 源目录 | 现占 | 方法 | 前置条件 |
|---|---|---|---|---|
| 1 | `~\.local\share\billion-context` | **8.56GB** | Junction | 先停 DSH 的 billion-context 服务（node 进程持有 index.db） |
| 2 | `~\.dsh` | **3.87GB** | Junction | 先完全退出 DSH 桌面端 |
| 3 | `~\AppData\Roaming\LarkShell` | **3.55GB** | Junction | 退出飞书/Lark；注意 `aha\*` 里有 lark-cli 运行时 |
| 4 | `~\AppData\Roaming\Tencent` | **2.22GB** | Junction | 退出 QQ/微信 |
| 5 | `~\AppData\Roaming\npm` | **1.98GB** | Junction | 关掉所有终端；全局包@anthropic-ai 718MB、openclaw 397MB、@music163 367MB |
| 6 | `~\AppData\Local\pnpm` | **1.60GB** | Junction | 其中 `store\v11` 1.64GB（当前 `pnpm store path` 指向 `D:\.pnpm-store\v11`，此份是历史遗留，可先确认再迁） |
| 7 | `~\AppData\Local\GitHubDesktop` | **1.54GB** | Junction | 退出 GitHub Desktop |
| 8 | `~\AppData\Local\Microsoft` | **1.51GB** | ⚠️ 只迁子项 | 整体别动（含 Edge/OneDrive 运行时）；可迁 `OneDrive`750MB、`Edge`598MB 缓存子目录 |
| 9 | `~\AppData\Roaming\Code` | **1.35GB** | Junction 或 `--user-data-dir` | 退出 VSCode |
| 10 | `~\AppData\Roaming\Kingsoft` | **1.19GB** | Junction | 退出 WPS |
| 11 | `~\AppData\Roaming\IQIYI Video` | **1.05GB** | Junction | 退出爱奇艺 |
| 12 | `~\AppData\Roaming\duowan` | 0.93GB | Junction | 退出多玩 |
| 13 | `~\AppData\Local\pnpm-cache` | 0.77GB | Junction 或删 | pnpm 元数据缓存 |
| 14 | `~\AppData\Roaming\QQEX` | 0.70GB | Junction | 退出 QQ |
| 15 | `~\AppData\Roaming\com.core.GoingMerry` | 0.68GB | Junction | 退出对应应用 |
| 16 | `~\AppData\Local\Google` | 0.67GB | Junction | 退出 Chrome |
| 17 | `~\AppData\Roaming\MiniMax` | 0.64GB | Junction | 退出 MiniMax |
| 18 | `~\AppData\Roaming\ynote-desktop` | 0.58GB | Junction | 退出有道云笔记 |
| 19 | `~\AppData\Local\@deepseek-aidsh-desktop-updater` | 0.54GB | Junction | 更新包缓存，可直接删 |
| 20 | `~\AppData\Local\ms-playwright` | 0.53GB | Junction 或环境变量 | 已装浏览器；`PLAYWRIGHT_BROWSERS_PATH` 指向 D |
| 21 | `~\AppData\Roaming\youku-app`+`youku` | 0.76GB | Junction | 退出优酷 |
| 22 | `~\AppData\Roaming\com.91merry.vpn`+`Wargaming.net` | 0.90GB | Junction | 退出对应应用 |
| 23 | `~\AppData\Local\uv` | 0.44GB | Junction 或 `UV_CACHE_DIR` | uv 缓存 |
| 24 | `~\AppData\LocalLow\Tencent` | 0.46GB | Junction | 腾讯游戏日志 |
| 25 | `~\AppData\Roaming\QQ`、`ai.opencode.desktop`、`@deepseek-ai` | 0.70GB | Junction | 退出对应应用 |

**小计：≈ 35.9GB 可迁**（脚本 DryRun 实测 27 项合计 35.93GB，不含 pagefile/hiberfil）

### 2.2 建议用"官方配置"而不是 junction（更稳，升级不慌）

| 目标 | 现占 | 官方做法 |
|---|---|---|
| npm 缓存 | 已清至 0.58GB，但一天能被 `npm pack` worktree 重新灌满 52GB | `npm config set cache D:\caches\npm` —— **这是本次复发根因，强烈建议先做** |
| pnpm store | 已在 `D:\.pnpm-store\v11` ✅ | 无需动 |
| uv 缓存 | 0.44GB | `setx UV_CACHE_DIR D:\caches\uv` |
| Playwright 浏览器 | 0.53GB | `setx PLAYWRIGHT_BROWSERS_PATH D:\caches\ms-playwright` |
| VSCode 用户数据/扩展 | 1.35GB | 快捷方式加 `--user-data-dir D:\apps\vscode-data --extensions-dir D:\apps\vscode-ext` |
| 微信文件 | 在 D 的 Documents 下 ✅ | 微信设置→文件管理→改到 D |
| 飞书/QQ/IQIYI 等缓存 | 见上表 | 各 App 设置里改缓存目录，改不了的再 junction |

### 2.3 需要管理员（不能 junction，但收益最大）

| 项 | 收益 | 做法 |
|---|---|---|
| `pagefile.sys` | **18.00GB** | 系统属性→高级→性能设置→高级→虚拟内存→更改：取消"自动管理"，C 设无分页文件，D 设系统管理大小。或管理员 PowerShell：`Set-CimInstance -ClassName Win32_PageFileSetting -Args @{Name='D:\\pagefile.sys';InitialSize=0;MaximumSize=0}`（建议重启生效） |
| `hiberfil.sys` | **12.72GB** | 不用休眠/快速启动就 `powercfg /h off`（管理员）。注意：关闭后"快速启动"也没了 |
| `C:\Windows\WinSxS` | 18.77GB（清出约 2~5GB） | `Dism /Online /Cleanup-Image /AnalyzeComponentStore` 后 `/StartComponentCleanup` |
| `C:\$SysReset` | 0.68GB | 管理员删整目录 |
| `C:\Windows\SoftwareDistribution\Download` | 0.43GB | 停 wuauserv 后清空 |
| 事件日志 | 0.43GB | `wevtutil el \| % { wevtutil cl "$_" }` |
| `C:\actions-runner\_work` 旧 job | 0.95GB | 删 `_work\_diag` 等旧数据 |

## 3. 立即可用的迁移脚本

已生成：`docs/relocate-to-d.ps1`（本报告同目录）

```powershell
# 预览（不动任何文件）
pwsh -ExecutionPolicy Bypass -File .\docs\relocate-to-d.ps1 -DryRun

# 真正执行（默认只做本报告 2.1 表里"标记为可迁"的项）
pwsh -ExecutionPolicy Bypass -File .\docs\relocate-to-d.ps1
```

脚本逻辑：`robocopy /E` 复制 → 校验文件数 → 原目录改名 `.bak` → `mklink /J` → 验证可访问 → 删 `.bak`；任何一步失败都保留原目录并回滚，日志写 `docs/relocate-YYYYMMDD.log`。

## 4. 一次性到位后的预期

| 动作 | 释放 C 盘 |
|---|---|
| 2.1 全部迁移（≈35.9GB，实测） | 35.9GB |
| pagefile 迁 D | 18GB |
| 关休眠 | 12.7GB |
| WinSxS + 系统缓存清理 | 3~6GB |
| **合计** | **≈ 70GB** → C 盘剩余约 **120GB** |

## 5. 风险提示

- **junction 对绝大多数程序透明**，但个别程序（如某些安装器/更新器）会"修复"路径导致链接失效，更新异常时把目录移回即可（脚本保留 `.bak` 到验证通过才删）。
- 不要对 `C:\Program Files*`、`C:\Windows`、`C:\Users\...\AppData\Local\Microsoft`（整体）做 junction。
- 迁移前务必退出对应程序，否则 robocopy 会因占用失败（失败即停，安全）。
- 迁移后首次启动应用可能稍慢（重建索引），属正常。
- `D:\Users\辰辰洋洋\AppData\Local` 是历史空目录，可删。

---

## 6. 2026-10-25 12:2x 执行记录（本轮实做）

### 6.1 已根治"反复灌爆"（配置级，非临时清理）

| 动作 | 命令 | 效果 |
|---|---|---|
| npm 缓存迁 D | `npm config set cache D:\caches\npm` | 以后 `npm pack`/`npm i` 的 550MB tarball 不再落 C 盘（原来一天能灌 50GB+） |
| pnpm 缓存迁 D | `pnpm config set cache-dir D:\caches\pnpm` | 原默认 `%LOCALAPPDATA%\pnpm-cache`（790MB）闲置 |
| claude CLI 重装到 D 前缀 | `npm i -g @anthropic-ai/claude-code`（prefix=`D:\2Study\nodejs`） | 同时把 476MB 从 C 盘挪到 D，`claude` 仍可用 |

### 6.2 本轮已删（普通权限，共释放约 5.2GB，C 盘剩 55.97→60.8GB）

| 项 | 释放 | 说明 |
|---|---|---|
| `AppData\Local\pnpm\store` | 1637.6 MB | 旧 store，实际 store 在 `D:\.pnpm-store\v11` |
| `AppData\Local\npm-cache` | 1100.8 MB | 缓存位置已改 D，旧目录作废 |
| `AppData\Local\pnpm-cache` | 790.3 MB | 同上 |
| `Chrome\User Data\Default\{Cache,Code Cache,GPUCache}` | 292.9 MB | 可重建 |
| `ms-playwright\chromium_headless_shell-1208` | 257.7 MB | 旧版浏览器（保留 1248） |
| npm 遗留临时安装目录 `.claude-code-tW4skPVb` | 241.9 MB | npm 中断残留 |
| `Tencent\WeType\setup\WeTypeSetup_official_p.exe` | 200.6 MB | 安装完的安装包 |
| skillsdeck `2026-10-23/24.log` | 285.0 MB | 旧日志（保留当天） |
| `OneDrive\Update\OneDriveSetup.exe` | 128.0 MB | 更新器缓存 |
| `Edge\User Data\Default\{Cache,Code Cache}` | 78.9 MB | 可重建 |
| `AppData\Local\NVIDIA\{DXCache,GLCache}` | 28.1 MB | 2.7MB 被占用残留 |
| `C:\actions-runner\externals.2.337.0` | 163.0 MB | runner 旧版本备份（bin 是 junction→2.338） |
| 其余（Temp/_logs/output/D3DSCache/缩略图等） | ~30 MB | — |

### 6.3 只剩管理员能清的（脚本已备好）

👉 **双击 `docs/run-admin-cleanup.cmd`**（或右键 `admin-cleanup.ps1` → 用 PowerShell 运行），会弹 UAC，点「是」：

| 项 | 可释放 | 说明 |
|---|---|---|
| `C:\pagefile.sys` | **18.0 GB** | 迁到 `D:\pagefile.sys` 12–16GB，**重启后**释放 |
| `C:\hiberfil.sys` | **12.7 GB** | `powercfg /h off`；代价：不能休眠、丢失快速启动 |
| WinSxS 组件清理 | 1~2 GB | `DISM /StartComponentCleanup`（不 ResetBase，保留更新回滚） |
| `C:\$SysReset` | 0.7 GB | 系统重置日志 |
| `SoftwareDistribution\Download` | 0.43 GB | Windows 更新缓存 |
| `winevt\Logs` 事件日志 | 0.43 GB | 清空（注意：清完排障历史就没了） |
| `C:\Windows\Logs` | 0.26 GB | CBS 日志 |
| `C:\ProgramData\USOShared` | 0.08 GB | 更新协调日志 |

预计再回收 **≈33GB** → C 盘空闲 **≈94GB**（若接着做 2.1 的 35.93GB junction 迁移，可到 ≈120GB）。

### 6.4 pagefile 改 D 的三种做法

1. **最省事**：双击 `docs/run-admin-cleanup.cmd`，脚本第 1 步就做这件事，然后重启。
2. **只要改 pagefile**：提权运行 `docs/pagefile-to-d.ps1`（默认 12288/16384 MB，`-Restore` 可恢复自动管理）。
3. **纯手点**：`Win+R` → `sysdm.cpl` → 高级 → 性能「设置」→ 高级 → 虚拟内存「更改」→ 取消「自动管理」→ 选中 C: 选「无分页文件」→ 选中 D: 选「自定义大小」填 12288 / 16384 → 设置 → 确定 → **重启**。

> 验证：重启后 `Get-CimInstance Win32_PageFileSetting` 应只剩 `D:\pagefile.sys`；`C:\pagefile.sys` 消失。
> 为什么可以删 C 的：当前峰值用量仅 3.7GB / 分配 18GB，31.8GB 内存下 D 盘 16GB 足够；若之后报"内存不足"，把 D 的初始值调到 16384 即可。
> 为什么 18GB：`AutomaticManagedPagefile=True` 时系统按内存自动给，31.8GB 内存 → 18GB。手动后就不会再涨。

### 6.5 不建议删的（看着像垃圾但不是）

| 项 | 大小 | 原因 |
|---|---|---|
| `@deepseek-aidsh-desktop-updater\pending\...0.2.1-rc.3.exe` | 276 MB | 是**待安装的更新包**（当前装的是 rc.2，10-17）；删了下次要重下 276MB |
| `@deepseek-aidsh-desktop-updater\installer.exe` | 276 MB | 当前版本的安装器，卸载/修复要用 |
| `ProgramData\Package Cache` | 89 MB | VS/运行库修复、卸载要用 |
| `C:\Windows\Installer` | 475 MB | 已装软件的卸载信息，删了没法正常卸载 |
| `C:\actions-runner` | 782 MB | GitHub Actions 自托管 runner 服务正在 Running |
| `C:\Users\辰辰洋洋\AppData\Local\Microsoft\OneDrive` | 621 MB | OneDrive 程序本体 |

