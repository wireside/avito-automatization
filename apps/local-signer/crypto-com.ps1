# Use IDispatch directly: PowerShell 5.1's dynamic COM binder can fail in
# GetTypeAttrForTypeInfo before invoking a CAdESCOM member (0x80004003).
# Do not obtain this type from $Object.GetType(): that also enters the binder.
function Get-SignerComDispatchType {
 return [type]::GetTypeFromProgID('CAdESCOM.Store')
}

function Invoke-SignerComMember {
 param(
  [object]$Object,
  [string]$Name,
  [Reflection.BindingFlags]$Flags,
  [object[]]$Arguments=@()
 )
 $dispatchType=Get-SignerComDispatchType
 # Preserve COM collections as a single object; never enumerate their contents
 # through PowerShell's pipeline or convert payloads/booleans/numeric arguments.
 return ,($dispatchType.InvokeMember($Name,$Flags,$null,$Object,$Arguments))
}

function Invoke-SignerComMethod {
 param([object]$Object,[string]$Name,[object[]]$Arguments=@())
 return ,(Invoke-SignerComMember $Object $Name ([Reflection.BindingFlags]::InvokeMethod) $Arguments)
}

function Get-SignerComProperty {
 param([object]$Object,[string]$Name,[object[]]$Arguments=@())
 return ,(Invoke-SignerComMember $Object $Name ([Reflection.BindingFlags]::GetProperty) $Arguments)
}

function Set-SignerComProperty {
 param([object]$Object,[string]$Name,[object]$Value)
 $null=Invoke-SignerComMember $Object $Name ([Reflection.BindingFlags]::SetProperty) (,$Value)
}
