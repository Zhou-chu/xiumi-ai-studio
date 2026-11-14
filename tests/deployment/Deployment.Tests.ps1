. "$PSScriptRoot\TestIsolation.ps1"
Assert-XiumiTestEnvironment $env:XIUMI_TEST_SANDBOX
foreach($boundarySuite in @('non-smoke','smoke')) {
Describe ("Deployment boundaries: "+$boundarySuite) -Tags $boundarySuite {
# Fail closed before loading either production file. No real OS/network action may escape.
function node { throw 'Blocked real node' }
function pnpm.cmd { throw 'Blocked real pnpm' }
function git { throw 'Blocked real git' }
Mock Start-Process { throw 'Blocked real process start' }
Mock Stop-Process { throw 'Blocked real process stop' }
Mock Get-Process { throw 'Blocked real process inspection' }
Mock Invoke-WebRequest { throw 'Blocked real HTTP' }
Mock Invoke-RestMethod { throw 'Blocked real HTTP' }
Mock New-Object { throw 'Blocked real TCP listener' } -ParameterFilter {$TypeName -like 'Net.Sockets.TcpListener*'}
function Get-ScheduledTask { throw 'Blocked task access' }
function Register-ScheduledTask { throw 'Blocked task registration' }
function New-ScheduledTaskAction { param($Execute, $Argument) throw 'Blocked task action' }
function New-ScheduledTaskTrigger { throw 'Blocked task trigger' }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) throw 'Blocked task principal' }
function New-ScheduledTaskSettingsSet { throw 'Blocked task settings' }
$script:Root=Assert-XiumiTestPath (Join-Path $TestDrive 'runtime') $env:XIUMI_TEST_SANDBOX
. "$PSScriptRoot\..\..\deploy\desktop.ps1" -FunctionsOnly -Root $script:Root
. "$PSScriptRoot\..\..\deploy\install-desktop.ps1" -FunctionsOnly -Root $script:Root
# Remove dot-source parameter locals; the checked writer remains a second guard.
Remove-Variable Root -Scope Local
$script:originalSaveState=(Get-Command Save-State).ScriptBlock
Mock Save-State { Invoke-XiumiTestStateWrite -Root $Root -State $State -Body $script:originalSaveState }

