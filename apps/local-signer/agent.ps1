param([Parameter(Mandatory=$true)][string]$ConfigPath)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'policy.ps1')
. (Join-Path $PSScriptRoot 'crypto-com.ps1')
$cfg=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$base=[Uri]$cfg.BackendUrl
if($base.Scheme -ne 'https' -or $base.UserInfo -or $base.Query -or $base.Fragment -or $base.AbsolutePath -ne '/'){throw 'HTTPS_REQUIRED'}
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
 $null=Invoke-SignerComMethod $store 'Open' @(2,'My',0)
 try{
  $certificates=Get-SignerComProperty $store 'Certificates'
  $matches=Invoke-SignerComMethod $certificates 'Find' @(0,$cfg.CertificateThumbprint,$false)
  if((Get-SignerComProperty $matches 'Count') -ne 1){throw 'CERTIFICATE_NOT_FOUND'}
  $cert=Get-SignerComProperty $matches 'Item' @(1)
  if(-not (Invoke-SignerComMethod $cert 'HasPrivateKey')){throw 'PRIVATE_KEY_NOT_AVAILABLE'}
  if([DateTime](Get-SignerComProperty $cert 'ValidFromDate') -gt (Get-Date) -or [DateTime](Get-SignerComProperty $cert 'ValidToDate') -le (Get-Date)){throw 'CERTIFICATE_EXPIRED'}
  if((Get-SignerInn (Get-SignerComProperty $cert 'SubjectName')) -ne $cfg.SellerInn){throw 'CERTIFICATE_INN_MISMATCH'}
  return ,$cert
 }finally{$null=Invoke-SignerComMethod $store 'Close'}
}
function Check-Chain($Cert){
 $native=New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (,[Convert]::FromBase64String((Invoke-SignerComMethod $Cert 'Export' @(0))))
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
 $stage='CERTIFICATE'
 try{
  $cert=Get-Certificate
  $stage='CERTIFICATE_CHAIN'
  Check-Chain $cert
  $stage='HEARTBEAT'
  $null=Call-Backend 'heartbeat' @{signerId=$cfg.SignerId;certificateThumbprint=$cfg.CertificateThumbprint;certificateExpiresAt=([DateTime](Get-SignerComProperty $cert 'ValidToDate')).ToUniversalTime().ToString('o');ready=$true}
  $stage='CLAIM'
  $reply=Call-Backend 'claim' @{signerId=$cfg.SignerId}
  if($null -eq $reply.task){Start-Sleep -Seconds 5;continue}
  $task=$reply.task
  $stage='TASK_POLICY'
  Assert-SigningTask $task $cfg.SellerInn
  $stage='CREATE_SIGNER'
  $signer=New-Object -ComObject CAdESCOM.CPSigner
  $stage='SET_SIGNER_CERTIFICATE'
  Set-SignerComProperty $signer 'Certificate' $cert
  $stage='SET_SIGNER_CHECK'
  Set-SignerComProperty $signer 'CheckCertificate' $true
  $stage='SET_SIGNER_OPTIONS'
  Set-SignerComProperty $signer 'Options' 1
  $stage='CREATE_DATA'
  $data=New-Object -ComObject CAdESCOM.CadesSignedData
  $stage='SET_CONTENT_ENCODING'
  Set-SignerComProperty $data 'ContentEncoding' 1
  $stage='SET_CONTENT'
  Set-SignerComProperty $data 'Content' $task.payloadBase64
  $detached=$task.purpose -eq 'DOCUMENT'
  $stage='MARSHAL_SIGNER'
  $dispatchSigner=ConvertTo-SignerDispatchArgument $signer
  $stage='SIGN'
  $signature=Invoke-SignerComMethod $data 'SignCades' @($dispatchSigner,1,$detached,0)
  $stage='CREATE_VERIFIER'
  $verifier=New-Object -ComObject CAdESCOM.CadesSignedData
  $stage='SET_VERIFY_ENCODING'
  Set-SignerComProperty $verifier 'ContentEncoding' 1
  $stage='SET_VERIFY_CONTENT'
  if($detached){Set-SignerComProperty $verifier 'Content' $task.payloadBase64}
  $stage='VERIFY_SIGNATURE'
  $null=Invoke-SignerComMethod $verifier 'VerifyCades' @($signature,1,$detached)
  $stage='VERIFY_CONTENT_HASH'
  if(-not $detached){if((Hash-Bytes ([Convert]::FromBase64String((Get-SignerComProperty $verifier 'Content')))) -cne $task.payloadHash){throw 'SIGNATURE_PAYLOAD_MISMATCH'}}
  $stage='VERIFY_SIGNER'
  $verifiedSigners=Get-SignerComProperty $verifier 'Signers'
  if((Get-SignerComProperty $verifiedSigners 'Count') -ne 1){throw 'SIGNATURE_CERTIFICATE_MISMATCH'}
  $verifiedSigner=Get-SignerComProperty $verifiedSigners 'Item' @(1)
  $verifiedCertificate=Get-SignerComProperty $verifiedSigner 'Certificate'
  if((Get-SignerComProperty $verifiedCertificate 'Thumbprint') -ne $cfg.CertificateThumbprint){throw 'SIGNATURE_CERTIFICATE_MISMATCH'}
  $stage='CERTIFICATE_CHAIN'
  Check-Chain $cert
  $stage='BUILD_SUBMISSION'
  $submission=@{taskId=$task.taskId;leaseId=$task.leaseId;signerId=$cfg.SignerId;payloadHash=$task.payloadHash;signatureBase64=($signature -replace '\s','');certificateBase64=((Invoke-SignerComMethod $cert 'Export' @(0)) -replace '\s','');verification=@{valid=$true;chainValid=$true;revocationChecked=$true;signerInn=$cfg.SellerInn;payloadHash=$task.payloadHash}}
  # Reuse the exact lease and result after uncertain HTTP completion. Never sign again for a network retry.
  $stage='SUBMIT'
  $sent=$false
  for($attempt=0;$attempt -lt 3 -and -not $sent;$attempt++){
   try{$null=Call-Backend 'submit' $submission;$sent=$true}catch{Write-Output (Get-SignerFailureDiagnostic $_ 'SUBMIT');Start-Sleep -Seconds 2}
  }
  if(-not $sent){throw 'SIGNATURE_DELIVERY_FAILED'}
 }catch{
  $diagnostic=Get-SignerFailureDiagnostic $_ $stage
  # Exception messages may contain certificate data or payloads. Never log them.
  try{if($null -ne $cert){$null=Call-Backend 'heartbeat' @{signerId=$cfg.SignerId;certificateThumbprint=$cfg.CertificateThumbprint;certificateExpiresAt=([DateTime](Get-SignerComProperty $cert 'ValidToDate')).ToUniversalTime().ToString('o');ready=$false;errorCode='SIGNER_UNAVAILABLE'}}}catch{}
  Write-Output ((Get-Date).ToString('s')+' '+$diagnostic)
  Start-Sleep -Seconds 15
 }
}
