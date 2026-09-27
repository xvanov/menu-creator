@echo off
rem Windows: double-click to start the app. It opens in the browser at http://localhost:3000
cd /d "%~dp0"
if not exist node_modules\ (call npm run setup || goto :fail)
if not exist .next\BUILD_ID (call npm run build || goto :fail)
start "" /min cmd /c "timeout /t 6 >nul & start http://localhost:3000"
call npm start
goto :eof
:fail
echo.
echo No se pudo iniciar. Corre Instalar.cmd otra vez.
pause
