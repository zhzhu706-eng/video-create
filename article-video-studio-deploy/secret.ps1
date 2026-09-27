param(
  [Parameter(Mandatory=$true)][ValidateSet('protect','unprotect')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$KeyPath
)
$ErrorActionPreference = 'Stop'
$value = [Console]::In.ReadToEnd()

if ($Mode -eq 'protect' -and -not (Test-Path -LiteralPath $KeyPath)) {
  $key = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($key) } finally { $rng.Dispose() }
  $folder = Split-Path -Parent $KeyPath
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  [IO.File]::WriteAllBytes($KeyPath, $key)
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetOwner($identity)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow'))
    Set-Acl -LiteralPath $KeyPath -AclObject $acl
  } catch {
    Remove-Item -LiteralPath $KeyPath -Force -ErrorAction SilentlyContinue
    throw "Cannot restrict the local key file: $($_.Exception.Message)"
  }
}

if (-not (Test-Path -LiteralPath $KeyPath)) { throw 'Local encryption key does not exist' }
$key = [IO.File]::ReadAllBytes($KeyPath)
if ($key.Length -ne 32) { throw 'Local encryption key is invalid' }

if ($Mode -eq 'protect') {
  $secure = ConvertTo-SecureString -String $value -AsPlainText -Force
  ConvertFrom-SecureString -SecureString $secure -Key $key
} else {
  $secure = ConvertTo-SecureString -String $value -Key $key
  $credential = [Management.Automation.PSCredential]::new('video-workbench', $secure)
  $credential.GetNetworkCredential().Password
}
