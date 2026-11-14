# Fail closed before loading either production file. No real OS/network action may escape.
function node { throw 'Blocked real node' }
function pnpm.cmd { throw 'Blocked real pnpm' }
function git { throw 'Blocked real git' }
function Start-Process { throw 'Blocked real process start' }
function Stop-Process { throw 'Blocked real process stop' }
function Get-Process { throw 'Blocked real process inspection' }
function Invoke-WebRequest { throw 'Blocked real HTTP' }
function Invoke-RestMethod { throw 'Blocked real HTTP' }
function Get-ScheduledTask { throw 'Blocked task access' }
function Register-ScheduledTask { throw 'Blocked task registration' }
function New-ScheduledTaskAction { param($Execute, $Argument) throw 'Blocked task action' }
function New-ScheduledTaskTrigger { throw 'Blocked task trigger' }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) throw 'Blocked task principal' }
function New-ScheduledTaskSettingsSet { throw 'Blocked task settings' }
. "$PSScriptRoot\..\..\deploy\desktop.ps1" -FunctionsOnly
. "$PSScriptRoot\..\..\deploy\install-desktop.ps1" -FunctionsOnly

Describe 'Deployment pure and process boundaries' {
 BeforeEach {
  $script:Root = Join-Path $TestDrive 'runtime'
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
  foreach($bad in @('main','../x',('A'*40),('a'*39))) { { Assert-Sha $bad } | Should Throw }
 }
 It 'checks native command exit code' {
  function Test-Native { $global:LASTEXITCODE=0 }
  Invoke-Checked Test-Native @()
  function Test-Native { $global:LASTEXITCODE=2 }
  { Invoke-Checked Test-Native @() } | Should Throw
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
  $script:process=New-Object PSObject
  $script:process | Add-Member ScriptMethod WaitForExit { param($ms) return $true }
  Mock Get-Process {$script:process}; Mock Stop-Process {}
  Stop-OwnedProcess @{pid=123}
  $script:process | Add-Member ScriptMethod WaitForExit { param($ms) return $false } -Force
  {Stop-OwnedProcess @{pid=123}} | Should Throw
  Assert-MockCalled Stop-Process -Times 2 -Exactly -Scope It
 }
 It 'writes and atomically replaces state only under TestDrive' {
  Save-State @{pid=1;release='fake'}
  ((Get-Content "$script:Root\state.json" -Raw | ConvertFrom-Json).pid) | Should Be 1
  Test-Path "$script:Root\state.tmp" | Should Be $false
 }
 It 'stops newly started process when saving its state fails' {
  Mock Save-State {throw 'disk full'}; Mock Stop-OwnedProcess {}
  {Save-StartedState @{pid=1}} | Should Throw
  Assert-MockCalled Stop-OwnedProcess -Times 1 -Scope It
 }
 It 'probes only a mocked listener and closes on success or failure' {
  $script:listener=New-Object PSObject -Property @{ExclusiveAddressUse=$false}
  $script:listener | Add-Member ScriptMethod Start {}
  $script:listener | Add-Member ScriptMethod Stop {$script:closed=$true}
  Mock New-Object {$script:listener} -ParameterFilter {$TypeName -like 'Net.Sockets.TcpListener*'}
  $script:closed=$false;Assert-FreePort 5555;$script:closed | Should Be $true
  $script:listener | Add-Member ScriptMethod Start {throw 'occupied'} -Force
  {Assert-FreePort 5555} | Should Throw
 }
 It 'restores environment and handles unhealthy start without real process activity' {
  $script:fake=New-Object PSObject -Property @{Id=123;StartTime=[datetime]::UtcNow;HasExited=$false}
  $script:fake | Add-Member ScriptMethod Refresh {}
  Mock Start-Process {$script:fake}; Mock Stop-OwnedProcess {}
  Mock Invoke-WebRequest {@{StatusCode=200;Content='[]'}}
  $before=$env:API_PORT;$env:API_PORT='original'
  try { (Start-App 'C:\fake' 5555 'C:\fake-data').pid | Should Be 123; $env:API_PORT | Should Be 'original' } finally {$env:API_PORT=$before}
  Mock Invoke-WebRequest {throw 'offline'}
  {Start-App 'C:\fake' 5555 'C:\fake-data'} | Should Throw
  $script:fake.HasExited=$true
  {Start-App 'C:\fake' 5555 'C:\fake-data'} | Should Throw
  Assert-MockCalled Stop-OwnedProcess -Times 2 -Exactly -Scope It
 }
 It 'checks exact latest successful main CI' {
  Mock git {$global:LASTEXITCODE=0; return (('a'*40)+"`trefs/heads/main")}
  Mock Invoke-RestMethod {@{workflow_runs=@(@{head_sha=('a'*40);head_branch='main';event='push';run_number=1;status='completed';conclusion='success'})}}
  Get-ApprovedHead | Should Be ('a'*40)
  Mock Invoke-RestMethod {@{workflow_runs=@()}}
  {Get-ApprovedHead} | Should Throw
  Mock git {$global:LASTEXITCODE=1}
  {Get-ApprovedHead} | Should Throw
 }
}

Describe 'Deployment orchestration with isolated data and deny-by-default boundaries' {
 BeforeEach {
  $script:Root=Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
  $script:sha='a'*40;$script:release=Join-Path $script:Root "releases\$script:sha"
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
  {Invoke-DesktopDeployment -Root $script:Root} | Should Throw
  Mock node {$global:LASTEXITCODE=0;'v24.0.0'}
  Mock pnpm.cmd {$global:LASTEXITCODE=0;'old'}
  {Invoke-DesktopDeployment -Root $script:Root} | Should Throw
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
  {Invoke-DesktopDeployment -Root $script:Root -Rollback} | Should Throw
  @{pid=12;release='old';previous='missing'} | ConvertTo-Json | Set-Content "$script:Root\state.json"
  {Invoke-DesktopDeployment -Root $script:Root -Rollback} | Should Throw
 }
 It 'restores old release if switching or saving new state fails' {
  @{pid=12;started='fake';release='old';previous='older'} | ConvertTo-Json | Set-Content "$script:Root\state.json"
  Set-Content "$script:release\.ready" 'ready'
  Mock Save-State {if($State.release -eq $script:release){throw 'disk failure'}}
  {Invoke-DesktopDeployment -Root $script:Root} | Should Throw
  Assert-MockCalled Stop-OwnedProcess -Times 2 -Exactly -Scope It
  Assert-MockCalled Start-App -Times 2 -Exactly -Scope It
 }
}

Describe 'Installer plan without any real task registration' {
 BeforeEach {
  $script:Root=Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
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
  {Install-DesktopDeployment -Root $script:Root} | Should Throw
  Test-Path "$script:Root\desktop.ps1" | Should Be $false
  Assert-MockCalled Register-ScheduledTask -Times 0 -Exactly -Scope It
 }
}

Describe 'Existing smoke-script contract under mocked OS boundaries' {
 It 'runs the unchanged smoke script without starting, stopping or binding a real process or port' {
  $global:XiumiSmokeRunning=$false
  $global:XiumiSmokeProcess=New-Object PSObject -Property @{Id=12345;StartTime=[datetime]::UtcNow;ProcessName='node';HasExited=$false}
  $global:XiumiSmokeProcess | Add-Member ScriptMethod Refresh {}
  $global:XiumiSmokeProcess | Add-Member ScriptMethod WaitForExit {param($ms) return $true}
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
