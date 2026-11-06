@echo off
chcp 65001 >nul
set "AVITO_SIGNER_SETUP_DIR=%~dp0"
echo Установка подписанта владельца ИП
powershell.exe -NoProfile -Command "Get-ChildItem -LiteralPath $env:AVITO_SIGNER_SETUP_DIR -Filter *.ps1 | Unblock-File"
if errorlevel 1 goto error
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0install.ps1" -BootstrapPath "%~dp0connection.json"
if errorlevel 1 goto error
exit /b 0
:error
echo Установка не завершена. Прочитайте сообщение выше или файл ПРОЧИТАЙТЕ.txt.
pause
exit /b 1
