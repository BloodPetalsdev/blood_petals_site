@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo [Silent Garden Motion Studio] Compilando versao portatil...
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js nao encontrado. Instale Node.js 22 ou posterior.
 pause
 exit /b 1
)
call npm install --no-audit --no-fund
if errorlevel 1 goto fail
call npm run dist:win
if errorlevel 1 goto fail
echo.
echo Pronto! Procure o .exe na pasta dist.
explorer "dist"
pause
exit /b 0
:fail
echo Erro durante a compilacao. Confira os detalhes acima.
pause
exit /b 1
