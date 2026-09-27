$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$localPackage = Join-Path $root 'runtime\framepack_cu126_torch26'
$shortPackage = 'D:\codex\FramePack\framepack_cu126_torch26'
$package = if ($env:FRAMEPACK_PACKAGE) { $env:FRAMEPACK_PACKAGE } elseif (Test-Path -LiteralPath $shortPackage) { $shortPackage } else { $localPackage }
$python = Join-Path $package 'system\python\python.exe'
$webui = Join-Path $package 'webui'

if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath (Join-Path $webui 'demo_gradio.py'))) {
  throw 'FramePack package is missing from runtime\framepack_cu126_torch26.'
}

$env:PATH = "$(Join-Path $package 'system\git\bin');$(Join-Path $package 'system\python');$(Join-Path $package 'system\python\Scripts');$env:PATH"
$env:PY_LIBS = "$(Join-Path $package 'system\python\Scripts\Lib');$(Join-Path $package 'system\python\Scripts\Lib\site-packages')"
$env:PY_PIP = Join-Path $package 'system\python\Scripts'
$env:SKIP_VENV = '1'
$env:PIP_INSTALLER_LOCATION = Join-Path $package 'system\python\get-pip.py'
if (!$env:HF_ENDPOINT) { $env:HF_ENDPOINT = 'https://hf-mirror.com' }
$env:HF_HUB_DISABLE_XET = '1'
$models = Join-Path (Split-Path -Parent $package) 'models'
$hunyuan = Join-Path $models 'hunyuanvideo'
$flux = Join-Path $models 'flux_redux_bfl'
$i2v = Join-Path $models 'FramePackI2V_HY'
if (Test-Path (Join-Path $models 'download-complete.json')) {
  $env:FRAMEPACK_HUNYUAN_PATH = $hunyuan
  $env:FRAMEPACK_FLUX_PATH = $flux
  $env:FRAMEPACK_I2V_PATH = $i2v
  & $python (Join-Path $root 'tools\patch-framepack-runtime.py') (Join-Path $webui 'demo_gradio.py')
}

Set-Location -LiteralPath $webui
Write-Host "FramePack URL: http://127.0.0.1:7860; model source: $env:HF_ENDPOINT"
Write-Host 'The first run downloads more than 30 GB. Restarting resumes the download.'
& $python 'demo_gradio.py' '--server' '127.0.0.1' '--port' '7860'
