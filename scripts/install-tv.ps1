# Installa l'app AniSat VIDAA Streamer su una TV Hisense/VIDAA (Windows).
# TUI: powershell -ExecutionPolicy Bypass -File .\scripts\install-tv.ps1
# Flag: -Ip 192.168.1.20 -Port 8099 -AppName Anime -Prepare -Yes
[CmdletBinding()]
param(
  [string]$Ip,
  [int]$Port = 8099,
  [string]$AppName = 'Anime',
  [string]$AppId = 'vidaa_anime',
  [switch]$Prepare,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Work = Join-Path $Root '.installer'
$Helper = Join-Path $Work 'vidaa-appstore'
$Tpl = Join-Path $Root 'installer/install.html'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$script:PyExe = $null
$script:PyArgs = @()

function Say($t) { Write-Host $t }
function Ok($t) { Write-Host "OK  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "!   $t" -ForegroundColor Yellow }
function Err($t) { Write-Host "X   $t" -ForegroundColor Red }
function Box { Write-Host ('-' * 58) -ForegroundColor DarkGray }
function Die($t) { Err $t; exit 1 }

function Ask($q, [switch]$DefaultYes) {
  if ($Yes) { return $true }
  $hint = if ($DefaultYes) { '[S/n]' } else { '[s/N]' }
  $a = Read-Host "$q $hint"
  if ([string]::IsNullOrWhiteSpace($a)) { return [bool]$DefaultYes }
  return $a -match '^(s|si|sì|y|yes)$'
}

function Pause-Menu { if (-not $Yes) { Read-Host 'Invio per continuare' | Out-Null } }

function Test-Admin {
  return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# --- dipendenze ----------------------------------------------------------
function Install-Winget($id, $fallbackMsg) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Say "    -> winget install --id=$id -e"
    winget install --id $id -e --accept-package-agreements --accept-source-agreements | Out-Null
    return $LASTEXITCODE -eq 0
  }
  Err $fallbackMsg
  return $false
}

function Ensure-Python {
  if ($script:PyExe) { return $true }

  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if ($uv) {
    $script:PyExe = $uv.Source
    $script:PyArgs = @('run', '--quiet', '--with', 'dnslib', 'python')
    return $true
  }

  foreach ($c in @('python', 'python3', 'py')) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    & $cmd.Source -c 'import dnslib' 2>$null
    if ($LASTEXITCODE -eq 0) {
      $script:PyExe = $cmd.Source
      $script:PyArgs = @()
      return $true
    }
  }

  Write-Host ''
  Warn 'serve un Python con dnslib per il servizio di installazione: uv e la via piu semplice'
  if ($Yes) { Err 'modalita automatica: installa uv prima di rilanciare'; return $false }
  Say '  1) installa uv (consigliato, senza toccare il sistema)'
  Say '  2) installa dnslib nel Python di sistema'
  Say '  3) lo faccio io, esci'
  $scelta = Read-Host 'Scelta [1]'
  if (-not $scelta) { $scelta = '1' }

  switch ($scelta) {
    '1' {
      if (Install-Winget 'astral-sh.uv' 'winget non disponibile: installa uv da https://astral.sh/uv') {
        $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
      } else {
        try { Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression; $env:Path = "$env:USERPROFILE\.local\bin;$env:Path" } catch { }
      }
      $uv = Get-Command uv -ErrorAction SilentlyContinue
      if ($uv) { $script:PyExe = $uv.Source; $script:PyArgs = @('run', '--quiet', '--with', 'dnslib', 'python'); return $true }
      Warn 'uv non disponibile dopo l''installazione'
    }
    '2' {
      $py = Get-Command python -ErrorAction SilentlyContinue
      if (-not $py) { Install-Winget 'Python.Python.3.12' 'Python non trovato' | Out-Null; $py = Get-Command python -ErrorAction SilentlyContinue }
      if ($py) {
        Say "    -> $($py.Source) -m pip install --user dnslib"
        & $py.Source -m pip install --user dnslib
        if ($LASTEXITCODE -eq 0) { $script:PyExe = $py.Source; $script:PyArgs = @(); return $true }
      }
    }
  }

  Err 'senza uv o Python+dnslib l''installazione non puo partire.'
  Say '  uv:     winget install --id=astral-sh.uv -e'
  Say '  dnslib: python -m pip install --user dnslib'
  return $false
}

