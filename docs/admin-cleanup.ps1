<#
.SYNOPSIS
  C 盘管理员级清理 + pagefile 迁到 D 盘。
  双击 run-admin-cleanup.cmd 运行（会自动弹 UAC 提权）。

.DESCRIPTION
  普通权限清不掉的大头都在这里：
    1. pagefile.sys 18GB -> D:\pagefile.sys（改完需重启才释放 C 盘空间）
    2. hiberfil.sys 12.7GB -> powercfg /h off
    3. C:\$SysReset 0.7GB
    4. C:\Windows\SoftwareDistribution\Download 0.43GB（Windows 更新缓存）
    5. C:\Windows\System32\winevt\Logs 0.43GB（事件日志）
    6. C:\Windows\Logs 0.26GB（CBS 等日志）
    7. C:\Windows\Temp
    8. C:\ProgramData\USOShared 0.08GB
    9. WinSxS 组件清理（DISM StartComponentCleanup，可含 1~2GB）
   10. 所有用户回收站
   11. 打印 pagefile / WinSxS 当前状态

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\admin-cleanup.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File .\admin-cleanup.ps1 -SkipHibernateOff
#>
[CmdletBinding()]
param(
  [int]$PagefileInitialMB = 12288,
  [int]$PagefileMaximumMB = 16384,
  [switch]$SkipPagefileMove,
  [switch]$SkipHibernateOff,
  [switch]$SkipWinSxS,
  [switch]$SkipEventLogs,
  [switch]$KeepRecycleBin
)

# ---------- 自提权 ----------
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  $argline = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  foreach ($kv in $PSBoundParameters.GetEnumerator()) {
    if ($kv.Value -is [switch]) { if ($kv.Value.IsPresent) { $argline += " -$($kv.Key)" } }
    else { $argline += " -$($kv.Key) $($kv.Value)" }
  }
  Write-Host "需要管理员权限，正在弹 UAC ..." -ForegroundColor Yellow
  Start-Process -FilePath "powershell.exe" -ArgumentList $argline -Verb RunAs
  exit
}

