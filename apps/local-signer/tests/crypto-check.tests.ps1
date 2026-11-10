$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../crypto-check.ps1')
$checks=0
function Assert($Condition,[string]$Name){if(-not $Condition){throw "FAILED $Name"};$script:checks++}
$script:failureStage='NONE'
$script:opened=$false
$script:closed=$false
function Mock-Store {
 if($script:failureStage -eq 'CREATE_STORE'){
  throw [Runtime.InteropServices.COMException]::new('PRIVATE_CREATE_DETAILS',-2147221164)
 }
 $store=[PSCustomObject]@{}
 $store|Add-Member ScriptMethod Open {
  param($Location,$Name,$Mode)
  if($Location -ne 2 -or $Name -cne 'My' -or $Mode -ne 0){throw 'WRONG_STORE_ARGUMENTS'}
  if($script:failureStage -eq 'OPEN_CURRENT_USER_MY'){
   throw [Runtime.InteropServices.COMException]::new('PRIVATE_OPEN_DETAILS',-2147024891)
  }
  $script:opened=$true
 }
 $store|Add-Member ScriptMethod Close {
  if($script:failureStage -eq 'CLOSE_STORE'){
   throw [Runtime.InteropServices.COMException]::new('PRIVATE_CLOSE_DETAILS',-2147467259)
  }
  $script:closed=$true
 }
 return $store
}
$result=Test-SignerCryptoEnvironment { Mock-Store }
Assert ($result.Ready -and $result.Stage -eq 'COMPLETE') 'Successful probe'
Assert ($script:opened -and $script:closed) 'Read-only store opened and closed'
Assert ($result.ProcessBits -in @(32,64)) 'Process bitness'
Assert ($result.PowerShellVersion -eq $PSVersionTable.PSVersion.ToString()) 'PowerShell version'
foreach($case in @(
 @{Stage='CREATE_STORE';Code='0x80040154'},
 @{Stage='OPEN_CURRENT_USER_MY';Code='0x80070005'},
 @{Stage='CLOSE_STORE';Code='0x80004005'}
)){
 $script:failureStage=$case.Stage
 $result=Test-SignerCryptoEnvironment { Mock-Store }
 Assert (-not $result.Ready -and $result.Stage -eq $case.Stage) 'Failure stage preserved'
 Assert ($result.HResult -ceq $case.Code) 'Underlying COM HRESULT preserved'
 $message=Format-SignerCryptoFailure $result
 Assert ($message.Contains($case.Stage) -and $message.Contains($case.Code)) 'Actionable diagnostic'
 Assert (-not $message.Contains('PRIVATE_')) 'Exception content is not disclosed'
}
Write-Output "Crypto check: $checks checks passed (mock stores, no keys or network)"
