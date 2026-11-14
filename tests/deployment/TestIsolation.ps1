# Test infrastructure only. No environment changes or IO occur merely by loading it.
function Assert-XiumiTestPath([string]$Path, [string]$ApprovedRoot) {
 if ([string]::IsNullOrWhiteSpace($Path) -or [string]::IsNullOrWhiteSpace($ApprovedRoot)) { throw 'Missing approved test path' }
 $base=[IO.Path]::GetFullPath($ApprovedRoot).TrimEnd('\','/')
 $full=[IO.Path]::GetFullPath($Path).TrimEnd('\','/')
 if ($full -ne $base -and -not $full.StartsWith($base+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped approved test root' }
 $probe=$full
 while ($probe) {
  if ([IO.File]::Exists($probe) -or [IO.Directory]::Exists($probe)) {
   if (([IO.File]::GetAttributes($probe) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point is not an approved test path' }
  }
  $parent=[IO.Path]::GetDirectoryName($probe)
  if ($parent -eq $probe) { break }; $probe=$parent
 }
 return $full
}
function Assert-XiumiTestEnvironment([string]$SandboxRoot) {
 if ([IO.Path]::GetFileName($SandboxRoot) -notmatch '^xiumi-pester-[a-f0-9]{32}$') { throw 'Invalid private test directory' }
 $null=Assert-XiumiTestPath $SandboxRoot $SandboxRoot
 if ($env:XIUMI_TEST_SANDBOX -cne $SandboxRoot) { throw 'Private test environment was not installed' }
 foreach($entry in @{LOCALAPPDATA='appdata';TEMP='tmp';TMP='tmp'}.GetEnumerator()) {
  if ([Environment]::GetEnvironmentVariable($entry.Key,'Process') -cne (Join-Path $SandboxRoot $entry.Value)) { throw "Unsafe test environment: $($entry.Key)" }
 }
}
function Invoke-XiumiTestStateWrite([string]$Root, $State, [scriptblock]$Body, [string]$ApprovedRoot = $env:XIUMI_TEST_SANDBOX) {
 Assert-XiumiTestEnvironment $env:XIUMI_TEST_SANDBOX
 $ApprovedRoot=Assert-XiumiTestPath $ApprovedRoot $env:XIUMI_TEST_SANDBOX
 $Root=Assert-XiumiTestPath $Root $ApprovedRoot
 # Dot invocation binds the real Save-State body to this checked local Root,
 # rather than relying on a caller's script:Root or a dot-sourced default.
 . $Body $State
}
