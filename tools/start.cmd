@echo off
setlocal
rem  start.cmd — the Windows twin of start.sh: the one action a designer takes.
rem  Sets everything up (installing on first run), starts the local server, opens the dashboard.
rem  From there the dashboard runs onboarding — it asks the questions, triggers login if relevant,
rem  and shows the capture live. No questions are asked in the terminal, ever.
rem
rem  Usage:  double-click this file, or run  tools\start.cmd  from the workspace root.
rem
rem  Why this exists: the landing page's primary CTA ended in `tools/start.sh`, which does not run on
rem  Windows, and its `&&` chain is a PARSE error in PowerShell 5.1 — so nothing ran at all. Both
rem  release sanity runs flagged it (N2 / Windows finding 4).
rem
rem  Why it is short: port selection, "is my own workspace already serving?", and the browser open all
rem  live in map.js (--open). Re-implementing that scan in batch would duplicate the one piece of logic
rem  that must not drift — guessing 4173 would open ANOTHER workspace's dashboard when 4173 is theirs.
rem  Deliberately NO --port flag: with it, map.js treats a busy port as fatal instead of walking the range.

rem Resolve the workspace root (parent of this script's tools\ dir) regardless of where it's called from.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.." || (echo Could not enter the workspace folder. & exit /b 1)
set "KIT_DIR=%CD%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js isn't installed. Get it from https://nodejs.org ^(choose LTS^), then run this again.
  echo.
  popd & pause & exit /b 1
)

rem First-run installs can take minutes — say so BEFORE each slow step, same as start.sh.
if not exist "%SCRIPT_DIR%node_modules" (
  echo.
  echo   First run: installing the capture tools ^(about a minute^)...
  call npm install --prefix "%SCRIPT_DIR%." --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo   That install failed. Check your internet connection and run this again.
    echo.
    popd & pause & exit /b 1
  )
)

rem Is the capture browser actually on disk? executablePath() returns the EXPECTED path whether or not
rem chromium was ever downloaded, so the existsSync check has to happen node-side — same reason
rem start.sh pairs it with a `[ ! -f ]` test. Done inside node to avoid a `for /f` capture, whose
rem quoting rules around the JS are the most fragile thing in a batch file. Run from tools\ so
rem require('playwright') resolves.
set "CHROME_MISSING="
pushd "%SCRIPT_DIR%."
node -e "const fs=require('fs');try{const p=require('playwright').chromium.executablePath();process.exit(fs.existsSync(p)?0:1)}catch(e){process.exit(1)}" >nul 2>nul
if errorlevel 1 set "CHROME_MISSING=1"
popd
if defined CHROME_MISSING goto :install_chromium
goto :serve

:install_chromium
echo.
echo   First run: downloading the capture browser ^(Chromium — this can take a few minutes^)...
pushd "%SCRIPT_DIR%."
call npx playwright install chromium
popd

:serve
echo.
echo   Starting the design-context server — the dashboard will open in your browser.
echo   ^(Close this window, or press Ctrl+C, to stop it.^)
echo.
rem Foreground on purpose: the server logs stay visible and closing the window stops it,
rem which is what a double-clicking designer expects. map.js prints the URL and opens it.
node "%SCRIPT_DIR%map.js" --open

popd
endlocal
