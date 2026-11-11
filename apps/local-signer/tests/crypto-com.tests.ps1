$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../crypto-com.ps1')
$checks=0
function Assert($Condition,[string]$Name){if(-not $Condition){throw "FAILED $Name"};$script:checks++}

Add-Type -TypeDefinition @'
using System;
using System.Collections;
using System.Runtime.InteropServices;
public class SignerInteropProbe : IEnumerable {
 public object Certificate { get; set; }
 public string Content { get; set; }
 public bool CheckCertificate { get; set; }
 public int ContentEncoding { get; set; }
 public int Count { get { return 1; } }
 public SignerInteropProbe this[int index] {
  get { if (index != 1) throw new Exception("WRONG_INDEX"); return this; }
 }
 public SignerInteropProbe Find(int kind, string fingerprint, bool validOnly) {
  if (kind != 0 || fingerprint != "fixture" || validOnly) throw new Exception("WRONG_FIND_ARGUMENTS");
  return this;
 }
 public string SignCades(object signer, int type, bool detached, int encoding) {
  if (!Object.ReferenceEquals(signer, this) || type != 1 || encoding != 0) throw new Exception("WRONG_SIGN_ARGUMENTS");
  return detached ? "detached" : "attached";
 }
 public void VerifyCades(string signature, int type, bool detached) {
  if (type != 1 || signature != (detached ? "detached" : "attached")) throw new Exception("WRONG_VERIFY_ARGUMENTS");
 }
 public void Fail() { throw new COMException("PRIVATE_DETAILS", unchecked((int)0x80004003)); }
 public IEnumerator GetEnumerator() { throw new Exception("COM_COLLECTION_MUST_NOT_BE_ENUMERATED"); }
}
'@
function Get-SignerComDispatchType { return [SignerInteropProbe] }
$probe=[SignerInteropProbe]::new()
$collection=Invoke-SignerComMethod $probe 'Find' @(0,'fixture',$false)
Assert ([object]::ReferenceEquals($probe,$collection)) 'COM collection is not enumerated'
Assert ((Get-SignerComProperty $collection 'Count') -eq 1) 'Collection count'
$cert=Get-SignerComProperty $collection 'Item' @(1)
Assert ([object]::ReferenceEquals($probe,$cert)) 'Indexed Item is a property, not a method'
Set-SignerComProperty $probe 'Certificate' $cert
Assert ([object]::ReferenceEquals($cert,(Get-SignerComProperty $probe 'Certificate'))) 'COM object property is not enumerated or converted'
$payload=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("Точные байты`r`n"+[char]29+"`n"))
Set-SignerComProperty $probe 'Content' $payload
Assert ((Get-SignerComProperty $probe 'Content') -ceq $payload) 'Payload base64 is unchanged'
foreach($value in @($true,$false)){
 Set-SignerComProperty $probe 'CheckCertificate' $value
 Assert ((Get-SignerComProperty $probe 'CheckCertificate') -ceq $value) 'Boolean property type and value'
}
Set-SignerComProperty $probe 'ContentEncoding' 1
Assert ((Get-SignerComProperty $probe 'ContentEncoding') -eq 1) 'Numeric property'
foreach($detached in @($false,$true)){
 $signature=Invoke-SignerComMethod $probe 'SignCades' @($probe,1,$detached,0)
 $expected=if($detached){'detached'}else{'attached'}
 Assert ($signature -ceq $expected) 'AUTH and DOCUMENT arguments retain boolean and zero values'
 $verified=Invoke-SignerComMethod $probe 'VerifyCades' @($signature,1,$detached)
 Assert ($null -eq $verified) 'Void method emits no spurious value'
}
$failure=$null
try{$null=Invoke-SignerComMethod $probe 'Fail'}catch{$failure=$_.Exception}
while($null -ne $failure.InnerException){$failure=$failure.InnerException}
Assert ($failure -is [Runtime.InteropServices.COMException] -and $failure.HResult -eq -2147467261) 'Underlying HRESULT survives reflection'
Write-Output "COM dispatch: $checks checks passed (managed fixtures, no keys or network)"
