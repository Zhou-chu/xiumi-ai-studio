# Script intentionally ASCII so Windows PowerShell 5.1 and PowerShell Core parse it identically.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Candidate,
  [Parameter(Mandatory)][string]$SmokeRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows') {
  throw 'The isolated smoke is restricted to a disposable GitHub-hosted Windows job'
}

$tempRoot = (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path
$expectedCandidate = (Resolve-Path -LiteralPath (Join-Path $env:GITHUB_WORKSPACE 'candidate')).Path
$actualCandidate = (Resolve-Path -LiteralPath $Candidate).Path
if (![string]::Equals($expectedCandidate, $actualCandidate, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected candidate checkout' }
$smokePath = [IO.Path]::GetFullPath($SmokeRoot)
$smokeParent = [IO.Path]::GetDirectoryName($smokePath)
if (![string]::Equals($tempRoot, [IO.Path]::GetDirectoryName($smokeParent), [StringComparison]::OrdinalIgnoreCase) -or
  [IO.Path]::GetFileName($smokeParent) -cnotmatch '^xiumi-bootstrap-[a-f0-9]{32}$' -or
  [IO.Path]::GetFileName($smokePath) -cnotmatch '^(windowsPowerShell|powerShellCore)$' -or
  (Test-Path -LiteralPath $smokePath) -or
  ((Get-Item -LiteralPath $smokeParent).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Smoke data is not a fresh runner-local directory'
}
if ($env:XIUMI_SKIP_ENV_FILES -cne '1') { throw 'Smoke must not load configuration files' }
foreach ($name in @('XIUMI_DATA_DIR', 'XIUMI_RESOURCES', 'XIUMI_PACKAGED', 'AI_API_KEY', 'WECHAT_APPID', 'WECHAT_APPSECRET')) {
  if ($null -ne [Environment]::GetEnvironmentVariable($name, 'Process')) { throw 'Unexpected external application configuration' }
}

$null = New-Item -ItemType Directory -Path $smokePath
$data = Join-Path $smokePath 'data'
$null = New-Item -ItemType Directory -Path $data, (Join-Path $smokePath 'logs')
$sentinel = Join-Path $data 'preserve.bin'
[IO.File]::WriteAllBytes($sentinel, [byte[]]@(0, 9, 13, 10, 20, 127, 128, 255))
$beforeHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash
$beforeEnv = @{}
foreach ($name in @('NODE_ENV', 'API_PORT', 'DATA_DIR')) {
  $beforeEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

# Use the candidate's real Windows custody/health helpers, not the control entry point.
. (Join-Path $actualCandidate 'deploy/desktop.ps1') -FunctionsOnly -Root $smokePath
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
try {
  $probe.ExclusiveAddressUse = $true
  $probe.Start()
  $testPort = ([Net.IPEndPoint]$probe.LocalEndpoint).Port
} finally {
  $probe.Stop()
}

$running = $null
try {
  Assert-FreePort $testPort
  $running = Start-App $actualCandidate $testPort $data
  if (!(Test-OwnedProcess $running)) { throw 'Health check returned a process without verified PID/start time' }
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $testPort | Where-Object { $_.LocalAddress -eq '127.0.0.1' })
  if ($listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne $running.pid) { throw 'Loopback socket is not bound to the verified process' }
  foreach ($name in $beforeEnv.Keys) {
    if ([Environment]::GetEnvironmentVariable($name, 'Process') -cne $beforeEnv[$name]) { throw "Start-App leaked the $name setting" }
  }
  $busyRejected = $false
  try { Assert-FreePort $testPort } catch { $busyRejected = $true }
  if (!$busyRejected) { throw 'The occupied-port guard accepted the owned listener' }
  Save-StartedState $running
  $persisted = Get-Content -LiteralPath (Join-Path $smokePath 'state.json') -Raw | ConvertFrom-Json
  if ($persisted.pid -ne $running.pid -or !(Test-OwnedProcess $persisted)) { throw 'Local state round trip lost the owned process' }
} finally {
  if ($running) { Stop-OwnedProcess $running }
}
if (!$running -or (Test-OwnedProcess $running)) { throw 'The owned test process did not stop' }
Assert-FreePort $testPort
if ((Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -cne $beforeHash) { throw 'Disposable sentinel bytes changed' }
[ordered]@{
  shellEdition = $PSVersionTable.PSEdition
  shellVersion = $PSVersionTable.PSVersion.ToString()
  builtAssetsAndProjectsHealthy = $true
  processOwnershipAndStateRoundTrip = $true
  verifiedLoopbackListenerAndPortReleased = $true
  sentinelPreserved = $true
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $smokePath 'proof.json') -Encoding UTF8
Write-Host 'Native disposable application smoke passed: health, owned listener, state round trip, shutdown, sentinel.'
