param([string]$OwnerSid)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'background-install.ps1')
$current=[Security.Principal.WindowsIdentity]::GetCurrent()
if($OwnerSid -and $OwnerSid -ne $current.User.Value){throw 'OWNER_MISMATCH'}
if(-not ([Security.Principal.WindowsPrincipal]::new($current)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
 $arguments='-NoProfile -ExecutionPolicy RemoteSigned -File "'+$PSCommandPath+'" -OwnerSid "'+$current.User.Value+'"'
 $process=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -Verb RunAs -Wait -PassThru
 exit $process.ExitCode
}
$dir=Join-Path $env:LOCALAPPDATA 'AvitoWarehouseSigner'
if(-not (Test-Path -LiteralPath (Join-Path $dir 'config.json'))){throw 'EXISTING_INSTALLATION_REQUIRED'}
try{Install-SignerBackgroundTask $dir}catch{if(Get-ScheduledTask -TaskName 'AvitoWarehouseSigner' -ErrorAction SilentlyContinue){Start-ScheduledTask -TaskName 'AvitoWarehouseSigner'};throw}
Write-Host 'Фоновый запуск настроен без пароля Windows и без терминала. После перезагрузки войдите в ту же учётную запись. Проверьте статус подписанта в приложении.'
