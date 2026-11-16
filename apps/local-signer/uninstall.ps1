$ErrorActionPreference='Stop'
$task=Get-ScheduledTask -TaskName 'AvitoWarehouseSigner' -ErrorAction SilentlyContinue
if($task){Stop-ScheduledTask -TaskName 'AvitoWarehouseSigner';Unregister-ScheduledTask -TaskName 'AvitoWarehouseSigner' -Confirm:$false}
# Preserve encrypted configuration, certificates and private keys.
