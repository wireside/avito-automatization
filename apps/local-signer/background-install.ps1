# Passwordless interactive task, preserving CurrentUser/My and user DPAPI.
function Build-SignerBackgroundHost([string]$Directory){
 $provider=New-Object Microsoft.CSharp.CSharpCodeProvider
 $parameters=New-Object CodeDom.Compiler.CompilerParameters
 $parameters.GenerateExecutable=$true
 $parameters.GenerateInMemory=$false
 $parameters.CompilerOptions='/target:winexe /platform:anycpu'
 $parameters.ReferencedAssemblies.Add('System.dll')|Out-Null
 $temporary=Join-Path $Directory ('background-'+[Guid]::NewGuid().ToString('N')+'.exe')
 $parameters.OutputAssembly=$temporary
 try{
  $result=$provider.CompileAssemblyFromSource($parameters,(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'background-host.cs') -Raw))
  if($result.Errors.HasErrors){throw 'BACKGROUND_BUILD_FAILED'}
  return $temporary
 }catch{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force};throw}
 finally{$provider.Dispose()}
}
function Install-SignerBackgroundTask([string]$Directory){
 if(Get-Service -Name 'AvitoWarehouseSigner' -ErrorAction SilentlyContinue){throw 'EXISTING_WINDOWS_SERVICE_MUST_BE_REMOVED_FIRST'}
 if(-not (Test-Path -LiteralPath (Join-Path $Directory 'config.json'))){throw 'INCOMPLETE_SIGNER_FILES'}
 foreach($name in @('agent.ps1','policy.ps1','crypto-com.ps1')){
  if(-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name))){throw 'INCOMPLETE_SIGNER_FILES'}
 }
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
 $candidate=Build-SignerBackgroundHost $Directory
 $old=Get-ScheduledTask -TaskName 'AvitoWarehouseSigner' -ErrorAction SilentlyContinue
 $xml=$null
 if($old){$xml=Export-ScheduledTask -TaskName 'AvitoWarehouseSigner'}
 $exe=Join-Path $Directory 'signer-background.exe'
 $backup=$exe+'.previous'
 try{
  if($old){
   Stop-ScheduledTask -TaskName 'AvitoWarehouseSigner'
   $until=(Get-Date).AddSeconds(30)
   while((Get-ScheduledTask -TaskName 'AvitoWarehouseSigner').State -eq 'Running'){
    if((Get-Date) -gt $until){throw 'BACKGROUND_STOP_TIMEOUT'}
    Start-Sleep -Milliseconds 200
   }
  }
  foreach($name in @('agent.ps1','policy.ps1','crypto-com.ps1')){
   $source=Join-Path $PSScriptRoot $name
   $destination=Join-Path $Directory $name
   if([IO.Path]::GetFullPath($source) -ne [IO.Path]::GetFullPath($destination)){
    Copy-Item -LiteralPath $source -Destination $destination -Force
   }
  }
  if(Test-Path -LiteralPath $exe){Move-Item -LiteralPath $exe -Destination $backup -Force}
  Move-Item -LiteralPath $candidate -Destination $exe -Force
  $action=New-ScheduledTaskAction -Execute $exe -WorkingDirectory $Directory
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
  Register-ScheduledTask -TaskName 'AvitoWarehouseSigner' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force|Out-Null
  Start-ScheduledTask -TaskName 'AvitoWarehouseSigner'
  Start-Sleep -Seconds 2
  if((Get-ScheduledTask -TaskName 'AvitoWarehouseSigner').State -ne 'Running'){throw 'BACKGROUND_START_FAILED'}
  if(Test-Path -LiteralPath $backup){Remove-Item -LiteralPath $backup -Force}
 }catch{
  Stop-ScheduledTask -TaskName 'AvitoWarehouseSigner' -ErrorAction SilentlyContinue
  if(Test-Path -LiteralPath $backup){Move-Item -LiteralPath $backup -Destination $exe -Force}
  if($xml){Register-ScheduledTask -TaskName 'AvitoWarehouseSigner' -Xml $xml -Force|Out-Null;Start-ScheduledTask -TaskName 'AvitoWarehouseSigner'}
  throw
 }finally{if(Test-Path -LiteralPath $candidate){Remove-Item -LiteralPath $candidate -Force}}
}
