Set-StrictMode -Version Latest
function Get-SignerInn([string]$Subject) {
 $match=[Regex]::Match($Subject,'(?:^|,\s*|\n)(?:ИНН|INN|OID\.1\.2\.643\.3\.131\.1\.1|1\.2\.643\.3\.131\.1\.1)\s*=\s*"?(\d{12})(?:"|,|\r?$)',[Text.RegularExpressions.RegexOptions]::Multiline)
 if(-not $match.Success){throw 'CERTIFICATE_INN_UNREADABLE'}
 return $match.Groups[1].Value
}
function Get-AgentArguments([string]$Directory,[string]$ConfigPath) {
 $script=Join-Path $Directory 'agent.ps1'
 return "-NoProfile -ExecutionPolicy RemoteSigned -File `"$script`" -ConfigPath `"$ConfigPath`""
}
function Assert-SigningTask($Task,[string]$SellerInn) {
 if($Task.sellerInn -ne $SellerInn -or [DateTime]$Task.expiresAt -le [DateTime]::UtcNow){throw 'TASK_POLICY_REJECTED'}
 $bytes=[Convert]::FromBase64String($Task.payloadBase64)
 if($bytes.Length -eq 0 -or $bytes.Length -gt 1048576){throw 'PAYLOAD_SIZE_INVALID'}
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$hash=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($hash -cne $Task.payloadHash){throw 'PAYLOAD_HASH_MISMATCH'}
 if($Task.purpose -eq 'AUTH'){
  if($Task.documentType -ne 'CHZ_AUTH' -or $Task.algorithm -ne 'GOST_CMS_ATTACHED'){throw 'TASK_POLICY_REJECTED'}
 }elseif($Task.purpose -eq 'DOCUMENT'){
  if($Task.documentType -notin @('LK_RECEIPT','LP_RETURN','LK_RECEIPT_CANCEL') -or $Task.algorithm -ne 'GOST_CMS_DETACHED'){throw 'TASK_POLICY_REJECTED'}
  $utf8=New-Object Text.UTF8Encoding($false,$true)
  $doc=$utf8.GetString($bytes)|ConvertFrom-Json
  $docInn=if($Task.documentType -eq 'LP_RETURN'){$doc.trade_participant_inn}else{$doc.inn}
  if($docInn -cne $SellerInn){throw 'DOCUMENT_INN_MISMATCH'}
  if($Task.documentType -eq 'LK_RECEIPT' -and $doc.action -notin @('DISTANCE','LOSS','DESTRUCTION')){throw 'DOCUMENT_ACTION_REJECTED'}
  if($Task.documentType -eq 'LP_RETURN' -and $doc.return_type -ne 'REMOTE_SALE_RETURN'){throw 'DOCUMENT_ACTION_REJECTED'}
 }else{throw 'TASK_POLICY_REJECTED'}
}