if($boundarySuite -eq 'non-smoke') {
Context 'Deployment pure and process boundaries' {
 BeforeEach {
  $script:Root = Join-Path $TestDrive 'runtime'
  $null=Assert-XiumiTestPath $script:Root $env:XIUMI_TEST_SANDBOX
  New-Item -ItemType Directory -Force $script:Root | Out-Null
  Mock Start-Process { throw 'No process start permitted' }
  Mock Stop-Process { throw 'No process stop permitted' }
  Mock Get-Process { throw 'No process inspection permitted' }
  Mock Invoke-WebRequest { throw 'No network permitted' }
  Mock Invoke-RestMethod { throw 'No network permitted' }
  Mock Start-Sleep {}
 }
 It 'validates full lowercase SHAs' {
  { Assert-Sha ('a'*40) } | Should Not Throw
  foreach($bad in @('main','../x',('A'*40),('a'*39))) { { Assert-Sha $bad } | Should Throw 'Invalid commit SHA' }
 }
 It 'checks native command exit code' {
  function Test-Native { $global:LASTEXITCODE=0 }
  Invoke-Checked Test-Native @()
  function Test-Native { $global:LASTEXITCODE=2 }
  { Invoke-Checked Test-Native @() } | Should Throw 'Test-Native exited with 2'
 }
 It 'requires matching node identity and exact start time' {
  Test-OwnedProcess $null | Should Be $false
  Mock Get-Process { $null }
  Test-OwnedProcess @{pid=123;started='bad'} | Should Be $false
  $script:started=[datetime]::UtcNow
  Mock Get-Process { @{ProcessName='node';StartTime=$script:started} }
  Test-OwnedProcess @{pid=123;started=$script:started.ToString('o')} | Should Be $true
  Test-OwnedProcess @{pid=123;started=$script:started} | Should Be $true
  Test-OwnedProcess @{pid=123;started='bad'} | Should Be $false
  Test-OwnedProcess @{pid=123;started=$script:started.AddMinutes(-1)} | Should Be $false
 }
 It 'only stops an owned process and reports failed termination' {
  Mock Test-OwnedProcess {$false}; Stop-OwnedProcess @{pid=123}
  Mock Test-OwnedProcess {$true}
  $script:process=New-Object System.Diagnostics.Process
  $script:process | Add-Member ScriptMethod WaitForExit { param($ms) return $true } -Force
  Mock Get-Process {$script:process}; Mock Stop-Process {}
  Stop-OwnedProcess @{pid=123}
  $script:process | Add-Member ScriptMethod WaitForExit { param($ms) return $false } -Force
  {Stop-OwnedProcess @{pid=123}} | Should Throw 'Owned process did not exit'
  Assert-MockCalled Stop-Process -Times 2 -Exactly -Scope It
 }
 It 'writes and atomically replaces state only under TestDrive' {
  Save-State @{pid=1;release='fake'}
  ((Get-Content "$script:Root\state.json" -Raw | ConvertFrom-Json).pid) | Should Be 1
  Test-Path "$script:Root\state.tmp" | Should Be $false
 }
 It 'stops newly started process when saving its state fails' {
  Mock Save-State {throw 'disk full'}; Mock Stop-OwnedProcess {}
  {Save-StartedState @{pid=1}} | Should Throw 'disk full'
  Assert-MockCalled Stop-OwnedProcess -Times 1 -Scope It
 }
 It 'probes only a mocked listener and closes on success or failure' {
  $script:listener=New-Object PSObject -Property @{ExclusiveAddressUse=$false}
  $script:listener | Add-Member ScriptMethod Start {}
  $script:listener | Add-Member ScriptMethod Stop {$script:closed=$true}
  Mock New-Object {$script:listener} -ParameterFilter {$TypeName -like 'Net.Sockets.TcpListener*'}
  $script:closed=$false;Assert-FreePort 5555;$script:closed | Should Be $true
  $script:listener | Add-Member ScriptMethod Start {throw 'occupied'} -Force
  {Assert-FreePort 5555} | Should Throw 'Cannot exclusively bind loopback port 5555; refusing deployment:'
 }
 It 'restores environment and handles unhealthy start without real process activity' {
  $script:fake=New-Object PSObject -Property @{Id=123;StartTime=[datetime]::UtcNow;HasExited=$false}
  $script:fake | Add-Member ScriptMethod Refresh {} -Force
  $fakeRelease=Assert-XiumiTestPath (Join-Path $script:Root 'fake-release') $env:XIUMI_TEST_SANDBOX
  $fakeData=Assert-XiumiTestPath (Join-Path $script:Root 'fake-data') $env:XIUMI_TEST_SANDBOX
  New-Item -ItemType Directory -Force $fakeRelease,$fakeData | Out-Null
  Mock Start-Process {
   foreach($path in @($WorkingDirectory,$RedirectStandardOutput,$RedirectStandardError,$env:DATA_DIR)) {
    $null=Assert-XiumiTestPath $path $env:XIUMI_TEST_SANDBOX
   }
   if($WindowStyle -ne 'Hidden') {throw 'Test process must request hidden window'}
   $script:lastErrorLog=$RedirectStandardError
   $script:fake
  }
  Mock Stop-OwnedProcess {}
  Mock Invoke-WebRequest {@{StatusCode=200;Content='[]'}}
  $before=$env:API_PORT;$env:API_PORT='original'
  try { (Start-App $fakeRelease 5555 $fakeData).pid | Should Be 123; $env:API_PORT | Should Be 'original' } finally {$env:API_PORT=$before}
  Mock Invoke-WebRequest {throw 'offline'}
  {Start-App $fakeRelease 5555 $fakeData} | Should Throw 'Health check failed on port 5555'
  $script:fake.HasExited=$true
  {Start-App $fakeRelease 5555 $fakeData} | Should Throw ('Application exited; inspect '+$script:lastErrorLog)
  Assert-MockCalled Stop-OwnedProcess -Times 2 -Exactly -Scope It
  Assert-MockCalled Start-Process -Times 3 -Exactly -Scope It
 }
 It 'checks exact latest successful main CI' {
  Mock git {$global:LASTEXITCODE=0; return (('a'*40)+"`trefs/heads/main")}
  Mock Invoke-RestMethod {@{workflow_runs=@(@{head_sha=('a'*40);head_branch='main';event='push';run_number=1;status='completed';conclusion='success'})}}
  Get-ApprovedHead | Should Be ('a'*40)
  Mock Invoke-RestMethod {@{workflow_runs=@()}}
  {Get-ApprovedHead} | Should Throw ('Main '+('a'*40)+' has no successful latest CI run; leaving current release untouched')
  Mock git {$global:LASTEXITCODE=1}
  {Get-ApprovedHead} | Should Throw 'Cannot read main'
 }
}

Context 'Deployment orchestration with isolated data and deny-by-default boundaries' {
 BeforeEach {
  $script:Root=Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
  $script:sha='a'*40;$script:release=Join-Path $script:Root "releases\$script:sha"
  $null=Assert-XiumiTestPath $script:release $env:XIUMI_TEST_SANDBOX
  New-Item -ItemType Directory -Force $script:release | Out-Null
  Mock node {$global:LASTEXITCODE=0;'v24.0.0'}
  Mock pnpm.cmd {$global:LASTEXITCODE=0;'11.23.0'}
  Mock Invoke-Checked {}
  Mock Assert-FreePort {}
  Mock Get-ApprovedHead {$script:sha}
  Mock Start-App { @{pid=123;started='fake';release=$Release} }
  Mock Stop-OwnedProcess {}
  Mock Test-OwnedProcess {$true}
 }
 It 'builds, smoke checks, starts and records a fresh release' {
  Invoke-DesktopDeployment -Root $script:Root
  Test-Path "$script:release\.ready" | Should Be $true
  $state=Get-Content "$script:Root\state.json" -Raw | ConvertFrom-Json
  $state.release | Should Be $script:release
  Assert-MockCalled Invoke-Checked -Times 6 -Exactly -Scope It
  Assert-MockCalled Start-App -Times 2 -Exactly -Scope It
 }
 It 'rejects incompatible tools before writing deployment state' {
  Mock node {$global:LASTEXITCODE=0;'v20.0.0'}
  {Invoke-DesktopDeployment -Root $script:Root} | Should Throw 'This deployment requires Node 24'
  Mock node {$global:LASTEXITCODE=0;'v24.0.0'}
  Mock pnpm.cmd {$global:LASTEXITCODE=0;'old'}
  {Invoke-DesktopDeployment -Root $script:Root} | Should Throw 'This deployment requires pnpm 11.23.0'
 }
 It 'skips when the temporary lock is held' {
  $lock=[IO.File]::Open("$script:Root\deploy.lock",'OpenOrCreate','ReadWrite','None')
  try {Invoke-DesktopDeployment -Root $script:Root} finally {$lock.Dispose()}
  Assert-MockCalled Get-ApprovedHead -Times 0 -Exactly -Scope It
 }
 It 'respects pause and restores known-good offline release first' {
  @{pid=12;started='fake';release='previous';previous='older'} | ConvertTo-Json | Set-Content "$script:Root\state.json"
  Set-Content "$script:Root\paused" 'paused'
  Mock Test-OwnedProcess {$false}
  Invoke-DesktopDeployment -Root $script:Root
  Assert-MockCalled Start-App -Times 1 -Exactly -Scope It
  Assert-MockCalled Get-ApprovedHead -Times 0 -Exactly -Scope It
 }
 It 'skips the currently served approved release' {
  @{pid=12;started='fake';release=$script:release;previous=$null} | ConvertTo-Json | Set-Content "$script:Root\state.json"
  Invoke-DesktopDeployment -Root $script:Root
  Assert-MockCalled Start-App -Times 0 -Exactly -Scope It
 }
 It 'rolls back without GitHub and pauses automatic updates' {
  $previous=Join-Path $script:Root 'previous';New-Item -ItemType Directory "$previous\dist" -Force | Out-Null;Set-Content "$previous\dist\index.html" 'ready'
  @{pid=12;started='fake';release='old';previous=$previous} | ConvertTo-Json | Set-Content "$script:Root\state.json"
  Invoke-DesktopDeployment -Root $script:Root -Rollback
  Test-Path "$script:Root\paused" | Should Be $true
  Assert-MockCalled Get-ApprovedHead -Times 0 -Exactly -Scope It
 }
 It 'refuses unavailable or incomplete rollback' {
  {Invoke-DesktopDeployment -Root $script:Root -Rollback} | Should Throw 'No previous release available'
  @{pid=12;release='old';previous='missing'} | ConvertTo-Json | Set-Content "$script:Root\state.json"
  {Invoke-DesktopDeployment -Root $script:Root -Rollback} | Should Throw 'Previous release is incomplete'
 }
 It 'restores old release if switching or saving new state fails' {
  @{pid=12;started='fake';release='old';previous='older'} | ConvertTo-Json | Set-Content "$script:Root\state.json"
  Set-Content "$script:release\.ready" 'ready'
  Mock Save-State {if($State.release -eq $script:release){throw 'disk failure'}}
  {Invoke-DesktopDeployment -Root $script:Root} | Should Throw 'disk failure'
  Assert-MockCalled Stop-OwnedProcess -Times 2 -Exactly -Scope It
  Assert-MockCalled Start-App -Times 2 -Exactly -Scope It
 }
}

Context 'Installer plan without any real task registration' {
 BeforeEach {
  $script:Root=Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
  $null=Assert-XiumiTestPath $script:Root $env:XIUMI_TEST_SANDBOX
  Mock Get-ScheduledTask {$null}
  Mock New-ScheduledTaskAction {@{kind='action'}}
  Mock New-ScheduledTaskTrigger {@{kind='trigger'}}
  Mock New-ScheduledTaskPrincipal {@{kind='principal'}}
  Mock New-ScheduledTaskSettingsSet {@{kind='settings'}}
  Mock Register-ScheduledTask {}
  Mock Get-DeploymentUser {'TEST\fake-user'}
 }
 It 'creates the fixed control script and limited user task specification' {
  Install-DesktopDeployment -Root $script:Root
  Test-Path "$script:Root\desktop.ps1" | Should Be $true
  Assert-MockCalled Register-ScheduledTask -Times 1 -Exactly -Scope It
  Assert-MockCalled New-ScheduledTaskPrincipal -Times 1 -Exactly -Scope It -ParameterFilter {$RunLevel -eq 'Limited' -and $LogonType -eq 'Interactive' -and $UserId -eq 'TEST\fake-user'}
  Assert-MockCalled New-ScheduledTaskAction -Times 1 -Exactly -Scope It -ParameterFilter {$Execute -eq 'powershell.exe' -and $Argument -match '-NonInteractive -WindowStyle Hidden' -and $Argument.Contains($script:Root)}
 }
 It 'refuses replacement of an existing task before copying files' {
  Mock Get-ScheduledTask {@{TaskName='existing'}}
  {Install-DesktopDeployment -Root $script:Root} | Should Throw 'XiumiStudio-CD already exists; inspect it before replacing it'
  Test-Path "$script:Root\desktop.ps1" | Should Be $false
  Assert-MockCalled Register-ScheduledTask -Times 0 -Exactly -Scope It
 }
}

Context 'Deny-by-default command boundaries use tracked scoped mocks' {
 It 'blocks unconfigured process and HTTP actions with recorded calls' {
  { Start-Process -FilePath 'Xiumi-do-not-execute-missing-command' } | Should Throw 'Blocked real process start'
  { Stop-Process -Id 2147483647 } | Should Throw 'Blocked real process stop'
  { Get-Process -Id $PID } | Should Throw 'Blocked real process inspection'
  { Invoke-WebRequest -Uri 'not-a-uri' } | Should Throw 'Blocked real HTTP'
  { Invoke-RestMethod -Uri 'not-a-uri' } | Should Throw 'Blocked real HTTP'
  { New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,5555) } | Should Throw 'Blocked real TCP listener'
  Assert-MockCalled New-Object -Times 1 -Exactly -Scope It -ParameterFilter {$TypeName -like 'Net.Sockets.TcpListener*'}
  foreach($command in @('Start-Process','Stop-Process','Get-Process','Invoke-WebRequest','Invoke-RestMethod')) {
   Assert-MockCalled $command -Times 1 -Exactly -Scope It
  }
 }
}

