param([switch]$RunHostIntegration)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=Split-Path -Parent $PSScriptRoot
$source=Get-Content -LiteralPath (Join-Path $root 'background-host.cs') -Raw
$windows=[Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$checks=0
function Assert($value,[string]$label){if(-not $value){throw ('FAILED '+$label)};$script:checks++}
if($PSVersionTable.PSEdition -eq 'Desktop'){
 Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.dll'
}else{
 $refs=@(Get-ChildItem "$PSHOME/ref/*.dll"|ForEach-Object{$_.FullName})
 Add-Type -TypeDefinition $source -ReferencedAssemblies $refs
}
$directory=Join-Path ([IO.Path]::GetTempPath()) 'Signer path with spaces'
$info=[AvitoSigner.BackgroundHost]::AgentStartInfo($directory)
Assert $info.CreateNoWindow 'No console is allocated'
Assert (-not $info.UseShellExecute) 'CreateNoWindow cannot be ignored by shell execution'
Assert ($info.RedirectStandardOutput -and $info.RedirectStandardError) 'Both output streams drained'
Assert ($info.Arguments.Contains(('"'+(Join-Path $directory 'agent.ps1')+'"'))) 'Script path quoted'
Assert ($info.Arguments.Contains(('"'+(Join-Path $directory 'config.json')+'"'))) 'Config path quoted'
Assert ($info.Arguments.EndsWith('-BackgroundMode')) 'Background watchdog mode'
if($RunHostIntegration){
 if(-not $windows -or $PSVersionTable.PSEdition -ne 'Desktop'){throw 'Integration requires Windows PowerShell 5.1'}
 . (Join-Path $root 'background-install.ps1')
 $dir=Join-Path ([IO.Path]::GetTempPath()) ('AvitoSignerFixture-'+[Guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $dir|Out-Null
 $hostProcess=$null;$second=0
 function Wait-Until([scriptblock]$check,[int]$seconds=45){
  $until=(Get-Date).AddSeconds($seconds)
  do{if(& $check){return};Start-Sleep -Milliseconds 500}while((Get-Date) -lt $until)
  throw 'Timed out waiting for background fixture'
 }
 try{
  $candidate=Build-SignerBackgroundHost $dir
  $exe=Join-Path $dir 'signer-background.exe'
  Move-Item -LiteralPath $candidate -Destination $exe
  $bytes=[IO.File]::ReadAllBytes($exe);$pe=[BitConverter]::ToInt32($bytes,60)
  Assert ([BitConverter]::ToUInt16($bytes,$pe+24+68) -eq 2) 'Windows GUI PE subsystem'
  '{}'|Set-Content -LiteralPath (Join-Path $dir 'config.json')
  @'
param([string]$ConfigPath,[switch]$BackgroundMode)
$dir=Split-Path -Parent $ConfigPath
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
[IO.File]::WriteAllText((Join-Path $dir 'console.txt'),[string]([ConsoleProbe]::GetConsoleWindow().ToInt64()))
[IO.File]::WriteAllText((Join-Path $dir 'pid.txt'),[string]$PID)
while($true){[IO.File]::WriteAllText((Join-Path $dir 'agent.alive'),'alive');Start-Sleep -Milliseconds 200}
'@|Set-Content -LiteralPath (Join-Path $dir 'agent.ps1') -Encoding UTF8
  $hostProcess=Start-Process -FilePath $exe -PassThru
  Wait-Until {Test-Path -LiteralPath (Join-Path $dir 'pid.txt')}
  $first=[int](Get-Content -LiteralPath (Join-Path $dir 'pid.txt'))
  Assert (-not $hostProcess.HasExited) 'Host stays alive for Task Scheduler'
  Assert ((Get-Content -LiteralPath (Join-Path $dir 'console.txt')) -eq '0') 'Worker has no allocated console'
  Stop-Process -Id $first -Force
  Wait-Until {([int](Get-Content -LiteralPath (Join-Path $dir 'pid.txt'))) -ne $first}
  $second=[int](Get-Content -LiteralPath (Join-Path $dir 'pid.txt'))
  Assert ([bool](Get-Process -Id $second -ErrorAction SilentlyContinue)) 'Unexpected child exit recovered'
  Stop-Process -Id $hostProcess.Id -Force
  Wait-Until {-not (Get-Process -Id $second -ErrorAction SilentlyContinue)}
  Assert (-not (Get-Process -Id $second -ErrorAction SilentlyContinue)) 'Host termination leaves no worker'
 }finally{
  if($hostProcess -and -not $hostProcess.HasExited){Stop-Process -Id $hostProcess.Id -Force}
  Start-Sleep -Seconds 1
  Remove-Item -LiteralPath $dir -Recurse -Force
 }
}
Write-Output "Background host: $checks checks passed; Windows process integration requested: $RunHostIntegration"
