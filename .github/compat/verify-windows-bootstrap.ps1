# GitHub-hosted Windows test only. Never uses the scheduled task or production data.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedSha,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedTree,
  [switch]$WarmRepeat
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows') {
  throw 'This recipe is restricted to a disposable GitHub-hosted Windows job'
}
if ($ExpectedSha -cnotmatch '^[a-f0-9]{40}$') { throw 'Expected one lowercase 40-character commit SHA' }
if ($ExpectedTree -cnotmatch '^[a-f0-9]{40}$') { throw 'Expected one lowercase 40-character tree SHA' }

$workspace = (Resolve-Path -LiteralPath $env:GITHUB_WORKSPACE).Path
$candidate = Join-Path $workspace 'candidate'
$reportDir = Join-Path $workspace 'windows-bootstrap-evidence'
if (!(Test-Path -LiteralPath (Join-Path $candidate '.git') -PathType Container)) { throw 'Missing separate candidate checkout' }
if (Test-Path -LiteralPath $reportDir) { throw 'Unexpected existing evidence path' }
$null = New-Item -ItemType Directory -Path $reportDir
$summary = [ordered]@{ expectedSha = $ExpectedSha; expectedTree = $ExpectedTree; outcome = 'failure'; stage = 'source' }

function Read-Version($Output, [string]$Pattern, [string]$Name) {
  $matchesFound = @($Output | ForEach-Object { "$_".Trim() } | Where-Object { $_ -cmatch $Pattern })
  if ($matchesFound.Count -ne 1) { throw "Did not observe exactly one $Name version" }
  return $matchesFound[0]
}

function Resolve-FirstApplication([string]$Name) {
  # Windows can return several ApplicationInfo entries for one PATH lookup.
  $commands = @(Get-Command -Name $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1)
  if ($commands.Count -ne 1) { throw "Could not resolve one PATH application: $Name" }
  $path = $commands[0].Source
  if ($path -isnot [string] -or ![IO.Path]::IsPathRooted($path) -or !(Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "PATH application did not resolve to one existing file: $Name"
  }
  return $path
}

function Invoke-Native([string]$FileName, [string[]]$Arguments) {
  & $FileName @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($FileName)) exited with code $LASTEXITCODE" }
}