$ErrorActionPreference = 'SilentlyContinue'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logFile = Join-Path $PSScriptRoot "admin-cleanup-$stamp.log"
function Log([string]$msg, [string]$color = 'Gray') {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $line -ForegroundColor $color
  Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
}
function DirMB([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) { return 0 }
  $s = (Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if ($null -eq $s) { return 0 }
  [math]::Round($s / 1MB, 1)
}
function Purge-Dir([string]$p, [string]$label, [switch]$KeepRoot) {
  if (-not (Test-Path -LiteralPath $p)) { Log "  - $label 不存在，跳过"; return }
  $mb = DirMB $p
  Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue | ForEach-Object {
    if ($KeepRoot -and $_.PSIsContainer) { Get-ChildItem $_.FullName -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
    else { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
  }
  $left = DirMB $p
  Log ("  - {0}: {1} MB -> {2} MB（释放 {3} MB）" -f $label, $mb, $left, [math]::Round($mb - $left, 1))
}

$free0 = (Get-PSDrive C).Free
Log "=== C 盘管理员清理开始 ===" Cyan
Log ("开始前：C 盘可用 {0} GB / 已用 {1} GB" -f [math]::Round($free0/1GB,2), [math]::Round((Get-PSDrive C).Used/1GB,2)) Cyan

# ---------- 1. pagefile 迁 D ----------
if (-not $SkipPagefileMove) {
  Log "--- 1) pagefile.sys 迁到 D 盘 ---" Cyan
  $pfC = Get-Item 'C:\pagefile.sys' -Force -ErrorAction SilentlyContinue
  if ($pfC) { Log ("  C:\pagefile.sys 当前 {0} GB" -f [math]::Round($pfC.Length/1GB,2)) }
  $cs = Get-CimInstance Win32_ComputerSystem
  if ($cs.AutomaticManagedPagefile) {
    Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false }
    Log "  已关闭“自动管理分页文件大小”"
  }
  $existingC = Get-CimInstance Win32_PageFileSetting | Where-Object { $_.Name -like 'C:*' }
  foreach ($pf in $existingC) { Remove-CimInstance -InputObject $pf; Log "  已移除 C: 分页文件设置 ($($pf.Name))" }
  $existingD = Get-CimInstance Win32_PageFileSetting | Where-Object { $_.Name -like 'D:*' }
  if ($existingD) {
    Log "  D: 分页文件已存在：$($existingD.Name)  $($existingD.InitialSize)/$($existingD.MaximumSize) MB"
  } else {
    New-CimInstance -ClassName Win32_PageFileSetting -Property @{
      Name        = 'D:\pagefile.sys'
      InitialSize = $PagefileInitialMB
      MaximumSize = $PagefileMaximumMB
    } | Out-Null
    Log "  已新建 D:\pagefile.sys  初始 $PagefileInitialMB MB / 最大 $PagefileMaximumMB MB"
  }
  Log "  分页文件设置现状：" Warn
  Get-CimInstance Win32_PageFileSetting | ForEach-Object { Log ("    {0}  Initial={1}MB  Max={2}MB" -f $_.Name, $_.InitialSize, $_.MaximumSize) }
} else { Log "--- 1) 跳过 pagefile 迁移 ---" }

# ---------- 2. 休眠文件 ----------
if (-not $SkipHibernateOff) {
  Log "--- 2) 关闭休眠，删除 hiberfil.sys ---" Cyan
  $h = Get-Item 'C:\hiberfil.sys' -Force -ErrorAction SilentlyContinue
  if ($h) { Log ("  hiberfil.sys 当前 {0} GB" -f [math]::Round($h.Length/1GB,2)) }
  & powercfg.exe /hibernate off 2>&1 | Out-Null
  $h2 = Get-Item 'C:\hiberfil.sys' -Force -ErrorAction SilentlyContinue
  if ($h2) { Log "  powercfg /h off 未生效（可能被组策略/快速启动占用），重启后再试" Warn }
  else { Log "  hiberfil.sys 已删除" Green }
} else { Log "--- 2) 跳过休眠文件 ---" }

# ---------- 3. $SysReset ----------
Log "--- 3) C:\`$SysReset（系统重置日志）---" Cyan
Purge-Dir 'C:\$SysReset' 'C:\$SysReset'

# ---------- 4. Windows 更新下载缓存 ----------
Log "--- 4) Windows 更新下载缓存 ---" Cyan
Stop-Service wuauserv, bits, dosvc -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Purge-Dir 'C:\Windows\SoftwareDistribution\Download' 'SoftwareDistribution\Download'
Purge-Dir 'C:\ProgramData\Microsoft\Windows\DeliveryOptimization' 'DeliveryOptimization'
Start-Service bits, wuauserv -ErrorAction SilentlyContinue
Log "  已恢复 Windows Update / BITS 服务"

# ---------- 5. 事件日志 ----------
if (-not $SkipEventLogs) {
  Log "--- 5) 清空事件日志（winevt\Logs）---" Cyan
  $evtMB = DirMB 'C:\Windows\System32\winevt\Logs'
  $ok = 0; $fail = 0
  & wevtutil.exe el 2>$null | ForEach-Object {
    $name = $_.Trim()
    if (-not $name) { return }
    & wevtutil.exe cl "$name" 2>$null
    if ($LASTEXITCODE -eq 0) { $ok++ } else { $fail++ }
  }
  $evtLeft = DirMB 'C:\Windows\System32\winevt\Logs'
  Log ("  事件日志 {0} MB -> {1} MB（成功清 {2} 个，失败 {3} 个）" -f $evtMB, $evtLeft, $ok, $fail)
} else { Log "--- 5) 跳过事件日志 ---" }

# ---------- 6. Windows\Logs / Windows\Temp ----------
Log "--- 6) Windows\Logs、Windows\Temp ---" Cyan
$cut = (Get-Date).AddDays(-7)
$logsMB = DirMB 'C:\Windows\Logs'
Get-ChildItem 'C:\Windows\Logs' -Recurse -Force -File -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt $cut } |
  Remove-Item -Force -ErrorAction SilentlyContinue
Log ("  C:\Windows\Logs: {0} MB -> {1} MB" -f $logsMB, (DirMB 'C:\Windows\Logs'))
Purge-Dir 'C:\Windows\Temp' 'C:\Windows\Temp'

# ---------- 7. USOShared ----------
Log "--- 7) C:\ProgramData\USOShared ---" Cyan
Purge-Dir 'C:\ProgramData\USOShared' 'USOShared'

# ---------- 8. 所有用户回收站 ----------
if (-not $KeepRecycleBin) {
  Log "--- 8) 清空所有用户回收站 ---" Cyan
  Get-ChildItem 'C:\$Recycle.Bin' -Force -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
  Log "  回收站已清空"
}

# ---------- 9. WinSxS 组件清理 ----------
if (-not $SkipWinSxS) {
  Log "--- 9) WinSxS 组件清理（DISM，耗时几分钟）---" Cyan
  $winsxs0 = DirMB 'C:\Windows\WinSxS'
  Log ("  WinSxS 当前 {0} MB（注意：资源管理器里显示的值含硬链接，DISM 报告的才是真实可回收量）" -f $winsxs0)
  & Dism.exe /Online /Cleanup-Image /AnalyzeComponentStore 2>&1 | Tee-Object -Variable dismOut | Out-Null
  ($dismOut | Select-String -Pattern '实际大小|Actual Size|可回收|Reclaimable|建议|Recommend' -SimpleMatch:$false) | ForEach-Object { Log ("  " + $_.Line.Trim()) }
  & Dism.exe /Online /Cleanup-Image /StartComponentCleanup 2>&1 | Tee-Object -Variable dism2 | Out-Null
  ($dism2 | Select-String -Pattern '完成|completed|错误|error' ) | Select-Object -First 5 | ForEach-Object { Log ("  " + $_.Line.Trim()) }
  Log ("  WinSxS {0} MB -> {1} MB（目录数字可能因硬链接变化不大，以可用空间为准）" -f $winsxs0, (DirMB 'C:\Windows\WinSxS'))
} else { Log "--- 9) 跳过 WinSxS ---" }

# ---------- 汇总 ----------
$free1 = (Get-PSDrive C).Free
Log "=== 完成 ===" Cyan
Log ("本次释放：{0} MB（{1} GB）" -f [math]::Round(($free1-$free0)/1MB,0), [math]::Round(($free1-$free0)/1GB,2)) Green
Log ("C 盘现在：可用 {0} GB / 已用 {1} GB" -f [math]::Round($free1/1GB,2), [math]::Round((Get-PSDrive C).Used/1GB,2)) Green
Log "⚠️ pagefile.sys 与 hiberfil.sys 的释放需要【重启】后才生效。" Yellow
Log "日志已保存：$logFile"
if (-not $SkipPagefileMove) {
  Log "重启后可用这条命令确认 pagefile 已到 D 盘：Get-CimInstance Win32_PageFileSetting | ft Name,InitialSize,MaximumSize" 
}
