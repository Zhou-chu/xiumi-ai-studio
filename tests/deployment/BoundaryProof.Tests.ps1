. "$PSScriptRoot\TestIsolation.ps1"
Assert-XiumiTestEnvironment $env:XIUMI_TEST_SANDBOX
Describe 'Private Pester command and state boundary proof only' {
 Mock Start-Process {throw 'Blocked process start'}
 Mock Stop-Process {throw 'Blocked process stop'}
 Mock Get-Process {throw 'Blocked process inspection'}
 Mock Invoke-WebRequest {throw 'Blocked HTTP request'}
 Mock Invoke-RestMethod {throw 'Blocked REST request'}
 $script:approved=Assert-XiumiTestPath (Join-Path $TestDrive 'approved') $env:XIUMI_TEST_SANDBOX
 $script:decoy=Assert-XiumiTestPath (Join-Path $TestDrive 'decoy') $env:XIUMI_TEST_SANDBOX
 $script:outside=Assert-XiumiTestPath (Join-Path $TestDrive 'outside-approved') $env:XIUMI_TEST_SANDBOX
 New-Item -ItemType Directory -Path $script:approved,$script:decoy,$script:outside | Out-Null
 . "$PSScriptRoot\..\..\deploy\desktop.ps1" -FunctionsOnly -Root $script:decoy
 $script:actualBody=(Get-Command Save-State).ScriptBlock
 $Root=$script:approved
 Mock Save-State {Invoke-XiumiTestStateWrite -Root $Root -ApprovedRoot $script:approved -State $State -Body $script:actualBody}
 It 'blocks all five commands inside a same-worker child script with exact mock counts' {
  $messages=@{'Start-Process'='Blocked process start';'Stop-Process'='Blocked process stop';'Get-Process'='Blocked process inspection';'Invoke-WebRequest'='Blocked HTTP request';'Invoke-RestMethod'='Blocked REST request'}
  foreach($name in $messages.Keys) {
   { & "$PSScriptRoot\boundary-child.ps1" -CommandName $name } | Should Throw $messages[$name]
   Assert-MockCalled $name -Times 1 -Exactly -Scope It
  }
 }
 It 'routes the actual captured state body through the checked Pester mock into TestDrive only' {
  Save-State @{pid=123;release='pester-proof'}
  $saved=Get-Content -LiteralPath (Join-Path $script:approved 'state.json') -Raw | ConvertFrom-Json
  $saved.pid | Should Be 123
  $saved.release | Should Be 'pester-proof'
  Test-Path -LiteralPath (Join-Path $script:approved 'state.tmp') | Should Be $false
  @(Get-ChildItem -LiteralPath $script:approved -Force).Count | Should Be 1
  @(Get-ChildItem -LiteralPath $script:decoy -Force).Count | Should Be 0
  Assert-MockCalled Save-State -Times 1 -Exactly -Scope It
 }
 It 'rejects a private sibling outside the approved root before the state body runs' {
  $script:forbiddenBodyRan=$false
  Mock Save-State {
   Invoke-XiumiTestStateWrite -Root $script:outside -ApprovedRoot $script:approved -State $State -Body {
    param($State)
    $script:forbiddenBodyRan=$true
    . $script:actualBody $State
   }
  }
  { Save-State @{pid=999} } | Should Throw 'Path escaped approved test root'
  $script:forbiddenBodyRan | Should Be $false
  @(Get-ChildItem -LiteralPath $script:outside -Force).Count | Should Be 0
  Assert-MockCalled Save-State -Times 1 -Exactly -Scope It
 }
}
