#Requires -Version 5.1
<#
.SYNOPSIS
  把 C 盘上可迁移的用户缓存/运行时目录搬到 D 盘，并在原位置建立 Junction。

.DESCRIPTION
  流程（每个目录）：
    1) robocopy /E 复制到 D 盘目标
    2) 校验源/目标文件数量
    3) 原目录改名为 <name>.bak-<时间戳>
    4) mklink /J 建立 junction
    5) 验证可访问后删除 .bak
  任一步失败：保留原目录、清理半成品、记录日志，继续下一个。

.PARAMETER DryRun
  只打印计划，不移动任何文件。

.PARAMETER Only
  只处理名称匹配的项（逗号分隔，如 -Only billion-context,dsh）。

.PARAMETER KeepBackup
  保留 .bak 目录不删除（确认稳定后再手工删）。

.EXAMPLE
  pwsh -ExecutionPolicy Bypass -File .\docs\relocate-to-d.ps1 -DryRun
.EXAMPLE
  pwsh -ExecutionPolicy Bypass -File .\docs\relocate-to-d.ps1 -Only 'billion-context','dsh'
#>
param(
  [switch]$DryRun,
  [string[]]$Only = @(),
  [switch]$KeepBackup
)

$ErrorActionPreference = 'Stop'
$stamp    = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir   = Join-Path $PSScriptRoot '.'
$logFile  = Join-Path $logDir ("relocate-$stamp.log")
$destRoot = 'D:\Relocated'

# ── 待迁移清单：源目录 → D 盘目标（相对 $destRoot） ───────────────────────────
# 可按需增删；顺序即执行顺序（大的优先）
$Pairs = @(
  @{ Name = 'billion-context'; Src = "$HOME\.local\share\billion-context"; Dst = 'local-share\billion-context' },
  @{ Name = 'dsh';            Src = "$HOME\.dsh";                        Dst = 'dot-dsh' },
  @{ Name = 'LarkShell';      Src = "$HOME\AppData\Roaming\LarkShell";   Dst = 'Roaming\LarkShell' },
  @{ Name = 'Tencent-Roaming';Src = "$HOME\AppData\Roaming\Tencent";     Dst = 'Roaming\Tencent' },
  @{ Name = 'npm-global';     Src = "$HOME\AppData\Roaming\npm";         Dst = 'Roaming\npm' },
  @{ Name = 'pnpm-local';     Src = "$HOME\AppData\Local\pnpm";          Dst = 'Local\pnpm' },
  @{ Name = 'GitHubDesktop';  Src = "$HOME\AppData\Local\GitHubDesktop"; Dst = 'Local\GitHubDesktop' },
  @{ Name = 'Code-Roaming';   Src = "$HOME\AppData\Roaming\Code";        Dst = 'Roaming\Code' },
  @{ Name = 'Kingsoft';       Src = "$HOME\AppData\Roaming\Kingsoft";    Dst = 'Roaming\Kingsoft' },
  @{ Name = 'IQIYI';          Src = "$HOME\AppData\Roaming\IQIYI Video"; Dst = 'Roaming\IQIYI-Video' },
  @{ Name = 'duowan';         Src = "$HOME\AppData\Roaming\duowan";      Dst = 'Roaming\duowan' },
  @{ Name = 'pnpm-cache';     Src = "$HOME\AppData\Local\pnpm-cache";    Dst = 'Local\pnpm-cache' },
  @{ Name = 'QQEX';           Src = "$HOME\AppData\Roaming\QQEX";        Dst = 'Roaming\QQEX' },
  @{ Name = 'GoingMerry';     Src = "$HOME\AppData\Roaming\com.core.GoingMerry"; Dst = 'Roaming\GoingMerry' },
  @{ Name = 'Google-Local';   Src = "$HOME\AppData\Local\Google";        Dst = 'Local\Google' },
  @{ Name = 'MiniMax';        Src = "$HOME\AppData\Roaming\MiniMax";     Dst = 'Roaming\MiniMax' },
  @{ Name = 'ynote';          Src = "$HOME\AppData\Roaming\ynote-desktop"; Dst = 'Roaming\ynote-desktop' },
  @{ Name = 'dsh-updater';    Src = "$HOME\AppData\Local\@deepseek-aidsh-desktop-updater"; Dst = 'Local\dsh-updater' },
  @{ Name = 'ms-playwright';  Src = "$HOME\AppData\Local\ms-playwright"; Dst = 'Local\ms-playwright' },
  @{ Name = 'youku-app';      Src = "$HOME\AppData\Roaming\youku-app";   Dst = 'Roaming\youku-app' },
  @{ Name = 'youku';          Src = "$HOME\AppData\Roaming\youku";       Dst = 'Roaming\youku' },
  @{ Name = 'vpn-91merry';    Src = "$HOME\AppData\Roaming\com.91merry.vpn"; Dst = 'Roaming\com.91merry.vpn' },
  @{ Name = 'Wargaming';      Src = "$HOME\AppData\Roaming\Wargaming.net"; Dst = 'Roaming\Wargaming.net' },
  @{ Name = 'uv-cache';       Src = "$HOME\AppData\Local\uv";            Dst = 'Local\uv' },
  @{ Name = 'Tencent-LocalLow'; Src = "$HOME\AppData\LocalLow\Tencent";  Dst = 'LocalLow\Tencent' },
  @{ Name = 'opencode';       Src = "$HOME\AppData\Roaming\ai.opencode.desktop"; Dst = 'Roaming\ai.opencode.desktop' },
  @{ Name = 'deepseek-ai';    Src = "$HOME\AppData\Roaming\@deepseek-ai"; Dst = 'Roaming\@deepseek-ai' }
)

