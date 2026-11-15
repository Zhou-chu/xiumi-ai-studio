param(
  [string]$Root = "$env:LOCALAPPDATA\XiumiStudio",
  [ValidateRange(1024,65535)][int]$Port = 5174,
  [switch]$Rollback,
  [switch]$FunctionsOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repository = 'https://github.com/Zhou-chu/xiumi-ai-studio.git'

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Exe exited with $LASTEXITCODE" }
}
function Assert-Sha([string]$Sha) {
  if ($Sha -cnotmatch '^[a-f0-9]{40}$') { throw 'Invalid commit SHA' }
}
function Test-OwnedProcess($State) {
  if (-not $State -or -not $State.pid) { return $false }
  $p = Get-Process -Id $State.pid -ErrorAction SilentlyContinue
  if (-not $p) { return $false }
  try {
    # PowerShell 7.5+ ConvertFrom-Json materializes ISO dates as DateTime.
    $started = if ($State.started -is [DateTime]) { $State.started } else {
      [DateTime]::ParseExact($State.started, 'o', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
    }
    return $p.ProcessName -eq 'node' -and $p.StartTime.ToUniversalTime().Ticks -eq $started.ToUniversalTime().Ticks
  } catch { return $false }
}
function Stop-OwnedProcess($State) {
  if (Test-OwnedProcess $State) {
    $p = Get-Process -Id $State.pid -ErrorAction Stop
    Stop-Process -InputObject $p -ErrorAction Stop
    if (-not $p.WaitForExit(10000)) { throw 'Owned process did not exit' }
  }
}
function Save-State($State) {
  $State | ConvertTo-Json | Set-Content -Encoding UTF8 "$Root\state.tmp"
  Move-Item -LiteralPath "$Root\state.tmp" -Destination "$Root\state.json" -Force
}
function Save-StartedState($State) {
  try { Save-State $State } catch { Stop-OwnedProcess $State; throw }
}
function Start-App([string]$Release, [int]$ListenPort, [string]$DataPath) {
  $savedEnv = @{}
  foreach ($name in @('NODE_ENV','API_PORT','DATA_DIR')) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  $log = Join-Path $Root "logs\$([IO.Path]::GetFileName($Release))-$ListenPort"
  try {
    $env:NODE_ENV = 'production'
    $env:API_PORT = "$ListenPort"
    $env:DATA_DIR = $DataPath
    $p = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('--import','tsx','server/index.ts') -WorkingDirectory $Release -WindowStyle Hidden -PassThru -RedirectStandardOutput "$log.out.log" -RedirectStandardError "$log.err.log"
  } finally {
    foreach ($name in $savedEnv.Keys) { $value = if ($null -eq $savedEnv[$name]) { [NullString]::Value } else { $savedEnv[$name] }; [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
  }
  $state = @{ pid=$p.Id; started=$p.StartTime.ToUniversalTime().ToString('o'); release=$Release }
  try {
    for ($i=0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 500
      $p.Refresh()
      if ($p.HasExited) { throw "Application exited; inspect $log.err.log" }
      try {
        $response = Invoke-WebRequest "http://127.0.0.1:$ListenPort/api/projects" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
          $null = $response.Content | ConvertFrom-Json
          $null = Invoke-WebRequest "http://127.0.0.1:$ListenPort/" -UseBasicParsing -TimeoutSec 2
          return $state
        }
      } catch { }
    }
    throw "Health check failed on port $ListenPort"
  } catch { Stop-OwnedProcess $state; throw }
}
function Assert-FreePort([int]$ListenPort) {
  # CIM TCP State can be missing on some Windows hosts. Probe the actual
  # loopback bind instead, and fail closed on any socket or permission error.
  $probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $ListenPort)
  try {
    $probe.ExclusiveAddressUse = $true
    $probe.Start()
  } catch {
    throw "Cannot exclusively bind loopback port ${ListenPort}; refusing deployment: $($_.Exception.Message)"
  } finally {
    $probe.Stop()
  }
}
function Get-ApprovedHead {
  $lines = & git ls-remote $Repository refs/heads/main
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read main' }
  $sha = ($lines -split '\s+')[0]
  Assert-Sha $sha
  $headers = @{ Accept='application/vnd.github+json'; 'User-Agent'='xiumi-desktop-cd' }
  $url = "https://api.github.com/repos/Zhou-chu/xiumi-ai-studio/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=$sha&per_page=10"
  $runs = Invoke-RestMethod $url -Headers $headers -TimeoutSec 30
  $matching = @($runs.workflow_runs | Where-Object { $_.head_sha -eq $sha -and $_.head_branch -eq 'main' -and $_.event -eq 'push' } | Sort-Object run_number -Descending)
  $run = if ($matching.Count) { $matching[0] } else { $null }
  if (-not $run -or $run.status -ne 'completed' -or $run.conclusion -ne 'success') {
    throw "Main $sha has no successful latest CI run; leaving current release untouched"
  }
  return $sha
}
function Invoke-DesktopDeployment {
  param([string]$Root, [int]$Port = 5174, [switch]$Rollback)
$version = & node --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') { throw 'This deployment requires Node 24' }
$pnpmVersion = & pnpm.cmd --version
if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne '11.23.0') { throw 'This deployment requires pnpm 11.23.0' }
$Root = [IO.Path]::GetFullPath($Root)
New-Item -ItemType Directory -Force $Root,"$Root\releases","$Root\data","$Root\logs","$Root\smoke" | Out-Null
$lock = $null
try {
  $lock = [IO.File]::Open("$Root\deploy.lock",'OpenOrCreate','ReadWrite','None')
} catch { Write-Output 'Another deploy is running; skipped'; return }
try {
  $old = $null
  if (Test-Path "$Root\state.json") { $old = Get-Content "$Root\state.json" -Raw | ConvertFrom-Json }
  # Restore the last known-good local release even when GitHub is unavailable.
  if (-not $Rollback -and $old -and -not (Test-OwnedProcess $old)) {
    Assert-FreePort $Port
    $restored = Start-App $old.release $Port "$Root\data"
    $restored.previous = $old.previous
    Save-StartedState $restored
    $old = [pscustomobject]$restored
  }
  if (-not $Rollback -and (Test-Path "$Root\paused")) { Write-Output "CD paused"; return }
  if ($Rollback) {
    if (-not $old -or -not $old.previous) { throw 'No previous release available' }
    $release = $old.previous
    if (-not (Test-Path "$release\dist\index.html")) { throw 'Previous release is incomplete' }
  } else {
    $sha = Get-ApprovedHead
    $release = Join-Path "$Root\releases" $sha
    if ($old -and $old.release -eq $release -and (Test-OwnedProcess $old)) {
      Write-Output "Already serving $sha on 127.0.0.1:$Port"; return
    }
    if (-not (Test-Path "$release\.ready")) {
      if (-not (Test-Path "$release\.git")) { Invoke-Checked 'git' @('clone','--no-checkout',$Repository,$release) }
      $validationEnv = @{}
      foreach ($name in @('API_PORT','DATA_DIR')) { $validationEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
      Push-Location $release
      try {
        Invoke-Checked 'git' @('fetch','origin',$sha)
        Invoke-Checked 'git' @('checkout','--detach',$sha)
        Invoke-Checked 'pnpm.cmd' @('install','--frozen-lockfile')
        $env:DATA_DIR = "$Root\smoke\$sha-check"
        $env:API_PORT = '5275'
        Invoke-Checked 'pnpm.cmd' @('check')
        Invoke-Checked 'pnpm.cmd' @('build')
        # Smoke data is separate from production and retained for diagnosis.
        Assert-FreePort 5275
        $smoke = Start-App $release 5275 "$Root\smoke\$sha"
        Stop-OwnedProcess $smoke
        Set-Content "$release\.ready" $sha
      } finally {
        Pop-Location
        foreach ($name in $validationEnv.Keys) { $value = if ($null -eq $validationEnv[$name]) { [NullString]::Value } else { $validationEnv[$name] }; [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
      }
    }
  }
  if ($old) { Stop-OwnedProcess $old }
  $next = $null
  try {
    Assert-FreePort $Port
    $next = Start-App $release $Port "$Root\data"
    $next.previous = if ($old) { $old.release } else { $null }
    Save-State $next
    if ($Rollback) { Set-Content "$Root\paused" "Manual rollback: remove this file to resume CD" }
    Write-Output "Serving $release on http://127.0.0.1:$Port"
  } catch {
    $failure = $_
    if ($next) { Stop-OwnedProcess $next }
    if ($old) {
      Assert-FreePort $Port
      $restored = Start-App $old.release $Port "$Root\data"
      $restored.previous = $old.previous
      Save-StartedState $restored
    }
    throw $failure
  }
} finally {
  $lock.Dispose()
}
}
if (-not $FunctionsOnly) { Invoke-DesktopDeployment -Root $Root -Port $Port -Rollback:$Rollback }
