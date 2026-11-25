@echo off
rem ===========================================================================
rem  build-dist.cmd  --  package everything a friend needs into one zip.
rem
rem  Usage:
rem    build-dist.cmd              lite zip  (needs Node.js on the PC)
rem    build-dist.cmd --with-node  zero-install zip (bundles node.exe, ~30 MB)
rem
rem  Run from the project root.
rem ===========================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "WITH_NODE=0"
if /i "%~1"=="--with-node" set "WITH_NODE=1"
if /i "%~1"=="/node" set "WITH_NODE=1"

rem --- resolve a Node to use for the smoke test ------------------------------
set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"

rem --- 1. sanity-check the sources before packaging -------------------------
rem Failures are flagged inside the blocks and acted on after them, ending in
rem "goto :abort": cmd.exe loses the code of an "exit /b 1" issued from inside a
rem block that has more commands after it, and the caller would see a success.
set "BAD_FILE="
if defined NODE_EXE (
  echo [1/4] Verification syntaxe des scripts...
  for %%F in (jukorama.js fx.js crt.js covers.js web.js web-session.js web\js\*.mjs) do (
    if not defined BAD_FILE (
      "%NODE_EXE%" -c "%%F"
      if errorlevel 1 set "BAD_FILE=%%F"
    )
  )
) else (
  echo [1/4] Node introuvable : saut de la verification syntaxe.
)
if defined BAD_FILE (
  echo.
  echo   ERREUR : %BAD_FILE% ne compile pas. Distribution annulee.
  echo.
  goto :abort
)
if defined NODE_EXE echo       OK

rem The offline suites replay whole sessions against a fake server (no network).
rem A zip must never ship a build that fails them.
rem Set JUKORAMA_SKIP_TESTS=1 to package anyway.
set "TESTS_KO="
if defined NODE_EXE if exist test\run-all.js if not "%JUKORAMA_SKIP_TESTS%"=="1" (
  echo       Tests hors ligne ^(~30 s^)...
  "%NODE_EXE%" test\run-all.js >"%TEMP%\jukorama-offline-tests.log" 2>&1
  if errorlevel 1 (set "TESTS_KO=1") else (echo       OK)
)
if defined TESTS_KO (
  echo.
  echo   ERREUR : les tests hors ligne echouent. Distribution annulee.
  echo   Detail : node test\run-all.js
  echo.
  findstr /b /c:"FAIL" /c:"        x " "%TEMP%\jukorama-offline-tests.log"
  echo.
  goto :abort
)

rem --- 2. assemble dist\ -----------------------------------------------------
echo [2/4] Copie des fichiers...
if not exist dist mkdir dist
del /q dist\* >nul 2>nul
if exist dist\node rmdir /s /q dist\node >nul 2>nul
if exist dist\web rmdir /s /q dist\web >nul 2>nul

for %%F in (jukorama.js fx.js crt.js covers.js web.js web-session.js Voter.cmd Voter-prive.cmd Voter-web.cmd Voter-web-prive.cmd INSTALLATION.txt) do (
  if exist "%%F" (
    copy /y "%%F" dist\ >nul
  ) else (
    echo   ATTENTION : %%F manquant.
  )
)
call :make_readme
if exist web (
  xcopy /e /i /y /q web dist\web >nul
)

rem --- 3. optionally bundle a portable Node ----------------------------------
if "%WITH_NODE%"=="1" (
  echo [3/4] Ajout de Node ^(zero-install^)...
  set "SRC_NODE="
  if defined NODE_EXE for /f "delims=" %%P in ('where node') do if not defined SRC_NODE set "SRC_NODE=%%P"
  if defined VENDOR_NODE set "SRC_NODE=%VENDOR_NODE%"
  if defined SRC_NODE (
    mkdir dist\node >nul 2>nul
    copy /y "!SRC_NODE!" dist\node\node.exe >nul
    echo       node.exe inclus depuis "!SRC_NODE!"
  ) else (
    echo   ATTENTION : node.exe introuvable, zip construit SANS Node.
    set "WITH_NODE=0"
  )
) else (
  echo [3/4] Zip "lite" ^(Node requis sur le PC du destinataire^).
)

