@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ======================================================
echo   GitHub Pages Initialization
echo ======================================================
echo.
echo Before running, confirm:
echo   1. You have renamed the repo on GitHub to:
echo      haochunhungster.github.io
echo   2. This is this computer's first push to GitHub
echo.
set /p CONFIRM="Ready? (y/n): "
if /i not "%CONFIRM%"=="y" (
    echo Cancelled.
    pause
    exit /b
)

echo.
echo [1/5] Initializing git repository...
git init -b main

echo.
echo [2/5] Connecting to remote repo...
git remote remove origin 2>nul
git remote add origin https://github.com/haochunhungster/haochunhungster.github.io.git

echo.
echo [3/5] Staging all files...
git add -A

echo.
echo [4/5] Creating first commit...
git commit -m "initial commit: personal site skeleton"

echo.
echo [5/5] Pushing to GitHub (browser will open for auth)...
echo Note: this will overwrite the empty README on GitHub.
echo.
git push -u origin main --force

echo.
echo ======================================================
echo   DONE! Next steps:
echo   1. Go to GitHub repo -^> Settings -^> Pages
echo   2. Source: "Deploy from a branch"
echo   3. Branch: "main" / (root)
echo   4. Click Save
echo   5. Wait 1-2 minutes
echo   6. Open https://haochunhungster.github.io/
echo ======================================================
echo.
pause