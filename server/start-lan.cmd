@echo off
rem ============================================================
rem  Nebesny Archiv - LAN host (4 GB server + your game client)
rem  Use this when you play on the same PC that hosts the world.
rem  Requires Java 21 and an installed NeoForge 21.1.250 server.
rem ============================================================
cd /d "%~dp0"
title Nebesny Archiv - LAN server
chcp 65001 >nul

set "PACK_URL="
if exist "pack-url.txt" set /p PACK_URL=<pack-url.txt
if "%PACK_URL%"=="" (
  echo [!] Fill pack-url.txt with the public pack.toml URL first.
  pause
  exit /b 1
)

set "JAVA=java"
if exist "jre\bin\java.exe" set "JAVA=jre\bin\java.exe"

echo [1/3] Checking pack updates...
"%JAVA%" -jar packwiz-installer-bootstrap.jar -g -s server "%PACK_URL%"
if errorlevel 1 (
  echo [!] Pack update failed. Check your internet connection and pack URL.
  pause
  exit /b 1
)

if not exist "libraries\net\neoforged\neoforge\21.1.250\win_args.txt" (
  echo [!] NeoForge 21.1.250 is not installed in this folder.
  echo     Run the NeoForge installer with --installServer, then start again.
  pause
  exit /b 1
)

if not exist "eula.txt" (
  echo eula=false>eula.txt
)
findstr /i "eula=true" eula.txt >nul
if errorlevel 1 (
  echo [!] Accept the Minecraft EULA: open eula.txt and change eula=false to eula=true.
  pause
  exit /b 1
)

echo [2/3] Starting LAN server on port 25565...
echo [3/3] In game: Multiplayer -> Direct connect -> localhost
echo       Friends on LAN: your local IPv4 address (ipconfig).
echo       Friends over Radmin VPN: your 26.x.x.x address.
"%JAVA%" @user_jvm_args-lan.txt @libraries\net\neoforged\neoforge\21.1.250\win_args.txt nogui
pause