Context 'Exact latest main CI approval data contract' {
 BeforeEach {
  Mock git { $global:LASTEXITCODE=0; return (('a'*40)+"`trefs/heads/main") }
  Mock Invoke-RestMethod { return @{workflow_runs=$script:approvalRuns} }
 }
 It 'accepts only the latest successful main push and rejects every original smoke-script negative case' {
  $good=@{head_sha=('a'*40);head_branch='main';event='push';run_number=1;status='completed';conclusion='success'}
  $script:approvalRuns=@($good)
  Get-ApprovedHead | Should Be ('a'*40)
  $failed=$good.Clone();$failed.conclusion='failure'
  $wrongSha=$good.Clone();$wrongSha.head_sha='b'*40
  $pullRequest=$good.Clone();$pullRequest.event='pull_request'
  $pending=$good.Clone();$pending.run_number=2;$pending.status='in_progress';$pending.conclusion=$null
  foreach($runs in @(@($failed),@($wrongSha),@($pullRequest),@(),@($good,$pending))) {
   $script:approvalRuns=$runs
   {Get-ApprovedHead} | Should Throw 'no successful latest CI run'
  }
  Assert-MockCalled Invoke-RestMethod -Times 6 -Exactly -Scope It
  Assert-MockCalled git -Times 6 -Exactly -Scope It
 }
}

} else {
Context 'Existing smoke-script contract under mocked OS boundaries' {
 It 'runs the unchanged smoke script without starting, stopping or binding a real process or port' {
  $global:XiumiSmokeRunning=$false
  $global:XiumiSmokeProcess=New-Object System.Diagnostics.Process
  foreach($entry in @{Id=12345;StartTime=[datetime]::UtcNow;ProcessName='node';HasExited=$false}.GetEnumerator()) {
   $global:XiumiSmokeProcess | Add-Member NoteProperty $entry.Key $entry.Value -Force
  }
  $global:XiumiSmokeProcess | Add-Member ScriptMethod Refresh {} -Force
  $global:XiumiSmokeProcess | Add-Member ScriptMethod WaitForExit {param($ms) return $true} -Force
  $global:XiumiSmokeListener=New-Object PSObject -Property @{ExclusiveAddressUse=$false}
  $global:XiumiSmokeListener | Add-Member ScriptMethod Start {if($global:XiumiSmokeRunning){throw 'mock occupied port'}}
  $global:XiumiSmokeListener | Add-Member ScriptMethod Stop {}
  Mock New-Object {$global:XiumiSmokeListener} -ParameterFilter {$TypeName -like 'Net.Sockets.TcpListener*'}
  Mock Start-Process {$global:XiumiSmokeRunning=$true;$global:XiumiSmokeProcess}
  Mock Get-Process {if($global:XiumiSmokeRunning){$global:XiumiSmokeProcess}else{$null}}
  Mock Stop-Process {$global:XiumiSmokeRunning=$false}
  Mock Start-Sleep {}
  Mock Invoke-WebRequest {@{StatusCode=200;Content='[]'}}
  $output=& "$PSScriptRoot\..\..\deploy\test-desktop.ps1"
  ($output -join ' ') | Should Match 'Desktop deployment guard tests passed'
  $global:XiumiSmokeRunning | Should Be $false
 }
}


}
}
}