function Write-Log([string]$msg, [string]$level = 'INFO') {
  $line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $level, $msg
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

function Get-DirStat([string]$path) {
  $files = @(Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue)
  [pscustomobject]@{
    Count = $files.Count
    Bytes = ($files | Measure-Object -Property Length -Sum).Sum
  }
}

function Test-IsReparse([string]$path) {
  $i = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  if (-not $i) { return $false }
  return [bool]($i.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

# ── 前置检查 ────────────────────────────────────────────────────────────────
if (-not (Test-Path 'D:\')) { throw 'D 盘不存在，终止。' }
$dFree = (Get-PSDrive D).Free
Write-Log ("D盘剩余 {0:N1} GB | 模式: {1}" -f ($dFree / 1GB), $(if ($DryRun) { 'DryRun' } else { 'EXECUTE' }))

$selected = $Pairs | Where-Object { $Only.Count -eq 0 -or $Only -contains $_.Name }
if ($selected.Count -eq 0) { throw "没有匹配的迁移项。可用名称：$($Pairs.Name -join ', ')" }

$ok = 0; $skip = 0; $fail = 0

foreach ($p in $selected) {
  $src = [Environment]::ExpandEnvironmentVariables($p.Src)
  $dst = Join-Path $destRoot $p.Dst
  Write-Host ''
  Write-Log ("── {0}: {1} → {2}" -f $p.Name, $src, $dst)

  if (-not (Test-Path -LiteralPath $src)) { Write-Log '源目录不存在，跳过' 'SKIP'; $skip++; continue }
  if (Test-IsReparse $src) { Write-Log '源已是链接/junction，跳过' 'SKIP'; $skip++; continue }
  if (Test-Path -LiteralPath $dst) {
    $existing = @(Get-ChildItem -LiteralPath $dst -Force -ErrorAction SilentlyContinue)
    if ($existing.Count -gt 0) { Write-Log "目标已存在且非空，跳过: $dst" 'SKIP'; $skip++; continue }
  }

  $stat = Get-DirStat $src
  Write-Log ("体积 {0:N2} GB / {1:N0} 个文件" -f ($stat.Bytes / 1GB), $stat.Count)

  if ($stat.Count -eq 0) { Write-Log '空目录，跳过' 'SKIP'; $skip++; continue }
  if ($dFree -lt ($stat.Bytes * 1.2)) { Write-Log 'D 盘空间不足，跳过' 'SKIP'; $skip++; continue }

  if ($DryRun) { Write-Log 'DryRun：未执行（仅报告体积）'; $ok++; continue }

  $bak = "$src.bak-$stamp"
  try {
    # 1) 复制
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
    $rc = (robocopy $src $dst /E /COPY:DAT /R:2 /W:2 /NFL /NDL /NJH /NJS /XJ) 2>&1
    $code = $LASTEXITCODE
    if ($code -ge 8) { throw "robocopy 失败 (exit=$code)：$($rc | Select-Object -Last 3)" }

    # 2) 校验
    $srcStat = Get-DirStat $src
    $dstStat = Get-DirStat $dst
    if ($dstStat.Count -lt $srcStat.Count) {
      throw "文件数不一致 源=$($srcStat.Count) 目标=$($dstStat.Count)"
    }
    Write-Log '复制完成并校验通过'

    # 3) 原目录改名
    Rename-Item -LiteralPath $src -NewName (Split-Path $bak -Leaf) -ErrorAction Stop

    # 4) 建 junction
    $r = cmd /c mklink /J "$src" "$dst" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "mklink 失败：$r" }

    # 5) 验证
    if (-not (Test-Path -LiteralPath $src)) { throw 'junction 建立后不可访问' }
    Write-Log ("Junction OK → {0}" -f $dst)

    # 6) 清理备份
    if ($KeepBackup) { Write-Log "保留备份: $bak" }
    else {
      Remove-Item -LiteralPath $bak -Recurse -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $bak) { Write-Log "备份未能完全删除，请手工删: $bak" 'WARN' }
    }
    $ok++
  }
  catch {
    Write-Log ("失败：{0}" -f $_.Exception.Message) 'ERROR'
    # 回滚：若原目录已改名且 junction 未建成，改回来
    if ((Test-Path -LiteralPath $bak) -and -not (Test-Path -LiteralPath $src)) {
      try { Rename-Item -LiteralPath $bak -NewName (Split-Path $src -Leaf); Write-Log '已回滚原目录' } catch { Write-Log "回滚失败，请手工处理: $bak" 'ERROR' }
    }
    $fail++
  }
}

Write-Host ''
Write-Log ("===== 完成：成功 {0} / 跳过 {1} / 失败 {2} =====" -f $ok, $skip, $fail)
$c = Get-PSDrive C
Write-Log ("C盘剩余 {0:N2} GB | 日志: {1}" -f ($c.Free / 1GB), $logFile)

if ($DryRun) {
  Write-Host ''
  Write-Log '这是 DryRun。确认无误后去掉 -DryRun 执行；执行前请关闭上述目录对应的程序。' 'INFO'
  Write-Host @'
建议执行顺序：
  1) 先退出飞书 / QQ / 微信 / VSCode / WPS / 游戏客户端等
  2) pwsh -ExecutionPolicy Bypass -File .\docs\relocate-to-d.ps1
  3) DSH 自身的 .dsh 与 billion-context 目录建议在 DSH 完全退出后单独跑：
       pwsh -ExecutionPolicy Bypass -File .\docs\relocate-to-d.ps1 -Only dsh,billion-context
'@
}