try {
  $actual = & git.exe -C $candidate rev-parse HEAD
  if ($LASTEXITCODE -ne 0 -or $actual -cne $ExpectedSha) { throw 'Candidate checkout does not match the immutable source pin' }
  $summary.sourceSha = $actual
  $tree = & git.exe -C $candidate rev-parse 'HEAD^{tree}'
  if ($LASTEXITCODE -ne 0 -or $tree -cne $ExpectedTree) { throw 'Candidate checkout does not match the immutable tree pin' }
  $summary.sourceTree = $tree
  $refName = & git.exe -C $candidate rev-parse --abbrev-ref HEAD
  if ($LASTEXITCODE -ne 0 -or $refName -cne 'HEAD') { throw 'Candidate checkout is not detached' }
  $pkg = Get-Content -LiteralPath (Join-Path $candidate 'package.json') -Raw | ConvertFrom-Json
  if ($pkg.packageManager -cne 'pnpm@12.6.0') { throw 'Unexpected candidate package-manager pin' }
  $lockfile = Join-Path $candidate 'pnpm-lock.yaml'
  $lockHash = (Get-FileHash -LiteralPath $lockfile -Algorithm SHA256).Hash
  $summary.lockfileSha256 = $lockHash

  $summary.stage = 'bootstrap'
  $root = Join-Path (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path ('xiumi-bootstrap-' + [Guid]::NewGuid().ToString('N'))
  $neutral = Join-Path $root 'neutral'
  $tools = Join-Path $root 'tools'
  $privateProfile = Join-Path $root 'profile'
  $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  try {
    $portProbe.ExclusiveAddressUse = $true
    $portProbe.Start()
    $checkPort = ([Net.IPEndPoint]$portProbe.LocalEndpoint).Port
  } finally {
    $portProbe.Stop()
  }
  $compatEnvironment = [ordered]@{
    TEMP = (Join-Path $root 'temp')
    TMP = (Join-Path $root 'temp')
    LOCALAPPDATA = (Join-Path $privateProfile 'local')
    APPDATA = (Join-Path $privateProfile 'roaming')
    HOME = $privateProfile
    USERPROFILE = $privateProfile
    PNPM_HOME = (Join-Path $root 'pnpm-home')
    XDG_CACHE_HOME = (Join-Path $root 'cache')
    XDG_CONFIG_HOME = (Join-Path $root 'config')
    XDG_DATA_HOME = (Join-Path $root 'xdg-data')
    XDG_STATE_HOME = (Join-Path $root 'xdg-state')
    npm_config_userconfig = (Join-Path $privateProfile 'npmrc')
    npm_config_cache = (Join-Path $root 'npm-cache')
    DATA_DIR = (Join-Path $root 'check-data')
    API_PORT = [string]$checkPort
    XIUMI_SKIP_ENV_FILES = '1'
    XIUMI_NO_BROWSER = '1'
    XIUMI_DATA_DIR = $null
    XIUMI_RESOURCES = $null
    XIUMI_PACKAGED = $null
    AI_API_KEY = $null
    AI_BASE_URL = $null
    AI_MODEL = $null
    WECHAT_APPID = $null
    WECHAT_APPSECRET = $null
    NODE_AUTH_TOKEN = $null
    NPM_TOKEN = $null
  }
  $null = New-Item -ItemType Directory -Path $root
  $isolatedDirectories = @($neutral, $tools, $privateProfile, $compatEnvironment.TEMP, $compatEnvironment.LOCALAPPDATA, $compatEnvironment.APPDATA, $compatEnvironment.PNPM_HOME, $compatEnvironment.XDG_CACHE_HOME, $compatEnvironment.XDG_CONFIG_HOME, $compatEnvironment.XDG_DATA_HOME, $compatEnvironment.XDG_STATE_HOME, $compatEnvironment.npm_config_cache, $compatEnvironment.DATA_DIR)
  $null = New-Item -Force -ItemType Directory -Path $isolatedDirectories
  [IO.File]::WriteAllText($compatEnvironment.npm_config_userconfig, '')
  $priorEnv = @{}
  foreach ($name in @($compatEnvironment.Keys) + 'Path') { $priorEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  try {
    $npm = Resolve-FirstApplication 'npm.cmd'
    $node = Resolve-FirstApplication 'node.exe'
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $pwsh = Resolve-FirstApplication 'pwsh.exe'
    foreach ($name in $compatEnvironment.Keys) {
      $value = if ($null -eq $compatEnvironment[$name]) { [NullString]::Value } else { $compatEnvironment[$name] }
      [Environment]::SetEnvironmentVariable($name, $value, 'Process')
      if ($null -eq $compatEnvironment[$name] -and $null -ne [Environment]::GetEnvironmentVariable($name, 'Process')) {
        throw 'An inherited external setting could not be removed'
      }
    }
    Push-Location -LiteralPath $neutral
    try {
      $nodeOutput = & $node --version
      if ($LASTEXITCODE -ne 0) { throw 'Node version check failed' }
      $summary.nodeVersion = Read-Version $nodeOutput '^v24\.\d+\.\d+$' 'Node 24'
      Invoke-Native $npm @('install', '--global', '--prefix', $tools, '--registry=https://registry.npmjs.org', '--no-audit', '--no-fund', '--ignore-scripts', 'pnpm@11.23.0')
      $launcher = Join-Path $tools 'pnpm.cmd'
      if (!(Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Official npm did not create the private Windows shim' }
      $env:Path = "$tools;$env:Path"
      $command = Resolve-FirstApplication 'pnpm.cmd'
      if (![string]::Equals($command, $launcher, [StringComparison]::OrdinalIgnoreCase)) { throw 'Private pnpm shim is not first in PATH' }
      $globalOutput = & $launcher --version
      if ($LASTEXITCODE -ne 0) { throw 'Private pnpm version check failed in neutral directory' }
      $summary.neutralPnpm = Read-Version $globalOutput '^\d+\.\d+\.\d+$' 'neutral pnpm'
      if ($summary.neutralPnpm -cne '11.23.0') { throw 'The neutral bootstrap did not match the installed controller contract' }
      Write-Host "Neutral: Node $($summary.nodeVersion), pnpm $($summary.neutralPnpm)"
    } finally {
      Pop-Location
    }
    Push-Location -LiteralPath $candidate
    try {
      $summary.stage = 'project-toolchain'
      $projectOutput = & $launcher --version
      if ($LASTEXITCODE -ne 0) { throw 'Project pnpm toolchain selection failed' }
      $summary.projectPnpm = Read-Version $projectOutput '^\d+\.\d+\.\d+$' 'project pnpm'
      Write-Host "Candidate $actual selected pnpm $($summary.projectPnpm)"
      if ($summary.projectPnpm -cne '12.6.0') { throw 'The same 11.23.0 bootstrap did not select the pinned project toolchain' }

      $summary.stage = 'frozen-install'
      if (Test-Path -LiteralPath 'node_modules') { throw 'Cold install touched an existing node_modules' }
      Invoke-Native $launcher @('install', '--frozen-lockfile')
      if ((Get-FileHash -LiteralPath $lockfile -Algorithm SHA256).Hash -cne $lockHash) { throw 'Frozen install changed the lockfile' }
      $summary.frozenInstall = $true
      if ($WarmRepeat) {
        $summary.stage = 'warm-frozen-install'
        Invoke-Native $launcher @('install', '--frozen-lockfile')
        if ((Get-FileHash -LiteralPath $lockfile -Algorithm SHA256).Hash -cne $lockHash) { throw 'Warm repeat changed the lockfile' }
        $summary.warmFrozenInstall = $true
      }
      $summary.stage = 'check'
      Invoke-Native $launcher @('check')
      $summary.check = $true
      $summary.stage = 'build'
      Invoke-Native $launcher @('build')
      if (!(Test-Path -LiteralPath 'dist/index.html' -PathType Leaf)) { throw 'Missing built application' }
      $summary.build = $true

      $smoke = Join-Path $PSScriptRoot 'windows-bootstrap-smoke.ps1'
      foreach ($edition in @(@{ key = 'windowsPowerShell'; shell = $powershell; expectedEdition = 'Desktop' }, @{ key = 'powerShellCore'; shell = $pwsh; expectedEdition = 'Core' })) {
        $summary.stage = $edition.key
        $smokeRoot = Join-Path $root $edition.key
        Invoke-Native $edition.shell @('-NoProfile', '-NonInteractive', '-File', $smoke, '-Candidate', $candidate, '-SmokeRoot', $smokeRoot)
        $proof = Get-Content -LiteralPath (Join-Path $smokeRoot 'proof.json') -Raw | ConvertFrom-Json
        if ($proof.shellEdition -cne $edition.expectedEdition) { throw 'Unexpected PowerShell edition for native smoke' }
        $summary[$edition.key] = $proof
      }
      $summary.stage = 'done'
      $summary.outcome = 'success'
    } finally {
      Pop-Location
    }
  } finally {
    foreach ($name in $priorEnv.Keys) {
      $value = if ($null -eq $priorEnv[$name]) { [NullString]::Value } else { $priorEnv[$name] }
      [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
  }
} finally {
  $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportDir 'summary.json') -Encoding UTF8
}
