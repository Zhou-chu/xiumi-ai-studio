param([Parameter(Mandatory=$true)][string]$SandboxRoot)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\TestIsolation.ps1"
Assert-XiumiTestEnvironment $SandboxRoot
$proofRoot=Assert-XiumiTestPath (Join-Path $SandboxRoot 'state-proof') $SandboxRoot
$approved=Assert-XiumiTestPath (Join-Path $proofRoot 'approved') $SandboxRoot
$decoy=Assert-XiumiTestPath (Join-Path $proofRoot 'decoy') $SandboxRoot
$outside=Assert-XiumiTestPath (Join-Path $proofRoot 'outside-approved-root') $SandboxRoot
New-Item -ItemType Directory -Path $approved,$decoy,$outside | Out-Null
# Capture the actual source body under a deliberately different private Root.
$captured=& {
 . "$PSScriptRoot\..\..\deploy\desktop.ps1" -FunctionsOnly -Root $decoy
 if($Root -ne $decoy) {throw 'Capture scope did not hold the decoy Root'}
 (Get-Command Save-State).ScriptBlock
}
if($captured -isnot [scriptblock]) {throw 'Actual Save-State body was not captured'}
$Root=$decoy
Invoke-XiumiTestStateWrite -Root $approved -ApprovedRoot $approved -State @{pid=123;release='synthetic-proof'} -Body $captured
$statePath=Join-Path $approved 'state.json'
if(-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {throw 'Approved state file missing'}
$state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if($state.pid -ne 123 -or $state.release -cne 'synthetic-proof') {throw 'Actual state content differs'}
if(Test-Path -LiteralPath (Join-Path $approved 'state.tmp')) {throw 'Atomic temporary state remains'}
if(@(Get-ChildItem -LiteralPath $approved -Force).Count -ne 1) {throw 'Unexpected approved-root output'}
if(@(Get-ChildItem -LiteralPath $decoy -Force).Count) {throw 'Captured or caller decoy Root received a write'}
$script:forbiddenBodyRan=$false
$rejected=$false
try {
 Invoke-XiumiTestStateWrite -Root $outside -ApprovedRoot $approved -State @{pid=999} -Body {
  param($State)
  $script:forbiddenBodyRan=$true
  . $captured $State
 }
} catch { $rejected=$_.Exception.Message -eq 'Path escaped approved test root' }
if(-not $rejected -or $script:forbiddenBodyRan) {throw 'Outside-root body was not rejected before invocation'}
if(@(Get-ChildItem -LiteralPath $outside -Force).Count) {throw 'Outside-root output exists'}
$allState=@(Get-ChildItem -LiteralPath $SandboxRoot -Recurse -File -Filter 'state*')
if($allState.Count -ne 1 -or $allState[0].FullName -cne $statePath) {throw 'Unexpected state output in private sandbox'}
Write-Output ("Captured Save-State proof passed; sole state file: "+$statePath)
Write-Output 'Decoy/outside roots remained empty; body rejected before invocation; no Pester or deployment/process/network operation'
