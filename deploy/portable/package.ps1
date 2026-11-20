param(
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedSha,
  [Parameter(Mandatory)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
  throw 'The portable package requires PowerShell 7 on Windows x64.'
}
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$nodeVersion = '24.19.0'
$nodeZipSha = '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73'
$nodeExeSha = '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237'
$packageName = 'XIUMI-AI-Studio-win-x64'

function Invoke-Checked([string]$Path, [string[]]$Arguments) {
  & $Path @Arguments
  if ($LASTEXITCODE -ne 0) { throw "External build step failed (exit $LASTEXITCODE)." }
}

function Get-Sha([string]$LiteralPath) {
  (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

Push-Location -LiteralPath $repo
$stage = Join-Path ([IO.Path]::GetTempPath()) ('xiumi-portable-build-' + [guid]::NewGuid().ToString('N'))
try {
  $sha = & git rev-parse HEAD
  if ($LASTEXITCODE -ne 0 -or $sha -cne $ExpectedSha) { throw 'Checkout does not match expected candidate revision.' }
  $tree = & git rev-parse 'HEAD^{tree}'
  if ($LASTEXITCODE -ne 0 -or $tree -cnotmatch '^[a-f0-9]{40}$') { throw 'Cannot resolve candidate tree.' }
  if (& git status --porcelain --untracked-files=no) { throw 'Tracked source differs from the pinned checkout.' }
  if (-not (Test-Path -LiteralPath 'dist/index.html' -PathType Leaf)) { throw 'Build the frontend first.' }

  $layout = Join-Path $stage $packageName
  $app = Join-Path $layout 'app'
  $runtime = Join-Path $layout 'runtime'
  $null = New-Item -ItemType Directory -Path $app, $runtime
  foreach ($entry in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'dist', 'samples')) {
    Copy-Item -LiteralPath (Join-Path $repo $entry) -Destination $app -Recurse
  }
  $appScripts = Join-Path $app 'scripts'
  $null = New-Item -ItemType Directory -Path $appScripts
  Copy-Item -LiteralPath (Join-Path $repo 'scripts/restore-project-backup.mjs') -Destination $appScripts
  Copy-Item -LiteralPath (Join-Path $repo 'THIRD_PARTY_NOTICES.md') -Destination $layout
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.txt') -Destination $layout

  Invoke-Checked 'node' @('scripts/windows-portable-bundle.mjs', $app)
  # A separate frozen production install retains dependency licenses, resources,
  # module layouts and native packages instead of copying checkout junctions.
  Add-Content -LiteralPath (Join-Path $app 'pnpm-workspace.yaml') -Value "`nnodeLinker: hoisted"
  Invoke-Checked 'pnpm' @('--dir', $app, 'install', '--prod', '--frozen-lockfile')
  $bin = Join-Path $app 'node_modules/.bin'
  if (Test-Path -LiteralPath $bin) { Remove-Item -LiteralPath $bin -Recurse -Force }
  $dependencies = @(Get-ChildItem -LiteralPath (Join-Path $app 'node_modules') -Force -Recurse)
  if ($dependencies | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1) {
    throw 'Packaged dependency closure must not contain filesystem links.'
  }

  $nodeName = "node-v$nodeVersion-win-x64"
  $runtimeZip = Join-Path $stage 'node.zip'
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$nodeVersion/$nodeName.zip" -OutFile $runtimeZip -TimeoutSec 90
  if ((Get-Sha $runtimeZip) -cne $nodeZipSha) { throw 'Pinned Node distribution SHA-256 does not match.' }
  Expand-Archive -LiteralPath $runtimeZip -DestinationPath (Join-Path $stage 'official')
  $extracted = Join-Path $stage "official/$nodeName"
  $officialNode = Join-Path $extracted 'node.exe'
  if ((Get-Sha $officialNode) -cne $nodeExeSha) { throw 'Pinned extracted Node executable SHA-256 does not match.' }
  Copy-Item -LiteralPath $officialNode, (Join-Path $extracted 'LICENSE') -Destination $runtime

  $exe = Join-Path $layout 'XIUMI AI Studio.exe'
  $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
  Invoke-Checked $compiler @('/nologo', '/target:exe', '/platform:x64', "/out:$exe", (Join-Path $PSScriptRoot 'Launcher.cs'))
  $receipt = [ordered]@{
    commit = $sha
    tree = $tree
    node = $nodeVersion
    runtimeSha256 = $nodeExeSha
    launcherSha256 = Get-Sha $exe
  }
  $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $layout 'build.json') -Encoding utf8

  $null = New-Item -ItemType Directory -Path $OutputDirectory -Force
  $output = (Resolve-Path -LiteralPath $OutputDirectory).Path
  $archive = Join-Path $output "$packageName.zip"
  [IO.Compression.ZipFile]::CreateFromDirectory($layout, $archive, [IO.Compression.CompressionLevel]::Optimal, $true)
  $receipt['archiveSha256'] = Get-Sha $archive
  $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'receipt.json') -Encoding utf8
  "$($receipt.archiveSha256)  $packageName.zip" | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ascii
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
