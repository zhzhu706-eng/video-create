$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
function Test-Workbench {
  try {
    Invoke-WebRequest -Uri 'http://127.0.0.1:3817/api/health' -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch { return $false }
}

if (-not (Test-Workbench)) {
  try { Start-ScheduledTask -TaskName 'ArticleVideoStudio' -ErrorAction Stop } catch {}
  for ($i=0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 300
    if (Test-Workbench) { break }
  }
}
if (-not (Test-Workbench)) {
  $stdout = Join-Path $PSScriptRoot 'server.stdout.log'
  $stderr = Join-Path $PSScriptRoot 'server.stderr.log'
  Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
  $node = (Get-Command node -ErrorAction Stop).Source
  $process = Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Set-Content -LiteralPath (Join-Path $PSScriptRoot 'server.pid') -Value $process.Id -Encoding ascii
  $ready = $false
  for ($i=0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 300
    if (Test-Workbench) { $ready = $true; break }
    if ($process.HasExited) { break }
  }
  if (-not $ready) {
    $detail = if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '没有错误日志' }
    throw "工作台启动失败。错误信息：$detail"
  }
}
Start-Process 'http://127.0.0.1:3817'
