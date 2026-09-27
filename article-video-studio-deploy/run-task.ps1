$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
  $node = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (-not (Test-Path -LiteralPath $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
  & $node (Join-Path $PSScriptRoot 'server.mjs') 2>&1 | Out-File -LiteralPath (Join-Path $PSScriptRoot 'server.task.log') -Append -Encoding UTF8
  exit $LASTEXITCODE
} catch {
  $_ | Out-File -LiteralPath (Join-Path $PSScriptRoot 'server.task.log') -Append -Encoding UTF8
  exit 1
}
