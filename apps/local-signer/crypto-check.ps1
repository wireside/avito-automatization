function Test-SignerCryptoEnvironment {
 param([scriptblock]$CreateStore = { New-Object -ComObject CAdESCOM.Store })
 $stage='CREATE_STORE'
 $store=$null
 $result=[ordered]@{
  Ready=$false
  Stage=$stage
  HResult=$null
  PowerShellVersion=$PSVersionTable.PSVersion.ToString()
  ProcessBits=([IntPtr]::Size*8)
 }
 try {
  $store=& $CreateStore
  $stage='OPEN_CURRENT_USER_MY'
  $store.Open(2,'My',0)
  $stage='CLOSE_STORE'
  $store.Close()
  $result.Ready=$true
  $result.Stage='COMPLETE'
 }catch {
  # Only allowlisted diagnostics: exception text can contain private data.
  $failure=$_.Exception
  while($null -ne $failure.InnerException){$failure=$failure.InnerException}
  $result.Stage=$stage
  $result.HResult='0x'+([BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$failure.HResult),0)).ToString('X8')
 }finally {
  if($null -ne $store -and [Runtime.InteropServices.Marshal]::IsComObject($store)){
   try{$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($store)}catch{}
  }
 }
 return [PSCustomObject]$result
}

function Format-SignerCryptoFailure($Result) {
 $hint=switch($Result.Stage){
  'CREATE_STORE' {
   if($Result.HResult -eq '0x80040154'){'Компонент CAdESCOM.Store не зарегистрирован для разрядности этого PowerShell. Проверьте регистрацию и разрядность КриптоПро ЭЦП Browser plug-in.'}
   else{'Не удалось создать CAdESCOM.Store. Это не доказывает отсутствие КриптоПро.'}
  }
  'OPEN_CURRENT_USER_MY' {'CAdESCOM.Store создан, но не удалось открыть «Личное — текущий пользователь» на чтение. Проверьте доступ к хранилищу; переустановка плагина не является обязательным решением.'}
  'CLOSE_STORE' {'CAdESCOM.Store создан и хранилище открыто, но произошла ошибка при его закрытии.'}
  default {'Проверка CAdESCOM не завершена.'}
 }
 return "$hint`n`nЭтап: $($Result.Stage)`nHRESULT: $($Result.HResult)`nPowerShell: $($Result.PowerShellVersion)`nРазрядность процесса: $($Result.ProcessBits) бит`n`nПередайте эти сведения для диагностики. Ключи, сертификаты и PIN проверка не изменяет."
}
