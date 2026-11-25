@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Jukorama - Television de Noel

rem Double-click launcher for the browser UI. Same voter as Voter.cmd,
rem drawn on a local page instead of in the terminal. This window has to stay
rem open: it is the program that talks to Festify.

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
  echo   Deux options :
  echo     1^) Installe Node.js ^(gratuit^) depuis https://nodejs.org ^(bouton vert LTS^),
  echo        puis relance ce fichier.
  echo     2^) Demande la version "avec Node inclus".
  echo.
  pause
  exit /b 1
)

echo.
echo   Ouverture de la television. Laisse cette fenetre ouverte.
echo.
"%NODE_EXE%" "%~dp0jukorama.js" web
set RC=%ERRORLEVEL%
if not "%RC%"=="0" (
  echo.
  echo   Le site s'est arrete avec le code %RC%.
  echo.
)
echo.
pause
exit /b %RC%
