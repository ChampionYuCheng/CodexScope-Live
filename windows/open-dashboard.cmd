@echo off
setlocal

cd /d "%~dp0.."
set "ROOT=%cd%"
set "PORT=4173"
set "LIVE_EXE=%ROOT%\codexscope-live.exe"
if not exist "%LIVE_EXE%" set "LIVE_EXE=%ROOT%\live-server\target\release\codexscope-live.exe"

if exist "%LIVE_EXE%" (
  start "CodexScope Live Server" /b "%LIVE_EXE%" --root "%ROOT%" --port %PORT%
  goto open_browser
)

where cargo >nul 2>nul
if %errorlevel%==0 (
  start "CodexScope Live Server" /b cargo run --manifest-path "%ROOT%\live-server\Cargo.toml" -- --root "%ROOT%" --port %PORT%
  goto open_browser
)

echo CodexScope Live Server was not found, and Rust Cargo is not installed.
echo Build live-server first or install Rust from https://www.rust-lang.org/tools/install.
pause
exit /b 1

:open_browser
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/"
exit /b 0
