$ErrorActionPreference='Stop'
Stop-ScheduledTask -TaskName 'AvitoWarehouseSigner' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'AvitoWarehouseSigner' -Confirm:$false
# Keep configuration for an intentional reinstall; remove it manually to revoke local access.
