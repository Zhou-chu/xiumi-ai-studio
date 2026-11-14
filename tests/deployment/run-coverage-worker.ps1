param([Parameter(Mandatory=$true)][string]$SandboxRoot, [switch]$IsolationOnly, [switch]$StateWriteProof, [switch]$NonSmokeOnly, [switch]$BoundaryOnly, [ValidateSet('None','WithoutCoverage','WithCoverage')][string]$ThrowDiagnostic='None')
$ErrorActionPreference='Stop'
. "$PSScriptRoot\TestIsolation.ps1"
Assert-XiumiTestEnvironment $SandboxRoot
if($IsolationOnly) { & "$PSScriptRoot\isolation-self-check.ps1" -SandboxRoot $SandboxRoot; exit 0 }
if($StateWriteProof) { & "$PSScriptRoot\state-write-proof.ps1" -SandboxRoot $SandboxRoot; exit 0 }
Import-Module Pester -RequiredVersion 3.4.0
if($ThrowDiagnostic -ne 'None') {
 $options=@{Script="$PSScriptRoot\ThrowDiagnostic.Tests.ps1";PassThru=$true}
 if($ThrowDiagnostic -eq 'WithCoverage') {$options.CodeCoverage="$PSScriptRoot\..\..\deploy\desktop.ps1"}
 $result=Invoke-Pester @options
 $module=Get-Module Pester
 $match=& $module {Get-DoMessagesMatch 'Invalid commit SHA' $null}
 $diagnosis=@{mode=$ThrowDiagnostic;ps=$PSVersionTable.PSVersion.ToString();passed=$result.PassedCount;failed=$result.FailedCount;bareNullContains='Invalid commit SHA'.Contains($null);typedStringNullContains='Invalid commit SHA'.Contains([string]$null);pesterMessageMatchNull=$match}
 $diagnosis | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $SandboxRoot 'throw-diagnostic.json') -Encoding UTF8
 $diagnosis | ConvertTo-Json | Write-Output
 Write-Output ("Diagnostic retained: "+$SandboxRoot)
 if($result.FailedCount -gt 0) {exit 1}; exit 0
}

$repo=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Output=Join-Path $SandboxRoot 'reports'
$boundaries=@('Start-Process','Stop-Process','Get-Process','Invoke-WebRequest','Invoke-RestMethod')
$before=@{}
foreach($name in $boundaries) {
 $command=Get-Command $name
 $before[$name]="$($command.CommandType)|$($command.ModuleName)|$($command.Definition)"
}
try {
 $selection=@{}
 if($NonSmokeOnly) {$selection['ExcludeTag']='smoke'}
 if($BoundaryOnly) {
  $result=Invoke-Pester -Script "$PSScriptRoot\BoundaryProof.Tests.ps1" -PassThru
 } else {
 $result=Invoke-Pester @selection -Script "$PSScriptRoot\Deployment.Tests.ps1" -CodeCoverage @("$repo\deploy\desktop.ps1","$repo\deploy\install-desktop.ps1") -PassThru
 }
} finally {
 foreach($name in $boundaries) {
  $command=Get-Command $name
  if("$($command.CommandType)|$($command.ModuleName)|$($command.Definition)" -cne $before[$name]) {
   throw "Pester leaked the command boundary: $name"
  }
 }
}
if($BoundaryOnly) {
 if($result.FailedCount -gt 0 -or $result.PassedCount -ne 3) {throw 'Private boundary proof failed or incomplete'}
 Write-Output 'Private Pester boundary subset passed; command identities restored; full deployment suite and smoke NOT run'
 exit 0
}
New-Item -ItemType Directory -Force $Output | Out-Null
$result.CodeCoverage | ConvertTo-Json -Depth 8 | Set-Content "$Output\coverage.json" -Encoding UTF8
$files=@($result.CodeCoverage.AnalyzedFiles | ForEach-Object {
 $file=$_;$hit=@($result.CodeCoverage.HitCommands | Where-Object File -eq $file).Count;$miss=@($result.CodeCoverage.MissedCommands | Where-Object File -eq $file).Count
 @{path=$file.Substring($repo.Length+1).Replace('\','/');sha256=(Get-FileHash $file -Algorithm SHA256).Hash.ToLower();commands=@{hit=$hit;total=$hit+$miss;percent=100*$hit/($hit+$miss)}}
})
@{framework='Pester 3.4.0';completeSuite=(-not $NonSmokeOnly);excludedTags=@(if($NonSmokeOnly){'smoke'});metric='AST command coverage';branchCoverage=$null;functionCoverage=$null;statementCoverage=$null;lineCoverage=$null;passed=$result.PassedCount;failed=$result.FailedCount;files=$files} | ConvertTo-Json -Depth 8 | Set-Content "$Output\summary.json" -Encoding UTF8
if($result.FailedCount -gt 0){throw "$($result.FailedCount) tests failed"}
$coverage=$result.CodeCoverage
if($coverage.NumberOfCommandsAnalyzed -eq 0 -or $coverage.NumberOfCommandsExecuted / $coverage.NumberOfCommandsAnalyzed -le .9){throw 'Full deployment command coverage must exceed 90%'}