function Ensure-Fetch {
  if (Get-Command git -ErrorAction SilentlyContinue) { return $true }
  if ((Get-Command curl.exe -ErrorAction SilentlyContinue) -and (Get-Command tar -ErrorAction SilentlyContinue)) { return $true }
  Warn 'per scaricare il servizio di installazione serve git, oppure curl e tar'
  if (-not (Ask 'li installo adesso?' -DefaultYes)) { return $false }
  Install-Winget 'Git.Git' 'winget non disponibile: installa git da https://git-scm.com' | Out-Null
  return [bool](Get-Command git -ErrorAction SilentlyContinue)
}

function Show-Deps {
  $py = if (Get-Command uv -ErrorAction SilentlyContinue) { 'uv' } elseif ($script:PyExe) { $script:PyExe } else { 'assente' }
  $fetch = if (Get-Command git -ErrorAction SilentlyContinue) { 'git' } else { 'curl+tar' }
  Say "  python    : $py"
  Say "  download  : $fetch"
  Say "  admin     : $(if (Test-Admin) { 'si' } else { 'no, chiedero l''elevazione' })"
}

# --- rete ----------------------------------------------------------------
function Get-LocalIp {
  $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }
  $withGw = $candidates | Where-Object { $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1
  if ($withGw) { return $withGw.IPAddress }
  if ($candidates) { return ($candidates | Select-Object -First 1).IPAddress }
  return $null
}

function Test-Http($url) {
  try { Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing | Out-Null; return $true } catch { return $false }
}

# --- preparazione --------------------------------------------------------
function Prepare-Files {
  $Url = "http://${Ip}:${Port}/tv"
  $Icon = "http://${Ip}:${Port}/icon.png"

  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  if (-not (Test-Path $Helper)) {
    Say '    -> scarico il servizio di installazione in .installer/'
    if (Get-Command git -ErrorAction SilentlyContinue) {
      git clone --depth 1 -q https://github.com/trialuser/vidaa-appstore $Helper
    } else {
      $tar = Join-Path $Work 'vidaa-appstore.tar.gz'
      Invoke-WebRequest -Uri 'https://github.com/trialuser/vidaa-appstore/archive/refs/heads/main.tar.gz' -OutFile $tar -UseBasicParsing
      tar -xzf $tar -C $Work
      Move-Item (Join-Path $Work 'vidaa-appstore-main') $Helper
    }
  }
  if (-not (Test-Path (Join-Path $Helper 'ssl/vidaahub.com.key'))) { Err "certificato mancante in $Helper/ssl"; return $false }

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
  return $true
}

function Show-TvSteps {
  Box
  Say 'Cosa fare sulla TV'
  Say "  1. Impostazioni -> Rete -> DNS = $Ip   (secondario: vuoto)"
  Say '  2. apri il browser della TV su https://vidaahub.com/ e accetta il certificato'
  Say '  3. premi "Installa"'
  Say '  4. rimetti il DNS su automatico e riavvia la TV'
  Say ''
  Say "  se il server non risponde: http://${Ip}:${Port}/"
}

