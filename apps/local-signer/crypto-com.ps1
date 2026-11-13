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

# SignCades accepts a VARIANT signer. Force VT_DISPATCH rather than letting
# .NET round-trip an incoming IDispatch as VT_UNKNOWN (E_NOINTERFACE).
# PSObject.BaseObject unwraps PowerShell metadata, without COM GetType().
function ConvertTo-SignerDispatchArgument {
 param([Parameter(Mandatory=$true)][object]$Value)
 return ,([Runtime.InteropServices.DispatchWrapper]::new($Value.PSObject.BaseObject))
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


# Log metadata only. Exception messages, stack traces and source lines may
# contain credentials, certificate identities or the signing payload.
function Get-SignerFailureDiagnostic {
 param([Management.Automation.ErrorRecord]$Failure,[string]$Stage)
 if($Stage -cnotmatch '^[A-Z_]{1,48}$'){$Stage='UNKNOWN'}
 $exception=$Failure.Exception
 while($null -ne $exception.InnerException){$exception=$exception.InnerException}
 $hresult=$exception.HResult.ToString('X8')
 $line=0
 if($null -ne $Failure.InvocationInfo){$line=[int]$Failure.InvocationInfo.ScriptLineNumber}
 return ('SIGNER_UNAVAILABLE STAGE='+$Stage+' HRESULT=0x'+$hresult+' LINE='+$line)
}
