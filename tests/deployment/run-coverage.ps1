param([string]$Output = "$PSScriptRoot\..\..\coverage-deployment")
$ErrorActionPreference='Stop'
Import-Module Pester -RequiredVersion 3.4.0
$repo=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$result=Invoke-Pester -Script "$PSScriptRoot\Deployment.Tests.ps1" -CodeCoverage @("$repo\deploy\desktop.ps1","$repo\deploy\install-desktop.ps1") -PassThru
New-Item -ItemType Directory -Force $Output | Out-Null
$result.CodeCoverage | ConvertTo-Json -Depth 8 | Set-Content "$Output\coverage.json" -Encoding UTF8
$files=@($result.CodeCoverage.AnalyzedFiles | ForEach-Object {
 $file=$_;$hit=@($result.CodeCoverage.HitCommands | Where-Object File -eq $file).Count;$miss=@($result.CodeCoverage.MissedCommands | Where-Object File -eq $file).Count
 @{path=$file.Substring($repo.Length+1).Replace('\','/');sha256=(Get-FileHash $file -Algorithm SHA256).Hash.ToLower();commands=@{hit=$hit;total=$hit+$miss;percent=100*$hit/($hit+$miss)}}
})
@{framework='Pester 3.4.0';metric='AST command coverage';branchCoverage=$null;functionCoverage=$null;statementCoverage=$null;lineCoverage=$null;passed=$result.PassedCount;failed=$result.FailedCount;files=$files} | ConvertTo-Json -Depth 8 | Set-Content "$Output\summary.json" -Encoding UTF8
if($result.FailedCount -gt 0){throw "$($result.FailedCount) tests failed"}
$coverage=$result.CodeCoverage
if($coverage.NumberOfCommandsAnalyzed -eq 0 -or $coverage.NumberOfCommandsExecuted / $coverage.NumberOfCommandsAnalyzed -le .9){throw 'Full deployment command coverage must exceed 90%'}
