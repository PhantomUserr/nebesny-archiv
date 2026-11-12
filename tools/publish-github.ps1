# Публикует репозиторий и релиз на GitHub.
#
# Токен НЕ хранится в файлах и НЕ попадает в историю команд: он берётся
# из Git Credential Manager (его записывает сам пользователь один раз
# командой `git credential approve`, см. README).
#
# Что делает скрипт:
#   1. достаёт токен из Credential Manager;
#   2. создаёт публичный репозиторий, если его ещё нет;
#   3. пушит ветку main;
#   4. создаёт релиз v1.0.0 и прикладывает dist/NebesnyArchiv-1.0.0.mrpack;
#   5. проверяет, что raw-ссылка pack.toml отдаёт 200.
#
# Usage: powershell -ExecutionPolicy Bypass -File tools/publish-github.ps1
param(
  [string]$Owner = 'PhantomUserr',
  [string]$Repo = 'nebesny-archiv',
  [string]$ReleaseTag = 'v1.0.0',
  [string]$ReleaseName = 'Nebesny Archiv 1.0.0 (PC)',
  [string]$ReleaseNotes = "Nebesny Archiv - Minecraft 1.21.1 NeoForge 21.1.250.\n\n- 18 глав, 333 квеста, 599 задач (текст на русском)\n- Сюжет: Easy NPC (Веста Урбан, Мия Тинь) с ветвящимся диалогом, привязанным к FTB Quests\n- Farmer's Delight обязателен: финал требует пир флота\n- 216 модов (Create, AE2, Create Aeronautics, Ars Nouveau, Mekanism и др.)\n- Шейдеры выключены по умолчанию"
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$mrpack = Join-Path $root 'dist\NebesnyArchiv-1.0.0.mrpack'

# --- 1. достать токен из Credential Manager, не печатая его --------------------
$credInput = "protocol=https`nhost=github.com`nusername=$Owner`n`n"
$credOutput = $credInput | git credential fill 2>$null
$token = $null
foreach ($line in $credOutput) {
  if ($line -like 'password=*') { $token = $line.Substring(9) }
}
if (-not $token) {
  $hint = @'
Токен не найден в Git Credential Manager.

Запиши его один раз — токен останется в менеджере паролей Windows,
в чат и в историю команд он не попадёт.

В PowerShell выполни (подставь свой токен):

  $cred = "protocol=https`nhost=github.com`nusername=PhantomUserr`npassword=ТВОЙ_ТОКЕН`n"
  $cred | git credential approve

Потом снова запусти: powershell -ExecutionPolicy Bypass -File tools/publish-github.ps1
'@
  throw $hint
}
Write-Host "Токен найден в Credential Manager."

$headers = @{
  'Authorization' = "Bearer $token"
  'Accept'        = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'    = 'nebesny-archiv-publish'
}

# --- 1b. проверяем, что токен рабочий -----------------------------------------
try {
  $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers -Method Get
  Write-Host "Авторизация: $($me.login)"
} catch {
  throw "Токен не принят GitHub: $($_.Exception.Message). Перезапиши его через 'git credential approve'."
}

# --- 2. репозиторий ------------------------------------------------------------
# Внимание: переменная называется $repoInfo, а не $repo — в PowerShell имена
# нечувствительны к регистру, и $repo затирал бы параметр $Repo.
$repoUrl = "https://api.github.com/repos/$Owner/$Repo"
$repoInfo = $null
try {
  $repoInfo = Invoke-RestMethod -Uri $repoUrl -Headers $headers -Method Get
} catch {
  $repoInfo = $null
}
if (-not $repoInfo) {
  Write-Host "Создаю публичный репозиторий $Owner/$Repo ..."
  $body = @{
    name        = $Repo
    description = 'Nebesny Archiv - Minecraft 1.21.1 NeoForge modpack: 18 глав, 333 квеста, сюжет с NPC'
    private     = $false
    auto_init   = $false
  } | ConvertTo-Json
  $repoInfo = Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Headers $headers -Method Post -Body $body -ContentType 'application/json'
  Write-Host "  создан: $($repoInfo.full_name) (private=$($repoInfo.private))"
} else {
  Write-Host "Репозиторий уже есть: $($repoInfo.full_name) (private=$($repoInfo.private))"
  if ($repoInfo.private) {
    Write-Warning 'Репозиторий приватный: raw-ссылки для packwiz работать не будут.'
  }
}

# --- 3. пуш --------------------------------------------------------------------
Write-Host 'Пушу main ...'
Push-Location $root
try {
  git branch -M main
  git remote set-url origin "https://github.com/$Owner/$Repo.git"
  $env:GIT_TERMINAL_PROMPT = '0'
  git push -u origin main
  if ($LASTEXITCODE -ne 0) { throw "git push вернул $LASTEXITCODE" }
} finally { Pop-Location }

# --- 4. релиз ------------------------------------------------------------------
if (-not (Test-Path $mrpack)) { throw "Нет файла $mrpack — сначала собери пак." }

$assetName = 'NebesnyArchiv-1.0.0.mrpack'
$api = "https://api.github.com/repos/$Owner/$Repo/releases"
$release = $null
try {
  $release = Invoke-RestMethod -Uri "$api/tags/$ReleaseTag" -Headers $headers -Method Get
} catch {
  $release = $null
}
if (-not $release) {
  Write-Host "Создаю релиз $ReleaseTag ..."
  $body = @{
    tag_name    = $ReleaseTag
    name        = $ReleaseName
    body        = $ReleaseNotes
    draft       = $false
    prerelease  = $false
  } | ConvertTo-Json
  $release = Invoke-RestMethod -Uri $api -Headers $headers -Method Post -Body $body -ContentType 'application/json'
}

# загрузить ассет (или заменить, если уже есть)
$hasAsset = $release.assets | Where-Object { $_.name -eq $assetName }
if ($hasAsset) {
  Write-Host 'Ассет уже загружен — заменяю.'
  Invoke-RestMethod -Uri "https://uploads.github.com/repos/$Owner/$Repo/releases/assets/$($hasAsset.id)" `
    -Headers @{ 'Authorization' = "Bearer $token"; 'User-Agent' = 'nebesny-archiv-publish'; 'Content-Type' = 'application/octet-stream' } `
    -Method Delete -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

$uploadUrl = "https://uploads.github.com/repos/$Owner/$Repo/releases/$($release.id)/assets?name=$([uri]::EscapeDataString($assetName))"
Write-Host "Загружаю $assetName ($((Get-Item $mrpack).Length) байт) ..."
$bytes = [System.IO.File]::ReadAllBytes($mrpack)
Invoke-RestMethod -Uri $uploadUrl -Headers @{ 'Authorization' = "Bearer $token"; 'User-Agent' = 'nebesny-archiv-publish'; 'Content-Type' = 'application/octet-stream' } `
  -Method Post -Body $bytes | Out-Null
Write-Host '  загружено.'

# --- 5. проверка raw-ссылки ----------------------------------------------------
$raw = "https://raw.githubusercontent.com/$Owner/$Repo/main/packwiz/pack.toml"
Start-Sleep -Seconds 4
try {
  $resp = Invoke-WebRequest -Uri $raw -UseBasicParsing
  Write-Host "raw-ссылка отвечает $($resp.StatusCode): $raw"
} catch {
  Write-Warning "raw-ссылка пока не отвечает ($($_.Exception.Message)). Подожди минуту и проверь: $raw"
}

Write-Host ''
Write-Host 'Готово.'
Write-Host "  Репозиторий: https://github.com/$Owner/$Repo"
Write-Host "  Релиз:      https://github.com/$Owner/$Repo/releases/tag/$ReleaseTag"
Write-Host "  Адрес пака: $raw"
