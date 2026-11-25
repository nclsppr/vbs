@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Jukorama - Television de Noel (prive)

rem Private browser session: throwaway profiles, nothing written next to the
rem saved one, accounts deleted when the television is switched off from the
rem page (the blue key).

set "NODE_EXE="
if exist "%~dp0node\node.exe" set "NODE_EXE=%~dp0node\node.exe"
if not defined NODE_EXE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_EXE=node"
)
if not defined NODE_EXE (
  echo.
  echo   Node.js est introuvable.
  echo.
  echo   Installe Node.js depuis https://nodejs.org ou demande la version
  echo   "avec Node inclus".
  echo.
  pause
  exit /b 1
)

echo.
echo   Cabine privee. Laisse cette fenetre ouverte.
echo.
set JUKORAMA_PRIVATE=1
"%NODE_EXE%" "%~dp0jukorama.js" web
set RC=%ERRORLEVEL%
echo.
pause
exit /b %RC%
