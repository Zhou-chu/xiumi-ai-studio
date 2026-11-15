. "$PSScriptRoot\TestIsolation.ps1"
Assert-XiumiTestEnvironment $env:XIUMI_TEST_SANDBOX
. "$PSScriptRoot\..\..\deploy\desktop.ps1" -FunctionsOnly -Root (Join-Path $env:XIUMI_TEST_SANDBOX 'pure-function-only')
Describe 'Pure Assert-Sha throw diagnostic' {
 It 'returns normally for a valid full SHA' { Assert-Sha ('a'*40) }
 It 'directly catches the exact invalid SHA exception' {
  $caught=$null
  try { Assert-Sha 'main' } catch { $caught=$_.Exception.Message }
  $caught | Should Be 'Invalid commit SHA'
 }
 It 'asserts invalid SHA with the original message-free Should Throw' {
  { Assert-Sha 'main' } | Should Throw
 }
 It 'checks the same exception with an explicit message as a diagnostic control' {
  { Assert-Sha 'main' } | Should Throw 'Invalid commit SHA'
 }
}
