# dsh web profile 真机验证环境调研

只读取证 + 一次性实验，2026-10-29。对象：本机 CLI `D:\DeepseekHarness\resources\runtime\cli\bin\dsh.cmd`、真实 home `C:\Users\辰辰洋洋\.dsh`、五仓工作树。
实验全部落在 `D:\Temp\dsh-verify-env\`（新建目录）：真实 home 只读，desktop GUI 未触碰；起的实例已全部杀掉，`Get-NetTCPConnection -State Listen` 对 53193／53784 已无监听。
方法：`dsh --help`／`dsh plugin --help`／`dsh web --help` 原文 + 在临时 DSH_HOME 里实跑（起服务、装/卸包、并发、截图），每条断言后括注来源。

## 一、结论摘要

1. **`--profile` 只是选 `$DSH_HOME/profiles/<name>` 这份装配。** `dsh --help` 原文「`--profile <name>` … a profile under `$DSH_HOME/profiles`」；profile 首次被用到时自动初始化 4 个文件（实测：空目录 + `--dump-config` 后生成 `profiles/web/{package.json(207B), cordis.yml, cordis.patch.yml, pnpm-workspace.yaml}`，其中 package.json 只有 `dsh.profile.bundles:[@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app]`、dependencies 为空）。每个实例＝一个 home + 一份 profile 目录 + 一个启动目录。
2. **`dsh plugin` 只是把参数转发给 pnpm，在 profile 目录里跑。** `dsh plugin --help` 原文「manage a profile's plugins by forwarding the remaining arguments to pnpm in the profile directory」；`--profile` 那条写的是「initialized on first use」。所以 `add/remove/update` 的语义＝`pnpm add/remove/update` 在这个目录里的语义，pnpm 由 launcher 提供（实跑输出 `Done in 4.7s using pnpm v11.28.5`）。
3. **装到 profile 自己的 `node_modules`（hoisted 真目录，不是 junction）。** 结果：`profiles/web/node_modules/<pkg>`（LinkTarget 为空）、依赖写进 `profiles/web/package.json` 的 dependencies、**并自动把包名加进 `dsh.profile.bundles`**——bundles 不用手改（add 前后 diff：2 项→3 项；`remove` 后自动回退到 2 项）。
4. **一次 tgz 安装 ≈ 5 秒、零下载。** 输出 `resolved 5, reused 5, downloaded 0, added 5`，并带告警「The store at `C:\Users\…\AppData\Local\pnpm\store\v11` is not used … Using the store at `D:\.pnpm-store\v11` instead」（实跑）。装完的 `profiles/web` 约 8.5 MB / 1204 文件。
5. **同一个 tgz 路径、同一版本号的「重装」是 no-op（本调研最重要的一条）。** 同名同版本 tgz 换内容后再 `add`，输出 `resolved 0, reused 1, added 0`（493 ms），包内容**没变**（打的 MARKER 文件不出现）。`add --force` 也**无效**；有效的是 ①`remove` 再 `add` ②删 `node_modules/<pkg>` 再 `add` ③删 `node_modules` + `pnpm-lock.yaml` 再 `add`（三种都实测换成功）。
6. **最小 DSH_HOME ＝ 一个空目录。** 空目录直接起服务即可，宿主自动生成 `.anonymous-user-id`(37B)、`.credentials.yaml`(161B，内含 43 字符 trust secret)、`storages/workspace.json`(227B)；bundle 从 app 自带 node_modules 解析，无需预装（实跑）。`sessions/`（真实 home 已有 2000 MB）与 `storages/` 不必预置。
7. **端口发现靠 stdout 一行，且 token 必须一起抓。** 启动后 stdout 恰好一行 `dsh web: http://127.0.0.1:<port>/?token=<43 字符>`，stderr 为空；不带 token 访问 `/` 与 `/api/health` 都返回 **401**，带 token 的 `/?token=…` 返回 **200**（A/B/C 三实例实测，页面 37907 bytes；装上 deck 后 38170 bytes）。
8. **冷启动 2.0–2.1 秒**（A 2.1s、B 2.1s、C 2.0s、装完 deck 重启 2.0s，均从 `Start-Process` 到 stdout 出现 URL 计时）。
9. **并发可用：没有单实例锁。** 不同 DSH_HOME + 不同启动目录 + 各自 `--port 0`，A=49708、B=53784 同时 HTTP 200；**同一个 home 再起第三个实例也成功**（65280，200，2.0 s，`workspace.json` 未被破坏）（实跑）。共享 home 不是「挡住」，而是「串台」（见风险 4）。
10. **每实例内存 ~270–295 MB。** 进程树＝`cmd.exe` 9 MB + `conhost` 10 MB + 单个 `DeepSeek Harness.exe`（Electron-as-node 跑 cli.js）250–276 MB；实测 A2 合计 295 MB/3 进程、B 269 MB/3 进程，无 renderer 进程（页面在浏览器侧）。
11. **浏览器侧现成可用：deck 仓自带 Playwright 1.64.1（可离线）。** `D:\dsh-plugin\dsh-mattpocock-skills-deck\node_modules\playwright`（1.64.1，pnpm 硬链到 `.pnpm/playwright@1.64.1`）；`chromium.launch({headless:true})` 默认通道即可用（version 156.0.8078.4，无需联网），也可 `executablePath` 指系统 Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`）。每实例 `browser.newContext()` 独立上下文，截图 4.1 s/张；两实例并发截图 6.8 s、零 pageerror（实跑）。
12. **裸 Chrome `--screenshot` 不可用于 SPA。** 带 `--virtual-time-budget=8000` 会一直等定时器，实测 674.7 s / 353.5 s 才出图，不加 budget 又太早——统一用 Playwright。
13. **必须每实例独立的写点（实测）：** `DSH_HOME`（`.credentials.yaml` 的 browser-session grant、`sessions/`、`storages/session_projcache`）、**进程启动目录**（deck 的 `.dsh-mattskillsdeck-cache` 落在启动目录，不是 home，见 2.5）、浏览器上下文（localStorage 按访问地址隔离，换端口即失忆）。
14. **可以共享只读的：** 候选 tgz 源文件、`D:\.pnpm-store\v11`（内容寻址 store，只读复用，实测 `downloaded 0`）、ms-playwright 缓存、系统 Chrome/Edge 安装目录。**共享同一份 `profiles/` 未验证**（装包会写它），建议每实例一份。

## 二、可用命令模板

### 2.1 起一个验证实例（独立 home + 独立启动目录 + 系统挑端口）

```powershell
# 注意：若从 DSH 会话里跑，子进程会继承 DSH_HOME/DSH_PROFILE/DSH_SESSION_ID，必须先清
function Start-DshVerify {
  param([string]$Name, [string]$Root = 'D:\Temp\dsh-verify-env')
  $home = Join-Path $Root "home-$Name"; $work = Join-Path $Root "work-$Name"; $logs = Join-Path $Root "logs-$Name"
  New-Item -ItemType Directory -Force -Path $home,$work,$logs | Out-Null
  $out = Join-Path $logs 'stdout.log'; $err = Join-Path $logs 'stderr.log'
  Remove-Item -LiteralPath $out,$err -ErrorAction SilentlyContinue
  $env:DSH_HOME = $home
  Remove-Item Env:DSH_SESSION_ID,Env:DSH_PROFILE,Env:DSH_PROFILE_DIR,Env:DSH_WEB_URL -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','"D:\DeepseekHarness\resources\runtime\cli\bin\dsh.cmd" web --no-open --port 0' -WorkingDirectory $work -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 250
    $t = Get-Content -LiteralPath $out -Raw -ErrorAction SilentlyContinue
    if ($t -match 'http://127\.0\.0\.1:\d+/\?token=[A-Za-z0-9_\-]+') { break }
    if ($p.HasExited) { throw "实例 $Name 提前退出 code=$($p.ExitCode): $(Get-Content $err -Raw)" }
  }
  [pscustomobject]@{ Name=$Name; Pid=$p.Id; Url=$Matches[0]; Home=$home; Work=$work }
}
$A = Start-DshVerify -Name a1
(Invoke-WebRequest -Uri $A.Url -UseBasicParsing -TimeoutSec 15).StatusCode                                   # 期望 200
(Invoke-WebRequest -Uri ($A.Url -replace '\?token=.*$','') -UseBasicParsing -SkipHttpErrorCheck).StatusCode   # 期望 401
```

- 只想知道会加载什么、不起服务：`& $cli --profile web --dump-config | Select-String '^- id: '`。真实 web profile 上会先打一条 `patch: entry "web-ui-pet" not found` 告警（`@linxin666/dsh-pet` 未装），属预期。
- 端口不要写死：`--port 0` 每次不同（实测 49708／53193／53784／65280），唯一可靠来源是 stdout 那行。

### 2.2 装 / 换 / 卸候选产物

```powershell
$cli = 'D:\DeepseekHarness\resources\runtime\cli\bin\dsh.cmd'
$env:DSH_HOME = 'D:\Temp\dsh-verify-env\home-a1'

