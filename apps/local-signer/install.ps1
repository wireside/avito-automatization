param([string]$BootstrapPath)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'policy.ps1')
. (Join-Path $PSScriptRoot 'crypto-check.ps1')
Add-Type -AssemblyName System.Windows.Forms
function Fail([string]$Text){[Windows.Forms.MessageBox]::Show($Text,'Подключение подписи','OK','Warning')|Out-Null;exit 1}
function Hash([string]$Text){$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
function Protect([string]$Value){return ConvertFrom-SecureString (ConvertTo-SecureString $Value -AsPlainText -Force)}
function Unprotect([string]$Value){$secure=ConvertTo-SecureString $Value;$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}}
function RandomHex { $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes);return ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()}finally{$rng.Dispose()}}
if(-not $BootstrapPath){$BootstrapPath=Join-Path $PSScriptRoot 'connection.json'}
try{$bootstrap=Get-Content -LiteralPath $BootstrapPath -Raw|ConvertFrom-Json;$base=[Uri]$bootstrap.backendUrl;if($base.Scheme -ne 'https' -or $base.UserInfo -or $base.Query -or $base.Fragment -or $base.AbsolutePath -ne '/' -or $bootstrap.ticket -notmatch '^[A-Za-z0-9_-]{43}$'){throw 'INVALID_BOOTSTRAP'}}catch{Fail 'Получите новый установщик в нашем Telegram-боте: /signer. Файл подключения отсутствует или повреждён.'}
$cryptoCheck=Test-SignerCryptoEnvironment
if(-not $cryptoCheck.Ready){Fail (Format-SignerCryptoFailure $cryptoCheck)}
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$dir=Join-Path $env:LOCALAPPDATA 'AvitoWarehouseSigner'
$null=New-Item -ItemType Directory -Path $dir -Force
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $dir /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F'|Out-Null
if($LASTEXITCODE -ne 0){Fail 'Не удалось защитить папку подписанта. Обратитесь к администратору Windows.'}
$pending=Join-Path $dir 'config.pending.json'
$ticketHash=Hash $bootstrap.ticket
$cfg=$null
if(Test-Path -LiteralPath $pending){try{$prev=Get-Content -LiteralPath $pending -Raw|ConvertFrom-Json;if($prev.InstallTicketHash -eq $ticketHash -and $prev.BackendUrl -eq $base.AbsoluteUri){$cfg=$prev}}catch{}}
try{
 if($null -eq $cfg){
  $store=New-Object Security.Cryptography.X509Certificates.X509Store 'My','CurrentUser';$store.Open('ReadOnly')
  try{
   $candidates=New-Object Security.Cryptography.X509Certificates.X509Certificate2Collection
   foreach($c in $store.Certificates){
    try{$candidateInn=Get-SignerInn $c.Subject}catch{continue}
    if($c.HasPrivateKey -and $c.NotBefore -le (Get-Date) -and $c.NotAfter -gt (Get-Date) -and $c.PublicKey.Oid.Value -in @('1.2.643.7.1.1.1.1','1.2.643.7.1.1.1.2')){$null=$candidates.Add($c)}
   }
   if($candidates.Count -eq 0){Fail 'Подключите токен владельца ИП и установите его действующий сертификат в «Личное — текущий пользователь». Подходящая УКЭП ИП не найдена.'}
   if($candidates.Count -eq 1){$cert=$candidates[0]}else{$chosen=[Security.Cryptography.X509Certificates.X509Certificate2UI]::SelectFromCollection($candidates,'Подпись владельца ИП','Выберите УКЭП нашего ИП на подключённом токене.',0);if($chosen.Count -ne 1){exit 1};$cert=$chosen[0]}
   $inn=Get-SignerInn $cert.Subject
   $token=RandomHex
   $pairingCode=([Convert]::ToUInt32((RandomHex).Substring(0,8),16)%1000000).ToString('D6')
   $signerId=($env:COMPUTERNAME -replace '[^A-Za-z0-9_-]','_');if($signerId.Length -gt 32){$signerId=$signerId.Substring(0,32)};$signerId+='_'+[Guid]::NewGuid().ToString('N').Substring(0,12)
   $cfg=[PSCustomObject]@{BackendUrl=$base.AbsoluteUri;SellerInn=$inn;CertificateThumbprint=$cert.Thumbprint;SignerId=$signerId;AgentTokenProtected=(Protect $token);InstallTicketHash=$ticketHash;PairingCode=$pairingCode;PublicCertificate=[Convert]::ToBase64String($cert.RawData)}
   $cfg|ConvertTo-Json|Set-Content -LiteralPath $pending -Encoding UTF8
  }finally{$store.Close()}
 }
 $token=Unprotect $cfg.AgentTokenProtected
 $body=@{ticket=$bootstrap.ticket;signerId=$cfg.SignerId;deviceTokenHash=(Hash $token);pairingCode=$cfg.PairingCode;certificateBase64=$cfg.PublicCertificate}|ConvertTo-Json -Compress
 $null=Invoke-RestMethod -Method Post -Uri ($base.AbsoluteUri.TrimEnd('/')+'/api/v1/local-signer/register') -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 20
 Write-Host "`nКод подключения: $($cfg.PairingCode)" -ForegroundColor Cyan
 Write-Host "ИНН ИП: $($cfg.SellerInn)`n"
 Write-Host 'Сравните этот код с сообщением нашего Telegram-бота и нажмите «Подключить этот компьютер».'
 Write-Host 'Если сообщение ещё не появилось, отправьте боту /signer. Оставьте это окно открытым.'
 $headers=@{Authorization=('Bearer '+$token)};$deadline=(Get-Date).AddMinutes(20);$active=$false
 while((Get-Date) -lt $deadline){
  try{$status=Invoke-RestMethod -Method Post -Uri ($base.AbsoluteUri.TrimEnd('/')+'/api/v1/local-signer/status') -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 20}catch{Start-Sleep -Seconds 5;continue}
  if($status.status -eq 'ACTIVE'){$active=$true;break}
  if($status.status -ne 'PENDING'){Fail 'Подключение отклонено или ссылка устарела. Получите новый установщик командой /signer.'}
  Start-Sleep -Seconds 3
 }
 if(-not $active){Fail 'Подтверждение не получено. Запустите установщик повторно или получите новую ссылку через /signer.'}
 Stop-ScheduledTask -TaskName 'AvitoWarehouseSigner' -ErrorAction SilentlyContinue
 foreach($name in @('agent.ps1','policy.ps1')){Copy-Item (Join-Path $PSScriptRoot $name) (Join-Path $dir $name) -Force}
 $config=Join-Path $dir 'config.json'
 @{BackendUrl=$cfg.BackendUrl;SellerInn=$cfg.SellerInn;CertificateThumbprint=$cfg.CertificateThumbprint;SignerId=$cfg.SignerId;AgentTokenProtected=$cfg.AgentTokenProtected}|ConvertTo-Json|Set-Content -LiteralPath $config -Encoding UTF8
 $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (Get-AgentArguments $dir $config)
 $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
 $principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
 $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
 Register-ScheduledTask -TaskName 'AvitoWarehouseSigner' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force|Out-Null
 Start-ScheduledTask -TaskName 'AvitoWarehouseSigner'
 Remove-Item -LiteralPath $pending -Force
 $token=$null
 [Windows.Forms.MessageBox]::Show('Подписант установлен. Оставьте владельца вошедшим в Windows и токен подключённым. При первом запросе подписи может появиться окно PIN. Состояние подключения видно в настройках приложения.','Готово','OK','Information')|Out-Null
}catch{Fail 'Установка не завершена. Проверьте интернет и доступность backend, затем запустите этот же установщик снова. Если ссылка истекла — отправьте боту /signer. Технические данные и секреты не выводятся.'}
