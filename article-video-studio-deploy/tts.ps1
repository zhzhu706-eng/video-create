param(
  [Parameter(Mandatory=$true)][string]$TextPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$chinese = @($voice.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'zh-CN' })
if ($chinese.Count -eq 0) { throw 'No Chinese Windows voice found. Upload a WAV narration instead.' }
$voice.SelectVoice($chinese[0].VoiceInfo.Name)
$voice.Rate = 1
try {
  $voice.SetOutputToWaveFile($OutputPath)
  $content = Get-Content -LiteralPath $TextPath -Raw -Encoding UTF8
  $voice.Speak($content)
} finally {
  $voice.Dispose()
}