rem --- 4. (re)build the archive ---------------------------------------------
echo [4/4] Creation de l'archive...
set "ZIP=jukorama.zip"
if "%WITH_NODE%"=="1" set "ZIP=jukorama-avec-node.zip"
if exist "%ZIP%" del /q "%ZIP%"
powershell -NoProfile -Command "Compress-Archive -Path 'dist\*' -DestinationPath '%ZIP%' -Force"
if errorlevel 1 (
  echo   ERREUR : la creation du zip a echoue.
  goto :abort
)

rem --- summary ---------------------------------------------------------------
for %%Z in ("%ZIP%") do set "ZIPSIZE=%%~zZ"
set /a ZIPMB=%ZIPSIZE%/1048576
echo.
echo   ======================================================================
echo     Pret :  %CD%\%ZIP%   ^(~%ZIPMB% Mo^)
echo   ======================================================================
echo.
echo   Contenu du dossier dist\ :
dir /b dist
echo.
if "%WITH_NODE%"=="1" (
  echo   Partage %ZIP% : le destinataire extrait et double-clique Voter.cmd.
  echo   AUCUNE installation necessaire ^(Node est inclus^).
) else (
  echo   Partage %ZIP% : le destinataire extrait et double-clique Voter.cmd.
  echo   Il lui faut Node.js ^(https://nodejs.org^). Pour une version sans
  echo   installation : build-dist.cmd --with-node
)
echo.
exit /b 0

rem ===========================================================================
:abort
rem Reached with goto, so this runs at top level and the code gets through.
exit /b 1

rem ===========================================================================
:make_readme
rem Write a short, friendly top-level guide into dist\.
> "dist\LISEZ-MOI.txt" echo ================================================================
>>"dist\LISEZ-MOI.txt" echo   JUKORAMA - VOTER POUR LES CHANSONS DE LA SOIREE
>>"dist\LISEZ-MOI.txt" echo ================================================================
>>"dist\LISEZ-MOI.txt" echo.
>>"dist\LISEZ-MOI.txt" echo   DEMARRAGE ^(2 etapes^) :
>>"dist\LISEZ-MOI.txt" echo.
>>"dist\LISEZ-MOI.txt" echo     1^) Extrais TOUT le dossier ^(clic droit ^> Extraire tout^).
>>"dist\LISEZ-MOI.txt" echo     2^) Double-clique sur  Voter.cmd
>>"dist\LISEZ-MOI.txt" echo.
>>"dist\LISEZ-MOI.txt" echo   Tape ensuite le titre d'une chanson, puis Entree. C'est tout.
>>"dist\LISEZ-MOI.txt" echo.
>>"dist\LISEZ-MOI.txt" echo   ----------------------------------------------------------------
>>"dist\LISEZ-MOI.txt" echo   LES QUATRE LANCEURS
>>"dist\LISEZ-MOI.txt" echo   ----------------------------------------------------------------
>>"dist\LISEZ-MOI.txt" echo     Voter.cmd            mode normal, dans le terminal
>>"dist\LISEZ-MOI.txt" echo     Voter-prive.cmd      mode prive, dans le terminal
>>"dist\LISEZ-MOI.txt" echo     Voter-web.cmd        la tele de Noel, dans le navigateur
>>"dist\LISEZ-MOI.txt" echo     Voter-web-prive.cmd  la tele de Noel, en mode prive
>>"dist\LISEZ-MOI.txt" echo.
>>"dist\LISEZ-MOI.txt" echo   La tele s'ouvre eteinte : appuie sur son bouton MARCHE.
>>"dist\LISEZ-MOI.txt" echo.
>>"dist\LISEZ-MOI.txt" echo   ----------------------------------------------------------------
>>"dist\LISEZ-MOI.txt" echo   "Node.js est introuvable" ?
>>"dist\LISEZ-MOI.txt" echo   ----------------------------------------------------------------
>>"dist\LISEZ-MOI.txt" echo     Installe Node.js ^(gratuit^) : https://nodejs.org ^(bouton LTS^),
>>"dist\LISEZ-MOI.txt" echo     ou demande la version "avec Node inclus" ^(rien a installer^).
>>"dist\LISEZ-MOI.txt" echo.
>>"dist\LISEZ-MOI.txt" echo   Details complets : voir INSTALLATION.txt
>>"dist\LISEZ-MOI.txt" echo ================================================================
goto :eof
