@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Jukorama - Voter (mode prive)

rem Private-mode launcher: throwaway anonymous profile, never written to disk,
rem accounts deleted on exit.

rem Prefer a Node bundled next to the scripts (node\node.exe); otherwise use the
rem system Node. This lets a "zero-install" zip work with a single double-click.
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
  echo     2^) Demande la version "avec Node inclus" a la personne qui t'a
  echo        partage ce dossier ^(aucune installation requise^).
  echo.
  pause
  exit /b 1
)

set JUKORAMA_PRIVATE=1
"%NODE_EXE%" "%~dp0jukorama.js" shell
set RC=%ERRORLEVEL%

rem Keep the window open whatever happened. Without this, a launcher started by
rem double-click closes the moment node exits and the user never sees the recap.
echo.
pause
exit /b %RC%
