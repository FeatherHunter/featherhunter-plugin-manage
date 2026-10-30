@echo off
chcp 65001 >nul
title C盘管理员清理
echo.
echo   ============================================
echo    C 盘管理员清理 + pagefile 迁到 D 盘
echo    会弹 UAC 确认框，请点「是」
echo   ============================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0admin-cleanup.ps1"
echo.
echo   清理结束（pagefile / hiberfil 的释放需要重启）。
pause
