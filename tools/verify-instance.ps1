<#
  Nebesny Archiv — проверка (и починка) клиента по .mrpack
  ========================================================
  Скрипт сверяет папку mods экземпляра с эталонным .mrpack:
  находит отсутствующие и отличающиеся по хешу моды и (с -Fix) докачивает их.

  Использование (PowerShell, Windows):
      .\verify-instance.ps1                          # авто-поиск инстанса XMCL
      .\verify-instance.ps1 -InstancePath "D:\...\mods" -Fix
#>
[CmdletBinding()]
param(
  # Папка mods экземпляра (или сам инстанс). Пусто = искать в XMCL.
  [string]$InstancePath = "",
  # Локальный .mrpack (пусто = скачать с GitHub)
  [string]$PackPath = "",
  # Докачивать недостающие/битые моды
  [switch]$Fix
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$PackUrl = "https://github.com/PhantomUserr/nebesny-archiv/releases/download/v1.0.0/NebesnyArchiv-1.0.0.mrpack"
$WorkDir = Join-Path $env:TEMP ("na-verify-" + [guid]::NewGuid().ToString("N").Substring(0, 8))

function Write-Ok($m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Bad($m) { Write-Host "  [ПРОБЛЕМА] $m" -ForegroundColor Red }
function Write-Info($m) { Write-Host $m }

# ------------------------------------------------------------------ 1. инстанс
if (-not $InstancePath) {
  Write-Info "Ищу инстанс XMCL..."
  $root = Join-Path $env:USERPROFILE ".minecraftx\instances"
  $cands = @()
  if (Test-Path $root) {
    $cands = Get-ChildItem $root -Directory | Where-Object { Test-Path (Join-Path $_.FullName "mods") }
    $pref = $cands | Where-Object { $_.Name -like "*Nebesny*" }
    if ($pref) { $cands = $pref }
  }
  if ($cands.Count -eq 0) {
    Write-Host "Не нашёл инстанс. Укажи папку вручную: -InstancePath ""<путь к папке mods>""" -ForegroundColor Yellow
    exit 2
  }
  if ($cands.Count -gt 1) {
    Write-Info "Найдено несколько инстансов, беру последний по дате:"
    $cands | Sort-Object LastWriteTime -Descending | ForEach-Object { Write-Info ("   " + $_.Name + "  (" + $_.LastWriteTime + ")") }
  }
  $InstancePath = Join-Path ($cands | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName "mods"
}
if (-not (Test-Path $InstancePath)) { Write-Host "Нет папки: $InstancePath" -ForegroundColor Red; exit 2 }
$InstancePath = (Resolve-Path $InstancePath).Path
if (Test-Path (Join-Path $InstancePath "mods")) { $InstancePath = (Resolve-Path (Join-Path $InstancePath "mods")).Path }
Write-Info "Папка модов: $InstancePath"
Write-Info ""

# ------------------------------------------------------------------ 2. .mrpack
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
if (-not $PackPath) {
  $PackPath = Join-Path $WorkDir "NebesnyArchiv-1.0.0.mrpack"
  Write-Info "Скачиваю эталонный пакет..."
  Invoke-WebRequest -Uri $PackUrl -OutFile $PackPath -UseBasicParsing
}
$zipCopy = Join-Path $WorkDir "pack.zip"
Copy-Item $PackPath $zipCopy -Force
$extract = Join-Path $WorkDir "pack"
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
Expand-Archive -Path $zipCopy -DestinationPath $extract -Force
$index = Get-Content (Join-Path $extract "modrinth.index.json") -Raw -Encoding UTF8 | ConvertFrom-Json

# ожидаемые моды: из индекса + моды из overrides (ключ — имя файла)
$expected = @{}
foreach ($f in $index.files) {
  $name = Split-Path $f.path -Leaf
  $expected[$name] = @{ sha1 = $f.hashes.sha1.ToLower(); url = $f.downloads[0]; size = $f.fileSize }
}
$ovDir = Join-Path $extract "overrides\mods"
if (Test-Path $ovDir) {
  Get-ChildItem $ovDir -Filter *.jar | ForEach-Object {
    $expected[$_.Name] = @{ sha1 = (Get-FileHash $_.FullName -Algorithm SHA1).Hash.ToLower(); url = $null; size = $_.Length }
  }
}
Write-Info "В пакете модификаций: $($expected.Count)"
Write-Info ""

# ------------------------------------------------------------------ 3. сверка
$missing = @()
$broken = @()
$ok = 0
foreach ($rel in ($expected.Keys | Sort-Object)) {
  $target = Join-Path $InstancePath $rel
  if (-not (Test-Path -LiteralPath $target)) { $missing += $rel; continue }
  $h = (Get-FileHash -LiteralPath $target -Algorithm SHA1).Hash.ToLower()
  if ($h -ne $expected[$rel].sha1) { $broken += $rel; continue }
  $ok++
}

$extra = @()
Get-ChildItem $InstancePath -Filter *.jar -ErrorAction SilentlyContinue | ForEach-Object {
  if (-not $expected.ContainsKey($_.Name)) { $extra += $_.Name }
}

Write-Info "Результат сверки:"
Write-Ok "совпало по хешу: $ok"
if ($missing.Count) { Write-Bad "отсутствует: $($missing.Count)"; $missing | ForEach-Object { Write-Host "      - $_" -ForegroundColor Red } }
if ($broken.Count) { Write-Bad "отличается по хешу: $($broken.Count)"; $broken | ForEach-Object { Write-Host "      - $_" -ForegroundColor Red } }
if ($extra.Count) { Write-Info "лишние моды (не критично): $($extra.Count)"; $extra | ForEach-Object { Write-Host "      - $_" -ForegroundColor DarkGray } }

# ------------------------------------------------------------------ 4. починка
if ($Fix -and ($missing.Count -or $broken.Count)) {
  Write-Info ""
  Write-Info "Докачиваю и заменяю проблемные моды..."
  foreach ($rel in ($missing + $broken)) {
    $info = $expected[$rel]
    $dest = Join-Path $InstancePath $rel
    $tmp = $dest + ".part"
    if ($info.url) {
      try {
        Invoke-WebRequest -Uri $info.url -OutFile $tmp -UseBasicParsing
      } catch {
        Write-Bad "не скачался $($info.url): $($_.Exception.Message)"
        continue
      }
    } else {
      $src = Join-Path $ovDir $rel
      Copy-Item -LiteralPath $src -Destination $tmp -Force
    }
    $h = (Get-FileHash -LiteralPath $tmp -Algorithm SHA1).Hash.ToLower()
    if ($h -eq $info.sha1) {
      Move-Item -LiteralPath $tmp -Destination $dest -Force
      Write-Ok "исправлен: $rel"
    } else {
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
      Write-Bad "хеш не сошёлся после загрузки: $rel"
    }
  }
}

Write-Info ""
if (-not $missing.Count -and -not $broken.Count) {
  Write-Host "Сборка совпадает с эталоном. Можно подключаться к серверу." -ForegroundColor Green
  exit 0
} else {
  Write-Host "Сборка не совпадает с эталоном. Запусти ещё раз с -Fix, затем перезапусти игру." -ForegroundColor Yellow
  exit 1
}
