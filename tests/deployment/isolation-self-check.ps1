param([Parameter(Mandatory=$true)][string]$SandboxRoot)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\TestIsolation.ps1"
Assert-XiumiTestEnvironment $SandboxRoot
# FunctionsOnly does not invoke deployment, processes or network IO.
& {
 . "$PSScriptRoot\..\..\deploy\desktop.ps1" -FunctionsOnly
 $null=Assert-XiumiTestPath $Root $SandboxRoot
 if($Root -ne (Join-Path $env:LOCALAPPDATA 'XiumiStudio')) {throw 'Default Root did not use private LOCALAPPDATA'}
}
& {
 $explicit=Join-Path $SandboxRoot 'explicit'
 . "$PSScriptRoot\..\..\deploy\desktop.ps1" -FunctionsOnly -Root $explicit
 if($Root -ne $explicit) {throw 'Explicit Root changed'}
 $null=Assert-XiumiTestPath $Root $SandboxRoot
}
$script:bodyRan=$false
Invoke-XiumiTestStateWrite -Root (Join-Path $SandboxRoot 'approved') -State @{pid=1} -Body {param($State) $script:bodyRan=$true}
if(-not $script:bodyRan) {throw 'Approved body did not execute'}
$script:bodyRan=$false
$outside=Join-Path ([IO.Path]::GetDirectoryName($SandboxRoot)) 'not-an-approved-test-root'
$rejected=$false
try { Invoke-XiumiTestStateWrite -Root $outside -State @{pid=1} -Body {param($State) $script:bodyRan=$true} } catch { $rejected=$_.Exception.Message -eq 'Path escaped approved test root' }
if(-not $rejected -or $script:bodyRan) {throw 'Shadowed or escaped Root reached write body'}
Write-Output 'Default, explicit and shadowed Root isolation self-check passed; no state IO or process/network action performed'
