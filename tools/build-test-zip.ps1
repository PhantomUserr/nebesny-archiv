# Builds the PC-only test deliverable:
#
#   dist/NebesnyArchiv-1.0.0.mrpack      (exported by packwiz)
#   -> adds a "modrinth.json" alias next to packwiz's "modrinth.index.json"
#   -> packs it with README-TEST.txt and SHA256SUMS.txt into
#      ..\NebesnyArchiv-PC-TEST.zip
#
# The alias matters: packwiz writes "modrinth.index.json", but the Modrinth app
# and Prism look for "modrinth.json". The content is the Modrinth manifest
# format either way, so a copy makes the pack importable by both.
#
# Usage: powershell -File tools/build-test-zip.ps1 [-SkipExport]
param(
  [switch]$SkipExport
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$packwizBin = Join-Path $PSScriptRoot 'bin\packwiz.exe'
$packDir = Join-Path $root 'packwiz'
$distDir = Join-Path $root 'dist'
$mrpack = Join-Path $distDir 'NebesnyArchiv-1.0.0.mrpack'
$outZip = Join-Path (Split-Path -Parent $root) 'NebesnyArchiv-PC-TEST.zip'
$stage = Join-Path $env:TEMP 'nebesny-pc-test'

# 1. export the pack ------------------------------------------------------------
if (-not $SkipExport) {
  Write-Host 'Refreshing the packwiz index...'
  Push-Location $packDir
  try { & $packwizBin refresh | Out-Null } finally { Pop-Location }
  Write-Host 'Exporting the .mrpack...'
  Push-Location $packDir
  try {
    & $packwizBin modrinth export -o $mrpack | Out-Null
  } finally { Pop-Location }
}

if (-not (Test-Path $mrpack)) { throw "Missing $mrpack" }

# 2. add the modrinth.json alias ------------------------------------------------
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($mrpack, 'Update')
try {
  $existing = $zip.GetEntry('modrinth.json')
  if ($existing) { $existing.Delete() }
  $source = $zip.GetEntry('modrinth.index.json')
  if (-not $source) { throw 'modrinth.index.json is missing from the pack' }
  $stream = $source.Open()
  $buffer = New-Object System.IO.MemoryStream
  try {
    $stream.CopyTo($buffer)
    $bytes = $buffer.ToArray()
  } finally {
    $stream.Dispose()
    $buffer.Dispose()
  }
  $target = $zip.CreateEntry('modrinth.json')
  $out = $target.Open()
  try { $out.Write($bytes, 0, $bytes.Length) } finally { $out.Dispose() }
  Write-Host 'Added modrinth.json alias.'
} finally { $zip.Dispose() }

# 3. stage the test build -------------------------------------------------------
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item $mrpack (Join-Path $stage 'NebesnyArchiv-1.0.0.mrpack') -Force

$readme = @'
Nebesny Archiv — PC test build 1.0.0
===================================

Что внутри:
- NebesnyArchiv-1.0.0.mrpack — полный PC-клиент, 226 модов.

Запуск в XMCL:
1. XMCL -> Instances -> Import modpack.
2. Выбери NebesnyArchiv-1.0.0.mrpack.
3. Java 21, RAM 8192 МБ.
4. Запусти игру.

Запуск в Modrinth / Prism:
1. Modrinth -> Instances -> Import -> выбери .mrpack.
2. Java 21, RAM 8192 МБ.

Тестовый сервер:
- Запущен локально: localhost:25565.
- Multiplayer -> Direct Connect -> localhost.
- Для друзей по Radmin VPN: 26.x.x.x:25565.
- 18 глав, 329 квестов, 595 задач, тестовый мир.

Что есть в этом билде:
- Полноценные русские гайды в квестах: что это за предмет, как его получить
  по шагам и практический совет.
- Удобство: Mouse Tweaks, AppleSkin, Mod Menu, BetterF3, Controlling,
  Chat Heads, Reese's Sodium Options, ShulkerBoxTooltip, Inventory Profiles Next.
- Farmer's Delight обязателен: без пира флота финал не закрывается.
- Слой диалогов временно отключён.

Примечание:
- Это тестовый билд, не финальный GitHub Release.
- Шейдеры выключены по умолчанию.
- Мобильная/Lite-версия в этот тест не входит и сейчас не развивается.
'@
[System.IO.File]::WriteAllText((Join-Path $stage 'README-TEST.txt'), $readme, (New-Object System.Text.UTF8Encoding($false)))

$hash = (Get-FileHash (Join-Path $stage 'NebesnyArchiv-1.0.0.mrpack') -Algorithm SHA256).Hash.ToLower()
[System.IO.File]::WriteAllText(
  (Join-Path $stage 'SHA256SUMS.txt'),
  "$hash  NebesnyArchiv-1.0.0.mrpack`n",
  (New-Object System.Text.UTF8Encoding($false))
)

# 4. zip it ---------------------------------------------------------------------
if (Test-Path $outZip) { Remove-Item $outZip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $outZip -CompressionLevel Optimal

Write-Host ''
Write-Host "Built $outZip"
Get-Item $outZip | Select-Object Name, Length, LastWriteTime | Format-List
Get-Content (Join-Path $stage 'SHA256SUMS.txt')
