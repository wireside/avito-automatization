@echo off
chcp 65001 >nul
set "AVITO_SIGNER_SETUP_DIR=%~dp0"
echo Настройка фонового подписанта
powershell.exe -NoProfile -Command "Get-ChildItem -LiteralPath $env:AVITO_SIGNER_SETUP_DIR -Filter *.ps1 | Unblock-File"
if errorlevel 1 goto error
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0install-background.ps1"
if errorlevel 1 goto error
exit /b 0
:error
echo Настройка фонового запуска не завершена. Прочитайте сообщение выше.
pause
exit /b 1
