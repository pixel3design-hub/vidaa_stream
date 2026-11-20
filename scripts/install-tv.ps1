# Installa l'app vidaa_stream su una TV Hisense/VIDAA (Windows).
# Uso: .\scripts\install-tv.ps1 [-Ip 192.168.1.20] [-Port 8099] [-AppName Anime] [-AppId vidaa_anime] [-Prepare]
# Da eseguire in PowerShell come Amministratore (servono le porte 53 e 443).
[CmdletBinding()]
param(
  [string]$Ip,
  [int]$Port = 8099,
  [string]$AppName = 'Anime',
  [string]$AppId = 'vidaa_anime',
  [switch]$Prepare
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Work = Join-Path $Root '.installer'
$Helper = Join-Path $Work 'vidaa-appstore'
$Tpl = Join-Path $Root 'installer/install.html'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Say($t) { Write-Host "`n$t" -ForegroundColor White }
function Die($t) { Write-Host "errore: $t" -ForegroundColor Red; exit 1 }

Say '1/4 controlli'
$Uv = Get-Command uv -ErrorAction SilentlyContinue
if ($Uv) {
  $PythonExe = $Uv.Source
  $PythonArgs = @('run', '--quiet', '--with', 'dnslib', 'python')
  Write-Host 'python: via uv (dnslib isolato)'
} else {
  $Named = $null
  foreach ($c in @('python', 'python3', 'py')) {
    if (Get-Command $c -ErrorAction SilentlyContinue) { $Named = (Get-Command $c).Source; break }
  }
  if ($Named) {
    & $Named -c 'import dnslib' 2>$null
    if ($LASTEXITCODE -eq 0) {
      $PythonExe = $Named
      $PythonArgs = @()
      Write-Host "python: $Named con dnslib"
    }
  }
}
if (-not $PythonExe) {
  Die 'serve uv (winget install --id=astral-sh.uv) oppure Python 3 con dnslib (python -m pip install dnslib)'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die 'serve Node 24 o superiore' }
if (-not (Test-Path $Tpl)) { Die "manca $Tpl" }

if (-not $Ip) {
  $Ip = (node -e 'const os=require("os");const a=[];for(const l of Object.values(os.networkInterfaces()))for(const x of l||[])if(x.family==="IPv4"&&!x.internal)a.push(x.address);console.log(a[0]||"")' 2>$null)
  if ($Ip) { $Ip = $Ip.Trim() }
}
if (-not $Ip) {
  $Ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1).IPAddress
}
if (-not $Ip) { Die 'IP non rilevato: rilancia con -Ip 192.168.x.x' }

$Url = "http://${Ip}:${Port}/tv"
$Icon = "http://${Ip}:${Port}/icon.png"
Write-Host "server: $Ip   app: $Url"
try { Invoke-WebRequest -Uri "http://${Ip}:${Port}/health" -TimeoutSec 3 -UseBasicParsing | Out-Null }
catch { Write-Host "attenzione: http://${Ip}:${Port}/health non risponde, avvia prima `"node server.mjs`"" }

Say '2/4 preparo il servizio di installazione'
if (-not (Test-Path $Helper)) {
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  if (Get-Command git -ErrorAction SilentlyContinue) {
    git clone --depth 1 -q https://github.com/trialuser/vidaa-appstore $Helper
  } else {
    $tar = Join-Path $Work 'vidaa-appstore.tar.gz'
    Invoke-WebRequest -Uri 'https://github.com/trialuser/vidaa-appstore/archive/refs/heads/main.tar.gz' -OutFile $tar -UseBasicParsing
    tar -xzf $tar -C $Work
    Move-Item (Join-Path $Work 'vidaa-appstore-main') $Helper
  }
}
if (-not (Test-Path (Join-Path $Helper 'ssl/vidaahub.com.key'))) { Die "certificato mancante in $Helper/ssl" }

$config = @{
  enable_dns_server   = $true
  enable_https_server = $true
  enable_http_server  = $false
  server_address      = $Ip
  http_port           = 8080
  https_port          = 443
  ssl_keyfile         = 'ssl/vidaahub.com.key'
  ssl_certfile        = 'ssl/vidaahub.com.crt'
  html_file           = 'install.html'
  dns_records         = @(@{ hostname = 'vidaahub.com'; type = 'A'; address = $Ip })
}
[System.IO.File]::WriteAllText((Join-Path $Helper 'config.json'), ($config | ConvertTo-Json -Depth 5), $Utf8)

$html = Get-Content -Raw -Path $Tpl
$html = $html.Replace('{{NAME}}', $AppName)
$html = $html.Replace('{{APPID}}', $AppId)
$html = $html.Replace('{{URL}}', $Url)
$html = $html.Replace('{{ICON}}', $Icon)
[System.IO.File]::WriteAllText((Join-Path $Helper 'install.html'), $html, $Utf8)

Say '3/4 preparato'
$steps = @"
Sulla TV:
  1. Impostazioni -> Rete -> DNS = $Ip   (secondario: vuoto)
  2. apri il browser della TV su https://vidaahub.com/ e accetta il certificato
  3. "Installa" -> poi rimetti il DNS automatico e riavvia la TV
"@
Write-Host $steps

if ($Prepare) {
  Say "4/4 fermo qui (-Prepare): config.json e install.html sono pronti in $Helper"
  exit 0
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Die 'serve PowerShell come Amministratore (porte 53 e 443)' }

Say '4/4 avvio del servizio di installazione (Ctrl+C per fermarlo)'
Set-Location $Helper
& $PythonExe @PythonArgs 'server.py'
