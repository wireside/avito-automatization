$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../crypto-check.ps1')
$checks=0
function Assert($Condition,[string]$Name){if(-not $Condition){throw "FAILED $Name"};$script:checks++}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CryptoCheckStore {
 public static string FailureStage = "NONE";
 public static bool Opened, Closed;
 public void Open(int location, string name, int mode) {
  if (location != 2 || name != "My" || mode != 0) throw new Exception("WRONG_STORE_ARGUMENTS");
  if (FailureStage == "OPEN_CURRENT_USER_MY") throw new COMException("PRIVATE_OPEN_DETAILS", unchecked((int)0x80070005));
  Opened = true;
 }
 public void Close() {
  if (FailureStage == "CLOSE_STORE") throw new COMException("PRIVATE_CLOSE_DETAILS", unchecked((int)0x80004005));
  Closed = true;
 }
}
'@
# Exercise the actual InvokeMember path on a managed fixture outside Windows.
function Get-SignerComDispatchType { return [CryptoCheckStore] }
function Mock-Store {
 if([CryptoCheckStore]::FailureStage -eq 'CREATE_STORE'){
  throw [Runtime.InteropServices.COMException]::new('PRIVATE_CREATE_DETAILS',-2147221164)
 }
 return [CryptoCheckStore]::new()
}
$result=Test-SignerCryptoEnvironment { Mock-Store }
Assert ($result.Ready -and $result.Stage -eq 'COMPLETE') 'Successful probe'
Assert ([CryptoCheckStore]::Opened -and [CryptoCheckStore]::Closed) 'Read-only store opened and closed'
Assert ($result.ProcessBits -in @(32,64)) 'Process bitness'
Assert ($result.PowerShellVersion -eq $PSVersionTable.PSVersion.ToString()) 'PowerShell version'
foreach($case in @(
 @{Stage='CREATE_STORE';Code='0x80040154'},
 @{Stage='OPEN_CURRENT_USER_MY';Code='0x80070005'},
 @{Stage='CLOSE_STORE';Code='0x80004005'}
)){
 [CryptoCheckStore]::FailureStage=$case.Stage
 $result=Test-SignerCryptoEnvironment { Mock-Store }
 Assert (-not $result.Ready -and $result.Stage -eq $case.Stage) 'Failure stage preserved'
 Assert ($result.HResult -ceq $case.Code) 'Underlying COM HRESULT preserved'
 $message=Format-SignerCryptoFailure $result
 Assert ($message.Contains($case.Stage) -and $message.Contains($case.Code)) 'Actionable diagnostic'
 Assert (-not $message.Contains('PRIVATE_')) 'Exception content is not disclosed'
}
Write-Output "Crypto check: $checks checks passed (mock stores, no keys or network)"
