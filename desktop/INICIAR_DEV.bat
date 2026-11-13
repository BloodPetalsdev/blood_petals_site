@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale Node.js para iniciar.&pause&exit /b 1)
if not exist "node_modules\electron" call npm install --no-audit --no-fund
call npm start
pause
