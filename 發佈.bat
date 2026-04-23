@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ====================================
echo   Publishing to GitHub Pages...
echo ====================================
echo.

git status --short
echo.

set /p MSG="Update message (Enter for default): "
if "%MSG%"=="" set MSG=update

git add -A
git commit -m "%MSG%"
git push origin main

echo.
echo ====================================
echo   Done! Site will update in ~30 sec
echo   URL: https://haochunhungster.github.io/
echo ====================================
echo.
pause