$ErrorActionPreference = 'Stop'
$taskName = 'ArticleVideoStudio'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'run-task.ps1')`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
for ($i=0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3817/api/health' -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) { Write-Output 'Studio running. Autostart and restart are enabled.'; exit 0 }
  } catch {}
}
throw 'Task registered, but port 3817 did not respond. Check Get-ScheduledTaskInfo ArticleVideoStudio.'
