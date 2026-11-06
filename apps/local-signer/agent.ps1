param([Parameter(Mandatory=$true)][string]$ConfigPath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$cfg=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$base=[Uri]$cfg.BackendUrl
if($base.Scheme -ne 'https'){throw 'HTTPS_REQUIRED'}
$agentToken=$null
if($cfg.PSObject.Properties.Name -contains 'AgentTokenProtected'){
 $secure=ConvertTo-SecureString $cfg.AgentTokenProtected;$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
 try{$agentToken=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
}else{$agentToken=$cfg.AgentToken}
$headers=@{Authorization=('Bearer '+$agentToken)}
$agentToken=$null
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
function Call-Backend([string]$Action,$Body){
 Invoke-RestMethod -Method Post -Uri ($base.AbsoluteUri.TrimEnd('/')+'/api/v1/local-signer/'+$Action) -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 12 -Compress))) -TimeoutSec 20
}
function Hash-Bytes([byte[]]$Bytes){$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
function Get-Certificate {
 $store=New-Object -ComObject CAdESCOM.Store
 $store.Open(2,'My',0)
 try{
  $matches=$store.Certificates.Find(0,$cfg.CertificateThumbprint,$false)
  if($matches.Count -ne 1){throw 'CERTIFICATE_NOT_FOUND'}
  $cert=$matches.Item(1)
  if(-not $cert.HasPrivateKey()){throw 'PRIVATE_KEY_NOT_AVAILABLE'}
  if([DateTime]$cert.ValidFromDate -gt (Get-Date) -or [DateTime]$cert.ValidToDate -le (Get-Date)){throw 'CERTIFICATE_EXPIRED'}
  if($cert.SubjectName -notmatch ('(?:ИНН|INN|1\.2\.643\.3\.131\.1\.1)\s*=\s*"?'+[Regex]::Escape($cfg.SellerInn)+'(?:"|,|$)')){throw 'CERTIFICATE_INN_MISMATCH'}
  return $cert
 }finally{$store.Close()}
}
function Check-Chain($Cert){
 $native=New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (,[Convert]::FromBase64String($Cert.Export(0)))
 $chain=New-Object Security.Cryptography.X509Certificates.X509Chain
 try{
  $chain.ChainPolicy.RevocationMode=[Security.Cryptography.X509Certificates.X509RevocationMode]::Online
  $chain.ChainPolicy.RevocationFlag=[Security.Cryptography.X509Certificates.X509RevocationFlag]::EntireChain
  $chain.ChainPolicy.VerificationFlags=[Security.Cryptography.X509Certificates.X509VerificationFlags]::NoFlag
  $chain.ChainPolicy.UrlRetrievalTimeout=[TimeSpan]::FromSeconds(15)
  if(-not $chain.Build($native)){throw 'CERTIFICATE_CHAIN_INVALID'}
 }finally{$chain.Dispose();$native.Dispose()}
}
while($true){
 $cert=$null
 try{
  $cert=Get-Certificate
  Check-Chain $cert
  $null=Call-Backend 'heartbeat' @{signerId=$cfg.SignerId;certificateThumbprint=$cfg.CertificateThumbprint;certificateExpiresAt=([DateTime]$cert.ValidToDate).ToUniversalTime().ToString('o');ready=$true}
  $reply=Call-Backend 'claim' @{signerId=$cfg.SignerId}
  if($null -eq $reply.task){Start-Sleep -Seconds 5;continue}
  $task=$reply.task
  if($task.sellerInn -ne $cfg.SellerInn -or [DateTime]$task.expiresAt -le [DateTime]::UtcNow){throw 'TASK_POLICY_REJECTED'}
  if($task.purpose -eq 'AUTH'){
   if($task.documentType -ne 'CHZ_AUTH' -or $task.algorithm -ne 'GOST_CMS_ATTACHED'){throw 'TASK_POLICY_REJECTED'}
  }elseif($task.purpose -eq 'DOCUMENT'){
   if($task.documentType -notin @('LK_RECEIPT','LP_RETURN','LK_RECEIPT_CANCEL') -or $task.algorithm -ne 'GOST_CMS_DETACHED'){throw 'TASK_POLICY_REJECTED'}
   $doc=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($task.payloadBase64))|ConvertFrom-Json
   $docInn=if($task.documentType -eq 'LP_RETURN'){$doc.trade_participant_inn}else{$doc.inn}
   if($docInn -ne $cfg.SellerInn){throw 'DOCUMENT_INN_MISMATCH'}
  }else{throw 'TASK_POLICY_REJECTED'}
  $bytes=[Convert]::FromBase64String($task.payloadBase64)
  if($bytes.Length -gt 1048576 -or (Hash-Bytes $bytes) -ne $task.payloadHash){throw 'PAYLOAD_HASH_MISMATCH'}
  $signer=New-Object -ComObject CAdESCOM.CPSigner
  $signer.Certificate=$cert
  $signer.CheckCertificate=$true
  $signer.Options=1
  $data=New-Object -ComObject CAdESCOM.CadesSignedData
  $data.ContentEncoding=1
  $data.Content=$task.payloadBase64
  $detached=$task.purpose -eq 'DOCUMENT'
  $signature=$data.SignCades($signer,1,$detached,0)
  $verifier=New-Object -ComObject CAdESCOM.CadesSignedData
  if($detached){$verifier.ContentEncoding=1;$verifier.Content=$task.payloadBase64}
  $verifier.VerifyCades($signature,1,$detached)
  if($verifier.Signers.Count -ne 1 -or $verifier.Signers.Item(1).Certificate.Thumbprint -ne $cfg.CertificateThumbprint){throw 'SIGNATURE_CERTIFICATE_MISMATCH'}
  Check-Chain $cert
  $submission=@{taskId=$task.taskId;leaseId=$task.leaseId;signerId=$cfg.SignerId;payloadHash=$task.payloadHash;signatureBase64=($signature -replace '\s','');certificateBase64=($cert.Export(0) -replace '\s','');verification=@{valid=$true;chainValid=$true;revocationChecked=$true;signerInn=$cfg.SellerInn;payloadHash=$task.payloadHash}}
  # Reuse the exact lease and result after uncertain HTTP completion. Never sign again for a network retry.
  $sent=$false
  for($attempt=0;$attempt -lt 3 -and -not $sent;$attempt++){
   try{$null=Call-Backend 'submit' $submission;$sent=$true}catch{Start-Sleep -Seconds 2}
  }
  if(-not $sent){throw 'SIGNATURE_DELIVERY_FAILED'}
 }catch{
  # Exception messages may contain certificate data or payloads. Never log them.
  try{if($null -ne $cert){$null=Call-Backend 'heartbeat' @{signerId=$cfg.SignerId;certificateThumbprint=$cfg.CertificateThumbprint;certificateExpiresAt=([DateTime]$cert.ValidToDate).ToUniversalTime().ToString('o');ready=$false;errorCode='SIGNER_UNAVAILABLE'}}}catch{}
  Write-Output ((Get-Date).ToString('s')+' SIGNER_UNAVAILABLE')
  Start-Sleep -Seconds 15
 }
}
