param([Parameter(Mandatory=$true)][ValidateSet('Start-Process','Stop-Process','Get-Process','Invoke-WebRequest','Invoke-RestMethod')][string]$CommandName)
$ErrorActionPreference='Stop'
switch($CommandName) {
 'Start-Process' { Start-Process -FilePath (Join-Path $env:XIUMI_TEST_SANDBOX 'never-execute.exe') }
 'Stop-Process' { Stop-Process -Id 2147483647 }
 'Get-Process' { Get-Process -Id $PID }
 'Invoke-WebRequest' { Invoke-WebRequest -Uri 'not-a-uri' }
 'Invoke-RestMethod' { Invoke-RestMethod -Uri 'not-a-uri' }
}
