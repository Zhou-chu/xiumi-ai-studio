param([string]$Root = "$env:LOCALAPPDATA\XiumiStudio", [switch]$FunctionsOnly)
function Get-DeploymentUser { [Security.Principal.WindowsIdentity]::GetCurrent().Name }
function Install-DesktopDeployment {
  param([string]$Root)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$name = 'XiumiStudio-CD'
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
  throw 'XiumiStudio-CD already exists; inspect it before replacing it'
}
New-Item -ItemType Directory -Force $Root | Out-Null
Copy-Item -LiteralPath "$PSScriptRoot\desktop.ps1" -Destination "$Root\desktop.ps1"
# Fixed local script: repository updates cannot replace the task's control script.
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$Root\desktop.ps1`" -Root `"$Root`""
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User (Get-DeploymentUser)),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10))
)
$principal = New-ScheduledTaskPrincipal -UserId (Get-DeploymentUser) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Principal $principal -Settings $settings | Out-Null
Write-Output "Installed $name for the current user. No ports or firewall settings changed."

}
if (-not $FunctionsOnly) { Install-DesktopDeployment -Root $Root }
