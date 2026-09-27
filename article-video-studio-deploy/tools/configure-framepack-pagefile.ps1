param(
  [uint32]$SystemDriveMB = 11264,
  [uint32]$ModelDriveMB = 49152,
  [string]$ResultPath = ''
)

$ErrorActionPreference = 'Stop'

if (!$ResultPath) {
  $projectRoot = Split-Path -Parent $PSScriptRoot
  $ResultPath = Join-Path $projectRoot '.test-data\pagefile-result.json'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$isAdministrator) {
  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"' + $PSCommandPath + '"'),
    '-SystemDriveMB', $SystemDriveMB,
    '-ModelDriveMB', $ModelDriveMB
  )
  if ($ResultPath) { $arguments += @('-ResultPath', ('"' + $ResultPath + '"')) }
  $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $process.ExitCode
}

function Set-PageFileSetting {
  param(
    [string]$Name,
    [uint32]$SizeMB
  )

  $setting = Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq $Name }
  if ($setting) {
    Set-CimInstance -InputObject $setting -Property @{
      InitialSize = $SizeMB
      MaximumSize = $SizeMB
    } | Out-Null
  } else {
    New-CimInstance -ClassName Win32_PageFileSetting -Property @{
      Name = $Name
      InitialSize = $SizeMB
      MaximumSize = $SizeMB
    } | Out-Null
  }
}

$computer = Get-CimInstance Win32_ComputerSystem
Set-CimInstance -InputObject $computer -Property @{ AutomaticManagedPagefile = $false } | Out-Null
Set-PageFileSetting -Name 'C:\pagefile.sys' -SizeMB $SystemDriveMB
Set-PageFileSetting -Name 'D:\pagefile.sys' -SizeMB $ModelDriveMB

$result = [pscustomobject]@{
  configured = $true
  rebootRequired = $true
  settings = @(Get-CimInstance Win32_PageFileSetting |
    Select-Object Name, InitialSize, MaximumSize)
}
$json = $result | ConvertTo-Json -Depth 4
if ($ResultPath) {
  $parent = Split-Path -Parent $ResultPath
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Set-Content -LiteralPath $ResultPath -Value $json -Encoding UTF8
}
$json
