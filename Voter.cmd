@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Jukorama - Voter

rem Double-click launcher: opens the interactive voter.
rem Prefers a bundled node\node.exe (zero-install zip), else the system Node.

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

"%NODE_EXE%" "%~dp0jukorama.js" shell
set RC=%ERRORLEVEL%

rem Only show the troubleshooting block when something actually failed.
if not "%RC%"=="0" (
  echo.
  echo ------------------------------------------------------------
  echo   Le script s'est arrete avec le code %RC%.
  echo.
  echo   Diagnostic reseau :
  echo.
  echo   Proxy Windows :
  reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer 2>nul
  reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable 2>nul
  echo.
  echo   Version de Node :
  "%NODE_EXE%" --version
  echo.
  echo   Si tu vois "Connect Timeout", "fetch failed" ou une erreur
  echo   de certificat, lance ceci dans une invite de commandes :
  echo.
  echo     cd /d "%~dp0"
  echo     "%NODE_EXE%" --use-env-proxy --use-system-ca jukorama.js party
  echo.
  echo   Copie le message ci-dessus si tu demandes de l'aide.
  echo ------------------------------------------------------------
)

echo.
pause
