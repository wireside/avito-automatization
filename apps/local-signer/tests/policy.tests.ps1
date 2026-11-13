$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../policy.ps1')
$checks=0
function Assert($Condition,[string]$Name){if(-not $Condition){throw "FAILED $Name"};$script:checks++}
function Reject([scriptblock]$Call,[string]$Name){$rejected=$false;try{& $Call}catch{$rejected=$true};Assert $rejected $Name}
foreach($subject in @('CN=Test, INN=123456789012','CN=Тест, ИНН=123456789012','1.2.643.3.131.1.1=123456789012, CN=Test','OID.1.2.643.3.131.1.1="123456789012", CN=Test',"CN=Test`nINN=123456789012")) {Assert ((Get-SignerInn $subject) -ceq '123456789012') 'INN extraction'}
foreach($subject in @('CN=INN=123456789012','INN=1234567890','INN=1234567890123','CN=Test')) {Reject {Get-SignerInn $subject} 'Malformed INN'}
$dir=Join-Path ([IO.Path]::GetTempPath()) 'Владелец ИП/Подписант с пробелом'
$config=Join-Path $dir 'config.json'
$argsText=Get-AgentArguments $dir $config
Assert ($argsText -match '^-NoProfile -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File ') 'Scheduled launch hides the console before script arguments'
Assert ($argsText.Contains(('"'+(Join-Path $dir 'agent.ps1')+'"'))) 'Quoted script path'
Assert ($argsText.Contains(('"'+$config+'"'))) 'Quoted config path'
function Task([string]$Payload,[string]$Purpose='DOCUMENT',[string]$Type='LK_RECEIPT'){
 $bytes=[Text.Encoding]::UTF8.GetBytes($Payload);$sha=[Security.Cryptography.SHA256]::Create();try{$hash=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 return [PSCustomObject]@{purpose=$Purpose;documentType=$Type;algorithm=$(if($Purpose -eq 'AUTH'){'GOST_CMS_ATTACHED'}else{'GOST_CMS_DETACHED'});sellerInn='123456789012';expiresAt=[DateTime]::UtcNow.AddMinutes(2).ToString('o');payloadBase64=[Convert]::ToBase64String($bytes);payloadHash=$hash}
}
$task=Task '{"inn":"123456789012","action":"DISTANCE","products":[{"cis":"01TEST"}]}'
Assert-SigningTask $task '123456789012';$checks++
$original=$task.payloadBase64
Reject {Assert-SigningTask $task '999999999999'} 'Wrong seller'
$task.payloadHash='0'*64;Reject {Assert-SigningTask $task '123456789012'} 'Wrong hash'
$task=Task '{"inn":"999999999999","action":"DISTANCE"}';Reject {Assert-SigningTask $task '123456789012'} 'Wrong document INN'
$task=Task '{"inn":"123456789012","action":"OTHER"}';Reject {Assert-SigningTask $task '123456789012'} 'Unapproved document reason'
$task=Task 'challenge bytes' 'AUTH' 'CHZ_AUTH';Assert-SigningTask $task '123456789012';$checks++
$task.algorithm='GOST_CMS_DETACHED';Reject {Assert-SigningTask $task '123456789012'} 'Wrong AUTH signature format'
$task=Task '{"trade_participant_inn":"123456789012","return_type":"REMOTE_SALE_RETURN"}' 'DOCUMENT' 'LP_RETURN';Assert-SigningTask $task '123456789012';$checks++
$task.expiresAt=[DateTime]::UtcNow.AddSeconds(-1).ToString('o');Reject {Assert-SigningTask $task '123456789012'} 'Expired task'
foreach($offset in @(-7,3)){
 $task=Task 'challenge bytes' 'AUTH' 'CHZ_AUTH'
 $task.expiresAt=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToOffset([TimeSpan]::FromHours($offset)).ToString('o')
 Reject {Assert-SigningTask $task '123456789012'} 'Expired task with explicit offset'
 $task.expiresAt=[DateTimeOffset]::UtcNow.AddMinutes(2).ToOffset([TimeSpan]::FromHours($offset)).ToString('o')
 Assert-SigningTask $task '123456789012';$checks++
}
$task=Task '{"inn":"123456789012","lk_receipt_id":"original"}' 'DOCUMENT' 'LK_RECEIPT_CANCEL';Assert-SigningTask $task '123456789012';$checks++
Write-Output "PowerShell policy: $checks checks passed"
