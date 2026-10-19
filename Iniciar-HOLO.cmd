@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Instalar-HOLO.ps1" %*
if errorlevel 1 (
  echo.
  echo A instalacao nao foi concluida. Veja o erro acima.
  pause
)
endlocal