function Start-Installer {
  if (-not (Test-Admin)) {
    Warn 'le porte 53 e 443 richiedono i privilegi di amministratore'
    if (-not (Ask 'riapro lo script come amministratore?' -DefaultYes)) { return }
    $argLine = "-NoExit -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Ip $Ip -Port $Port -AppName `"$AppName`" -AppId $AppId"
    Start-Process powershell -Verb RunAs -ArgumentList $argLine
    return
  }
  Set-Location $Helper
  Say ''
  Say 'Avvio il servizio (Ctrl+C per fermarlo)'
  & $script:PyExe @script:PyArgs 'server.py'
}

# --- azioni --------------------------------------------------------------
function Action-Install {
  if (-not (Ensure-Python)) { Pause-Menu; return }
  if (-not (Ensure-Fetch)) { Pause-Menu; return }
  if (-not $Ip) { Err 'IP non rilevato: impostalo dalla voce 6'; Pause-Menu; return }
  if (-not (Prepare-Files)) { Pause-Menu; return }
  Show-TvSteps
  if (-not (Ask 'avvio il servizio adesso?' -DefaultYes)) { Say "preparato in $Helper"; Pause-Menu; return }
  Start-Installer
}

function Action-Prepare {
  if (-not (Ensure-Python)) { Pause-Menu; return }
  if (-not (Ensure-Fetch)) { Pause-Menu; return }
  if (Prepare-Files) { Ok "file pronti in $Helper"; Show-TvSteps }
  Pause-Menu
}

function Action-Settings {
  Box
  $v = Read-Host "IP del server [$Ip]"; if ($v) { $script:Ip = $v }
  $v = Read-Host "porta [$Port]"; if ($v) { $script:Port = [int]$v }
  $v = Read-Host "nome app sulla TV [$AppName]"; if ($v) { $script:AppName = $v }
  $v = Read-Host "app id [$AppId]"; if ($v) { $script:AppId = $v }
  Ok 'aggiornato per questa sessione'
  Pause-Menu
}

function Action-Status {
  Box
  Say 'Stato'
  $up = Test-Http "http://${Ip}:${Port}/health"
  Say "  server : http://${Ip}:${Port}  $(if ($up) { 'raggiungibile' } else { 'non raggiungibile' })"
  Say "  app    : $AppName ($AppId)"
  Say "  TV     : http://${Ip}:${Port}/tv"
  Show-Deps
  Pause-Menu
}

function Show-Menu {
  while ($true) {
    Clear-Host
    Box
    Say '  AniSat VIDAA Streamer - installazione sulla TV'
    Box
    Say "  server : http://${Ip}:${Port}"
    Say "  app    : $AppName ($AppId)"
    Say ''
    Say '  1) Installa l''app sulla TV'
    Say '  2) Controlla e installa le dipendenze'
    Say '  3) Prepara solo i file, senza avviare'
    Say '  4) Rivedi i passi da fare sulla TV'
    Say '  5) Stato e dipendenze'
    Say '  6) Cambia IP / porta / nome app'
    Say '  0) Esci'
    Say ''
    switch (Read-Host 'Scelta') {
      '1' { Action-Install }
      '2' { if (Ensure-Python) { Ok 'python pronto' }; if (Ensure-Fetch) { Ok 'download pronto' }; Show-Deps; Pause-Menu }
      '3' { Action-Prepare }
      '4' { Show-TvSteps; Pause-Menu }
      '5' { Action-Status }
      '6' { Action-Settings }
      { $_ -in @('0', 'q', '') } { return }
      default { Warn 'scelta non valida'; Start-Sleep -Seconds 1 }
    }
  }
}

# --- entry point ---------------------------------------------------------
if (-not $Ip) { $Ip = Get-LocalIp }

if ($Prepare -or $Yes) {
  if (-not (Ensure-Python)) { exit 1 }
  if (-not (Ensure-Fetch)) { exit 1 }
  if (-not $Ip) { Die 'IP non rilevato: usa -Ip 192.168.x.x' }
  if (-not (Prepare-Files)) { exit 1 }
  Say "server: $Ip   app: http://${Ip}:${Port}/tv"
  Say "config.json e install.html pronti in $Helper"
  if ($Prepare) { exit 0 }
  Show-TvSteps
  Start-Installer
  exit 0
}

if (-not $Ip) { Warn 'IP non rilevato: impostalo dalla voce 6 del menu' }
Show-Menu
