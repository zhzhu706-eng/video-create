@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\configure-framepack-pagefile.ps1"
if errorlevel 1 (
  echo.
  echo 配置未完成。请在 Windows 管理员确认窗口中选择“是”，然后重试。
  pause
  exit /b 1
)
echo.
echo 页面文件已配置。请保存工作并重启 Windows，再运行 start-framepack.ps1。
pause