# 装（本地 tgz，5 秒内，零下载）
& $cli plugin --profile web add 'D:\Temp\pack-<ver>\dsh-mattpocock-skills-deck-1.9.0-beta.31.tgz'

# 换版本：先摘再装（同 path 同版本重装是 no-op，--force 也无效）
& $cli plugin --profile web remove dsh-mattpocock-skills-deck
& $cli plugin --profile web add  'D:\Temp\pack-<ver>\dsh-mattpocock-skills-deck-1.9.0-beta.31.tgz'

# 等效的更快清法：只删包目录再 add（保留 lockfile 也能换内容）
Remove-Item -Recurse -Force "$env:DSH_HOME\profiles\web\node_modules\dsh-mattpocock-skills-deck"

# 从 npm 装/升（版本可见性必须打官方源；npmmirror 镜像滞后，见 T9 笔记）
& $cli plugin --profile web add dsh-mattpocock-skills-deck@1.9.0-beta.31 --registry=https://registry.npmjs.org
```

- 装完**必须重启实例**才加载：实测旧进程不热加载（重启 2.0 秒，页面 37907→38170 bytes）。
- 宿主 ID 带 Junction 的安装态上覆盖装包会 `ERR_PNPM_EPERM`（rename `…_tmp_` → `…`），解法见 `发布-T9-安装态切换-执行记录.md`。

### 2.3 截图留证（每实例一个独立浏览器上下文）

```javascript
// D:\Temp\dsh-verify-env\shot.cjs —— 必须是 CommonJS；.mjs 里 require 会报
const { chromium } = require("D:/dsh-plugin/dsh-mattpocock-skills-deck/node_modules/playwright");
const url = process.argv[2], out = process.argv[3];
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-first-run", "--disable-gpu"] });
  // 备选：chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });  // 每实例一份
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  for (const label of ["继续", "确定", "知道了"]) {        // 首启欢迎弹窗要点掉才看得到主界面
    const b = page.getByRole("button", { name: label });
    if (await b.count()) { await b.first().click().catch(() => {}); await page.waitForTimeout(800); break; }
  }
  await page.waitForTimeout(2500);
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ text, errors, out }));
  await browser.close();
})().catch((e) => { console.error("FAILED " + e.message); process.exit(1); });
```

```powershell
& node 'D:\Temp\dsh-verify-env\shot.cjs' $A.Url 'D:\Temp\dsh-verify-env\shot\a1.png'
```

页面文本可直接当断言用：装 deck 后 `bodyText` 里出现「MattSkills 可接 0 故障 0 诊断 0 沉淀 交接 环境 -- 更新 10-29 05:34」状态栏（实跑）。

### 2.4 清理

```powershell
taskkill.exe /PID $A.Pid /T /F        # 杀 cmd.exe 那棵，连 Electron 主进程一起走
Get-CimInstance Win32_Process | Where-Object CommandLine -like '*dsh-desktop-host*cli.js*'   # 期望：空
Remove-Item -Recurse -Force 'D:\Temp\dsh-verify-env\home-a1','D:\Temp\dsh-verify-env\work-a1'
```

- `Start-Job` 起的截图任务要 `Remove-Job -Force`；Playwright 正常 `close()` 会自己收 chrome 子进程。
- 遗留检查同时看端口：`Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 49708,53784`。

### 2.5 重置到干净状态（按代价从低到高）

| 级别 | 动作 | 清掉什么 | 实测代价 |
|---|---|---|---|
| L1 换实例 | 新建空 home + 新建启动目录 | 全部（token、workspace、缓存） | ~0，起服务 2 秒 |
| L2 换包 | `plugin remove` 再 `add` | node_modules 里的包 + bundles 项 | 0.6 s + 5 s |
| L3 换包（保 lockfile） | 删 `profiles/web/node_modules/<pkg>` 再 `add` | 包内容，保留其余依赖 | 5 s |
| L4 全清依赖 | 删 `node_modules` + `pnpm-lock.yaml` 再 `add` | 依赖树与 lockfile（bundles 保留） | 5 s + 解析 |
| L5 清宿主缓存 | 删 `<启动目录>\.dsh-mattskillsdeck-cache`、`<home>\mattskillsdeck`、`profiles/web/.dsh-mattskillsdeck-cache`、`profiles/web/.plugin-manager/logs` | deck 日志/计划游标/命名守卫/插件管理器操作记录 | 秒级 |

**会造成「装的是旧包」假阴性的缓存（按实测严重度）：**
1. `profiles/web/pnpm-lock.yaml` + `node_modules/<pkg>`——同 path 同版本 tgz 被判成「已装好」，静默沿用旧内容（结论 5）；
2. `<启动目录>\.dsh-mattskillsdeck-cache`——deck 宿主侧磁盘缓存（日志、`naming-guardian.json`、`deck-plans` 计划游标落在工作区根的同名目录）；跟着**进程启动目录**跑，复用启动目录＝复用上一轮状态；
3. `<home>\mattskillsdeck/choices.json`——用户选的后端记录（按工作区键散列），跨实例共享会串台；
4. `profiles/web/.dsh-market`、`.plugin-manager`、`.dsh-mattskillsdeck-cache`——profile 级状态（真实 web profile 的 `.plugin-manager/logs` 有 70+ 个历史操作目录）；
5. `<home>\storages/session_projcache`——会话投影缓存，启动后自动重建，可删；
6. 浏览器 `localStorage`——按访问地址隔离，换端口/换 home 自然就干净（「每实例新 context」的副作用）。

## 三、证据来源

| 断言 | 来源 |
|---|---|
| `--profile` 语义、`plugin` 转发 pnpm、`--port 0`／`--no-open`／`--host` | `dsh --help`、`dsh plugin --help`、`dsh web --help` 原文（本机 CLI，2026-10-29） |
| profile 首次使用自动生成 4 个文件、空 home 可起服务 | `$env:DSH_HOME=<空目录>; dsh --profile web --dump-config`；`dsh web --no-open --port 0`，实测 |
| 装到 `profiles/web/node_modules`、自动维护 bundles、5 秒零下载 | `dsh plugin --profile web add <tgz>` 输出（`resolved 5, reused 5, downloaded 0`）+ `profiles/web/package.json` 前后 diff |
| 同 path 同版本重装 no-op、`--force` 无效、三种有效清法 | 四组对照实验（MARKER 文件 + `installed_files` 计数 + `tar -tzf` 校验 tgz 内确有该文件） |
| stdout 一行 URL+token；无 token 401 / 有 token 200 | `Invoke-WebRequest` 实测，A/B/C 三实例 |
| 并发互不干扰、无单例锁、同 home 也能起 | 起 3 实例，端口 49708／53784／65280 同时 200 |
| 270–295 MB/实例、3 进程 | `Get-CimInstance Win32_Process` 的 WorkingSetSize 汇总 |
| Playwright 1.64.1 可用、默认通道 vs 系统 Chrome | `node probe-default.cjs` → `{"ok":true,"version":"156.0.8078.4"}`；`shot.cjs` 两次成功出图 |
| 裸 Chrome `--screenshot` 卡死 | 后台任务 `[A-vt] png_bytes=59482 sec=674.7`、`[B-vt] 39243 sec=353.5` |
| deck 缓存落在「进程启动目录」 | `dsh-mattpocock-skills-deck/src/host/choiceStore.ts:10-11` 注释（「不许改用 repoKeys.js 的 getCacheDir() —— 那是 <DSH 进程启动目录>/.dsh-mattskillsdeck-cache」）；实测 work-a／work-b 各自出现同名目录 |
| 计划游标、命名守卫同目录 | `src/deck/shell/plan-cursor.ts:83,93`；`src/host/namingGuardian.ts:63` |
| patch 层叠加顺序 | `docs/research/dsh-source-plugin-capability-surface.md` §2.2（复用，未复跑） |
| Junction 覆盖装包 `ERR_PNPM_EPERM`、镜像滞后 | `docs/research/发布-T9-安装态切换-执行记录.md`（复用，未复跑） |
| 真实 web profile 现状（bundles／file: tgz／patch 覆盖） | `C:\Users\辰辰洋洋\.dsh\profiles\web\package.json:16-22`、`cordis.patch.yml:1-25`、`pnpm-workspace.yaml:1-19` |

**复用的既有笔记（各一句）：**
- `D:\dsh-plugin\dsh-im-companion\docs\research\T1-工作区创建绑定取证.md`——工作区权威源是 `storages/workspace.json`，web profile 装配含 workspace／directory-picker；本次实验里该文件确实在每个新 home 自动生成（227B）。
- `D:\dsh-plugin\dsh-im-companion\docs\research\发布-T9-安装态切换-执行记录.md`——装/换包在宿主运行时的两个真机坑（Junction `ERR_PNPM_EPERM`、镜像滞后需显式官方源），本次未复跑，直接引用。
- `D:\dsh-plugin\dsh-opencode-palette\docs\research\dsh-source-plugin-capability-surface.md`——bundle vs profile、patch 四层叠加、`engines.dsh` 准入闸门、插件无沙箱；本次 `--dump-config` 输出与它描述的分层一致。
- `D:\dsh-plugin\dsh-mattpocock-skills-deck\docs\README.en.md`（36–92 行）——`--profile` 必须与入口匹配（desktop app 用 desktop、自起 web 用 web）、`update`/`remove` 用法、`minimumReleaseAge` 会让新版本数小时不可见。

## 四、风险

1. **同 path 同版本 tgz 重装是静默 no-op**——最容易造成「装了新版其实是旧包」。缓解：候选产物用带版本+序号/时间戳的文件名；或固定走 `remove`→`add`；或直接新建 home。**不要**依赖 `add --force`。
2. **pnpm store 与磁盘布局耦合**——C: 的 store 无法硬链进 D: 的项目，会改用 `D:\.pnpm-store\v11`（本机 2.9 GB）；换盘、清 store、或机器首次安装时会退化为联网下载，耗时与离线可用性都会变。
3. **镜像滞后 / `minimumReleaseAge`**——版本可见性校验必须 `--registry=https://registry.npmjs.org`，否则可能装到旧版或报 404（T9 笔记 + README FAQ，本次未复跑）。
4. **共享 home 会串台**——同 home 起两实例不报错（实测都 200），但 `sessions/`、`storages/`、`.credentials.yaml` 的 browser-session grant 是同一份；会话列表/权限可能互相影响。建议每实例独立 home。
5. **进程启动目录决定 deck 缓存位置**——若所有实例共用同一个启动目录（例如都在管理仓根下起），`.dsh-mattskillsdeck-cache` 会互相覆盖，症状是「状态栏数字/计划游标是上一轮的」。
6. **端口与 token 只能从 stdout 取**——写死端口或省掉 token 会 401；`--no-open` 必带，否则每实例弹一个浏览器窗口。
7. **首启有欢迎弹窗**——截图脚本必须先点「继续」，否则证据图只有弹窗；文案可能随版本变，脚本要容错。
8. **裸 Chrome `--screenshot` 不可用**——`--virtual-time-budget` 在 SPA 上等于挂死（实测 674.7 s／353.5 s），无 budget 又太早。
9. **删除面较大**——L4/L5 会删 `node_modules`、`pnpm-lock.yaml` 与 home 下的缓存；只对临时 home 执行，别对真实 home 跑（真实 `sessions/` 已 2 GB、`profiles/web` 里还有 `package.json.bak-1189` 这类人工备份）。
10. **未验证项**：①从 npm 直接 `add` 的新装路径（本次只发 tgz，registry 路径引用 T9 记录）；②共享只读 `profiles/` 是否安全（装包会写它，未测）；③`--host` 具体 IP、`--public-url` 与 `DSH_WEB_URL` 的联动（help 只说影响四种形态，未实测）；④长时间多实例并发是否有其它全局面（如 `%LOCALAPPDATA%` 下的 Electron 缓存）——本次两实例 2 分钟内无异常。
