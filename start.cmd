@echo off
rem Avvia AniSat VIDAA Streamer su Windows. Serve Node 24+ e ffmpeg nel PATH.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node non trovato. Installa Node 24 o superiore da https://nodejs.org
  pause
  exit /b 1
)
node server.mjs
pause
