param([string]$Output = "$PSScriptRoot\..\..\coverage-deployment", [switch]$IsolationOnly, [switch]$StateWriteProof, [switch]$NonSmokeOnly, [switch]$SmokeOnly, [switch]$BoundaryOnly, [ValidateSet('None','WithoutCoverage','WithCoverage')][string]$ThrowDiagnostic='None')
$ErrorActionPreference='Stop'
if($SmokeOnly -and ($IsolationOnly -or $StateWriteProof -or $NonSmokeOnly -or $BoundaryOnly -or $ThrowDiagnostic -ne 'None')) {throw 'Select one test mode'}
if($ThrowDiagnostic -ne 'None' -and ($IsolationOnly -or $StateWriteProof -or $NonSmokeOnly -or $BoundaryOnly)) {throw 'Select one test mode'}
if(($BoundaryOnly -and ($IsolationOnly -or $StateWriteProof -or $NonSmokeOnly)) -or ($IsolationOnly -and $StateWriteProof) -or ($NonSmokeOnly -and ($IsolationOnly -or $StateWriteProof))) {throw 'Select one test mode'}
. "$PSScriptRoot\TestIsolation.ps1"
$repo=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Output=Assert-XiumiTestPath $Output $repo
if ([IO.Path]::GetFileName($Output) -notlike 'coverage-*') { throw 'Reports require an isolated coverage-* directory' }
# A fresh private directory, never the application's deployment directory.
$sandbox=Join-Path ([IO.Path]::GetTempPath()) ('xiumi-pester-'+[guid]::NewGuid().ToString('N'))
$null=Assert-XiumiTestPath $sandbox ([IO.Path]::GetTempPath())
New-Item -ItemType Directory -Path $sandbox -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Path "$sandbox\appdata","$sandbox\tmp" | Out-Null
$before=@{}
foreach($name in @('LOCALAPPDATA','TEMP','TMP','XIUMI_TEST_SANDBOX')) { $before[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
try {
 $env:LOCALAPPDATA=Join-Path $sandbox 'appdata'; $env:TEMP=Join-Path $sandbox 'tmp'; $env:TMP=$env:TEMP; $env:XIUMI_TEST_SANDBOX=$sandbox
 $engine=if($PSVersionTable.PSEdition -eq 'Core') {Join-Path $PSHOME 'pwsh.exe'} else {Join-Path $PSHOME 'powershell.exe'}
 $workerArgs=@('-NoProfile','-NonInteractive','-File',"$PSScriptRoot\run-coverage-worker.ps1",'-SandboxRoot',$sandbox)
 if($IsolationOnly) {$workerArgs+='-IsolationOnly'}
 if($StateWriteProof) {$workerArgs+='-StateWriteProof'}
 if($NonSmokeOnly) {$workerArgs+='-NonSmokeOnly'}
 if($SmokeOnly) {$workerArgs+='-SmokeOnly'}
 if($BoundaryOnly) {$workerArgs+='-BoundaryOnly'}
 if($ThrowDiagnostic -ne 'None') {$workerArgs+=@('-ThrowDiagnostic',$ThrowDiagnostic)}
 & $engine @workerArgs
 $workerExit=$LASTEXITCODE
} finally {
 foreach($name in $before.Keys) { $value=if($null -eq $before[$name]) {[NullString]::Value} else {$before[$name]}; [Environment]::SetEnvironmentVariable($name,$value,'Process') }
}
# Retain the sandbox for diagnosis. Never recursively delete a computed path.
if(Test-Path "$sandbox\reports") {
 New-Item -ItemType Directory -Force $Output | Out-Null
 Copy-Item -LiteralPath "$sandbox\reports\coverage.json","$sandbox\reports\summary.json" -Destination $Output
}
if($workerExit -ne 0) {throw "Isolated deployment test worker failed: $workerExit; evidence: $sandbox"}
