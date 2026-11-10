$ErrorActionPreference = 'Stop'
foreach ($file in Get-ChildItem "$PSScriptRoot\*.ps1") {
  $tokens = $null; $errors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw ($errors | Out-String) }
}
. "$PSScriptRoot\desktop.ps1" -FunctionsOnly
Assert-Sha ('a' * 40)
foreach ($bad in @('main','../data','--upload-pack=evil',('a'*39),('A'*40))) {
  $rejected = $false
  try { Assert-Sha $bad } catch { $rejected = $true }
  if (-not $rejected) { throw "Accepted invalid SHA: $bad" }
}
if (Test-OwnedProcess $null) { throw 'Null state owns a process' }
if (Test-OwnedProcess @{pid=$PID; started='not-this-process'}) { throw 'Stale PID owns a process' }
# Mock external read boundaries. Never contacts GitHub or starts an application.
function git { $global:LASTEXITCODE = 0; return (('a'*40) + "`trefs/heads/main") }
$script:conclusion = 'failure'
function Invoke-RestMethod {
  return @{workflow_runs=@(@{head_sha=('a'*40);head_branch='main';event='push';run_number=1;status='completed';conclusion=$script:conclusion})}
}
$rejected = $false
try { Get-ApprovedHead } catch { $rejected = $true }
if (-not $rejected) { throw 'Failed CI was accepted' }
$script:conclusion = 'success'
if ((Get-ApprovedHead) -ne ('a'*40)) { throw 'Successful exact main SHA not accepted' }
function Invoke-RestMethod {
  return @{workflow_runs=@(@{head_sha=('b'*40);head_branch='main';event='push';run_number=1;status='completed';conclusion='success'})}
}
$rejected = $false
try { Get-ApprovedHead } catch { $rejected = $true }
if (-not $rejected) { throw 'CI for another commit was accepted' }
function Invoke-RestMethod {
  return @{workflow_runs=@(@{head_sha=('a'*40);head_branch='main';event='pull_request';run_number=1;status='completed';conclusion='success'})}
}
$rejected = $false
try { Get-ApprovedHead } catch { $rejected = $true }
if (-not $rejected) { throw 'Pull request CI was accepted for deployment' }
function Invoke-RestMethod { return @{workflow_runs=@()} }
$rejected = $false
try { Get-ApprovedHead } catch { $rejected = $true }
if (-not $rejected) { throw 'Missing CI was accepted' }
function Invoke-RestMethod {
  return @{workflow_runs=@(
    @{head_sha=('a'*40);head_branch='main';event='push';run_number=1;status='completed';conclusion='success'},
    @{head_sha=('a'*40);head_branch='main';event='push';run_number=2;status='in_progress';conclusion=$null}
  )}
}
$rejected = $false
try { Get-ApprovedHead } catch { $rejected = $true }
if (-not $rejected) { throw 'Older success bypassed the newest pending CI run' }
$script:stopped = $false
function Save-State { throw 'Simulated disk full' }
function Stop-OwnedProcess { $script:stopped = $true }
$rejected = $false
try { Save-StartedState @{pid=123} } catch { $rejected = $true }
if (-not $rejected -or -not $script:stopped) { throw 'Failed state persistence orphaned process' }
Write-Output 'Desktop deployment guard tests passed'
