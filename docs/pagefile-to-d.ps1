#Requires -Version 5.1
<#
.SYNOPSIS
  把 Windows 虚拟内存(pagefile.sys) 从 C 盘改到 D 盘，并设固定大小。

.DESCRIPTION
  本机现状（2026-10-25 实测）：
    - 内存 31.8GB，自动管理分页文件
    - C:\pagefile.sys 已分配 18432MB(18GB)，当前占用 378MB，历史峰值 3698MB
    - D 盘剩余 564GB
  做法：
    1) 关闭"自动管理分页文件"
    2) 删除 C 盘分页文件设置
    3) 在 D 盘创建固定大小 12288MB(初始) / 16384MB(最大) 的分页文件
    4) 需要重启后 C 盘才会释放 18GB

  用法（普通窗口即可，脚本会自己请求管理员）：
    powershell -ExecutionPolicy Bypass -File .\docs\pagefile-to-d.ps1
    powershell -ExecutionPolicy Bypass -File .\docs\pagefile-to-d.ps1 -InitialMB 8192 -MaximumMB 8192

  想改回自动管理：
    powershell -ExecutionPolicy Bypass -File .\docs\pagefile-to-d.ps1 -Restore
#>
param(
  [int]$InitialMB = 12288,
  [int]$MaximumMB = 16384,
  [switch]$Restore
)

$ErrorActionPreference = 'Stop'

# ── 自动提权 ────────────────────────────────────────────────────────────────
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '需要管理员权限，正在请求提权...' -ForegroundColor Yellow
  $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($Restore) { $argsList += '-Restore' }
  else { $argsList += @('-InitialMB', $InitialMB, '-MaximumMB', $MaximumMB) }
  Start-Process -FilePath 'powershell.exe' -ArgumentList $argsList -Verb RunAs
  exit
}

function Show-State([string]$title) {
  Write-Host "`n=== $title ===" -ForegroundColor Cyan
  Get-CimInstance Win32_ComputerSystem |
    Select-Object @{N = 'RAM(GB)'; E = { [math]::Round($_.TotalPhysicalMemory / 1GB, 1) } }, AutomaticManagedPagefile |
    Format-List
  Get-CimInstance Win32_PageFileSetting | Select-Object Name, InitialSize, MaximumSize | Format-Table -AutoSize
  Get-CimInstance Win32_PageFileUsage   | Select-Object Name, AllocatedBaseSize, CurrentUsage, PeakUsage | Format-Table -AutoSize
}

Show-State '修改前'

if ($Restore) {
  Write-Host '恢复"自动管理分页文件"...' -ForegroundColor Yellow
  $cs = Get-CimInstance Win32_ComputerSystem
  Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $true }
  # 清掉手动设置，让系统重新接管
  $pf = Get-CimInstance Win32_PageFileSetting
  $pf | Remove-CimInstance
  Write-Host '已恢复自动管理。重启后生效。' -ForegroundColor Green
  Show-State '修改后'
  exit
}

# ── 1) 关闭自动管理 ─────────────────────────────────────────────────────────
$cs = Get-CimInstance Win32_ComputerSystem
if ($cs.AutomaticManagedPagefile) {
  Write-Host '1) 关闭"自动管理分页文件"' -ForegroundColor Yellow
  Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false }
} else {
  Write-Host '1) 自动管理已是关闭状态' -ForegroundColor DarkGray
}

# ── 2) 删除 C 盘分页文件 ────────────────────────────────────────────────────
$cPf = Get-CimInstance Win32_PageFileSetting | Where-Object { $_.Name -like 'C:*' }
if ($cPf) {
  Write-Host "2) 删除 $($cPf.Name)" -ForegroundColor Yellow
  Remove-CimInstance -InputObject $cPf
} else {
  Write-Host '2) C 盘已无分页文件设置' -ForegroundColor DarkGray
}

# ── 3) D 盘创建固定大小分页文件 ─────────────────────────────────────────────
$dst = 'D:\pagefile.sys'
$dPf = Get-CimInstance Win32_PageFileSetting | Where-Object { $_.Name -eq $dst }
if ($dPf) {
  Write-Host "3) 更新 $dst → $InitialMB/$MaximumMB MB" -ForegroundColor Yellow
  Set-CimInstance -InputObject $dPf -Property @{ InitialSize = $InitialMB; MaximumSize = $MaximumMB }
} else {
  Write-Host "3) 创建 $dst → $InitialMB/$MaximumMB MB" -ForegroundColor Yellow
  New-CimInstance -ClassName Win32_PageFileSetting -Property @{
    Name        = $dst
    InitialSize = $InitialMB
    MaximumSize = $MaximumMB
  } | Out-Null
}

Show-State '修改后（重启前，C 盘仍占用旧文件）'

Write-Host @"

─────────────── 下一步 ───────────────
请【重启电脑】。重启后：
  • C:\pagefile.sys 释放（约 18GB）
  • 分页文件改到 D:\pagefile.sys
验证：
  Get-CimInstance Win32_PageFileUsage | Format-Table Name,AllocatedBaseSize
  Get-PSDrive C | Select-Object @{N='FreeGB';E={[math]::Round(`$_.Free/1GB,2)}}

说明：
  • 固定 12GB/16GB 足够：本机历史峰值仅 3.7GB（32GB 内存）。
  • C 盘不再有分页文件 = 蓝屏时不会生成完整内存转储（一般无影响）。
  • 想恢复自动管理：再加 -Restore 参数重跑本脚本。
"@ -ForegroundColor Green
