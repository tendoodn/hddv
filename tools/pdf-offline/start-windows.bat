@echo off
cd /d "%~dp0"
echo AutoTax PDF Offline: http://127.0.0.1:8080
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  py -3 -m http.server 8080 --bind 127.0.0.1
) else (
  python -m http.server 8080 --bind 127.0.0.1
)
pause
