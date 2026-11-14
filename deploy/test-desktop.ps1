$ErrorActionPreference = 'Stop'
foreach ($file in Get-ChildItem "$PSScriptRoot\*.ps1") {
  $tokens = $null; $errors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw ($errors | Out-String) }
}
$Root = Join-Path ([IO.Path]::GetTempPath()) ("xiumi-deploy-test-" + [Guid]::NewGuid().ToString('N'))
. "$PSScriptRoot\desktop.ps1" -FunctionsOnly -Root $Root
Assert-Sha ('a' * 40)
foreach ($bad in @('main','../data','--upload-pack=evil',('a'*39),('A'*40))) {
  $rejected = $false
  try { Assert-Sha $bad } catch { $rejected = $true }
  if (-not $rejected) { throw "Accepted invalid SHA: $bad" }
}
if (Test-OwnedProcess $null) { throw 'Null state owns a process' }
if (Test-OwnedProcess @{pid=$PID; started='not-this-process'}) { throw 'Stale PID owns a process' }
# Exercise the real built app on a distinct loopback port and disposable data.
New-Item -ItemType Directory -Force "$Root\logs","$Root\data" | Out-Null
Set-Content "$Root\data\preserve.txt" 'existing-user-data'
$before = @{}
foreach ($name in @('NODE_ENV','API_PORT','DATA_DIR')) { $before[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$running = $null
try {
  Assert-FreePort 5276
  $running = Start-App (Split-Path $PSScriptRoot -Parent) 5276 "$Root\data"
  if (-not (Test-OwnedProcess $running)) { throw 'Started process not recognized' }
  foreach ($name in $before.Keys) {
    if ([Environment]::GetEnvironmentVariable($name, 'Process') -cne $before[$name]) { throw "Environment leaked: $name" }
  }
  $rejected = $false
  try { Assert-FreePort 5276 } catch { $rejected = $true }
  if (-not $rejected) { throw 'Occupied port was accepted' }
  $running.previous = $null
  Save-State $running
  $roundTrip = Get-Content "$Root\state.json" -Raw | ConvertFrom-Json
  if (-not (Test-OwnedProcess $roundTrip)) { throw 'State round trip lost process ownership' }
  $roundTrip.started = [DateTime]::Parse($running.started, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  if (-not (Test-OwnedProcess $roundTrip)) { throw 'DateTime state lost process ownership' }
  Stop-OwnedProcess $running
  if (Test-OwnedProcess $running) { throw 'Process was not stopped' }
  Assert-FreePort 5276
  if ((Get-Content "$Root\data\preserve.txt").Trim() -ne 'existing-user-data') { throw 'User data was changed' }
  $running = Start-App (Split-Path $PSScriptRoot -Parent) 5276 "$Root\data"
  Save-StartedState $running
} finally { if ($running) { Stop-OwnedProcess $running } }
# Test data is intentionally retained under TEMP for failure diagnosis.
# CI approval and state-write failure cases live in the scoped Pester suite.
Write-Output 'Desktop deployment guard tests passed'
