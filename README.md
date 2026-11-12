# Nebesny Archiv / Небесный Архив

Сборка для Minecraft **1.21.1 NeoForge 21.1.250**: техника, магия, небесные корабли,
исследование и 150 дружелюбных к новичку квестов на русском.

> Мир — обломки летающей библиотечной флотилии. Две независимые ветви прогресса
> (техника и магия), необязательные «техномагические мосты», общий сюжет и личные роли.

---

## Что внутри

| Направление | Моды |
|---|---|
| Техника | Create 6, Create: Aeronautics, Sable, AE2 + аддоны, Mekanism, Immersive Engineering, Create: Steam 'n' Rails |
| Магия | Ars Nouveau, Spectrum, Theurgy, Neo Vitae, Occultism, Iron's Spellbooks, Goety |
| Исследование | Alex's Caves, Alex's Mobs, Aether, Deep Aether, Deeper and Darker, Cataclysm, Mowzie's Mobs, Dungeons Arise |
| Боссы | Cataclysm, Mowzie's Mobs, Bosses of Mass Destruction, Born in Chaos, Goety |
| Удобство | JEI, Jade, FTB Quests, FTB Teams, Sophisticated Storage/Backpacks, Waystones, Lootr, Bountiful |
| Сюжет | Easy NPC 7.18.0 (+ Config UI), EasyNPC x FTB Quests Compat 1.0.2 |
| Графика | Sodium, Iris, Distant Horizons, EMF/ETF, Particle Rain, Sound Physics — **шейдеры выключены по умолчанию** |

Полный список — в `packwiz/mods/` (207 Modrinth-мода + 3 FTB-мода локально).

### Квесты

8 глав, 150 квестов, 154 задачи. Текст полностью на русском, рассчитан на новичка:
что крафтить, где искать, какие клавиши нажимать. Ветки техники и магии независимы —
можно пройти одну, а вторую изучать потом.

| Группа | Главы |
|---|---|
| Пролог | `start`, `homestead` |
| Техника | `create`, `aeronautics`, `tech` |
| Магия | `magic` |
| Мир | `exploration`, `finale` |

### Сюжет

Живые NPC с ветвящимся диалогом, который меняется по ходу выполнения квестов.

| NPC | Кто такая | Что говорит |
|---|---|---|
| **Веста Урбан** | старший смотритель Каталога | объясняет, что произошло, и даёт первые задания |
| **Мия Тинь** | инвентаризатор, дочь Ирмы | рассказывает, где что лежит, и ищет мать |

- NPC ставятся сами: скрипт `kubejs/server_scripts/story.js` после старта сервера
  импортирует их рядом с точкой появления.
- У каждого NPC несколько диалогов с кнопками-ветками.
- Пока квест не выполнен, NPC говорит одно; после выполнения — другое
  (правило хранится в EasyNPC x FTB Quests Compat и привязано к ID квеста).
- Квесты «Веста Урбан» и «Мия Тинь» закрываются тем, что игрок прочитал диалог.
- Реплики и правила лежат в `tools/story-data.mjs`, генерируются скриптом
  `tools/generate-story.mjs`.

---

## Быстрый старт (клиент)

1. Скачайте **`NebesnyArchiv-1.0.0.mrpack`** из раздела **Releases**.
2. Импортируйте его в **XMCL**, Prism Launcher или ATLauncher.
3. Выделите игре **6–8 ГБ RAM** (Java 21).
4. Запустите. Шейдеры выключены — включайте Iris только если есть запас FPS.
5. Подключитесь к серверу друга: `26.x.x.x` (Radmin VPN) или локальный IP.

Обновления клиента — через повторный импорт нового `.mrpack` или через packwiz
(см. `server/README.md`, раздел «Клиент»).

---

## Сервер

Готовая тонкая папка — в `server/`:

- `server/README.md` — установка NeoForge, EULA, LAN vs выделенный сервер, Radmin VPN, whitelist, бэкапы.
- `server/pack-url.txt` — **единственное место**, куда нужно вписать адрес пака.
- `start-dedicated.cmd` — 6 ГБ, для 3–4 игроков.
- `start-lan.cmd` — 4 ГБ, если хост играет на том же ПК.
- `start-server.sh` — Linux.

При запуске сервер сам скачивает моды и конфиги через packwiz.

---

## Структура репозитория

```
nebesny-archiv/
├─ packwiz/                  # сам пак: pack.toml, index.toml, mods/*.pw.toml, config, kubejs
├─ packwiz-lite/             # облегчённый вариант того же пака
├─ server/                   # серверные скрипты и инструкция
├─ tools/                    # генераторы квестов, сюжета, tips и packwiz-метафайлов
│  ├─ quest-data.mjs         # исходник всех 150 квестов
│  ├─ quest-id.mjs           # генерация ID квестов, которые FTB умеет читать
│  ├─ generate-quests-dist.mjs # генерация SNBT во все цели + проверка ID
│  ├─ story-data.mjs         # NPC, диалоги и привязка к квестам
│  ├─ generate-story.mjs     # генерация .npc.snbt + проверка связей с квестами
│  ├─ make-packwiz.mjs       # сборка метафайлов из живого инстанса
│  ├─ build-test-zip.ps1     # пересборка PC-тестового архива
│  ├─ rcon.mjs               # RCON-клиент для тестового сервера
│  └─ fetch-mods.mjs         # загрузка модов по манифесту
├─ research/                 # дампы реестров items/entities для валидации
├─ dist/                     # .mrpack (в git не коммитится, кладётся в Releases)
├─ mods.manifest.json        # курируемый список модов
└─ libs.manifest.json        # библиотеки
```

---

## Для сопровождающего

### Обновить квесты

```bat
node tools\generate-quests-dist.mjs
```

Генератор пишет квесты сразу в `server-test`, `packwiz`, `packwiz-lite` и оба
XMCL-инстанса. Он проверяет все item/entity ID по `research/registry-items.txt` и
`research/registry-entities.txt` и падает, если ID неизвестен. Текст квестов — в
`tools/quest-data.mjs`; русский и английский lang-файлы генерируются одновременно.

> ID квестов генерирует `tools/quest-id.mjs`. Это важно: FTB Quests читает ID как
> знаковый hex-long, и обычный MD5-префикс примерно в половине случаев в него не
> влезает — сервер тогда молча меняет ID на случайный, и связи (зависимости,
> переводы, привязка диалогов) рвутся. Модуль маскирует значение до 63 бит.

### Обновить сюжет

```bat
node tools\generate-story.mjs
```

Генератор пишет `.npc.snbt` с диалогами в `config/easy_npc/preset/` во все пять
целей и проверяет, что каждое правило и каждая задача «поговори с NPC» ссылаются
на существующие диалог и квест. Правила привязываются к ID квеста, поэтому
после правки квестов сначала запускай `generate-quests-dist.mjs`, потом
`generate-story.mjs`.

Диалоги хранятся в `tools/story-data.mjs`. У каждого NPC метки диалогов
префиксуются его именем (`vesta_greet`, `miya_greet`): Easy NPC выводит UUID
диалога из метки, поэтому одинаковые метки у разных NPC столкнулись бы.

### Обновить пак после изменения модов

```bat
node tools\make-packwiz.mjs
cd packwiz
..\tools\bin\packwiz.exe refresh
..\tools\bin\packwiz.exe modrinth export -o ..\dist\NebesnyArchiv-1.0.0.mrpack
```

Или всё сразу, вместе с тестовым архивом:

```bat
powershell -File tools\build-test-zip.ps1
```

`make-packwiz.mjs` берёт jar-файлы из живого инстанса
`%USERPROFILE%\.minecraftx\instances\Nebesny Archiv\mods`, находит их на Modrinth,
пишет `mods/*.pw.toml` с sha512 и копирует конфиги `config/ftbquests`, `kubejs`,
`config/iris.properties`. Три FTB-мода, которых нет на Modrinth, кладутся в
`packwiz/mods/` как обычные jar и попадают в `overrides/` при экспорте.

> packwiz пишет манифест как `modrinth.index.json`, а Modrinth и Prism ищут
> `modrinth.json`. `build-test-zip.ps1` добавляет второе имя внутрь архива —
> поэтому один и тот же `.mrpack` импортируется и packwiz, и Modrinth.

> Важно: в метафайлах **не должно быть** `mode = "metadata:modrinth"` —
> packwiz понимает только `url` и `metadata:curseforge`. Обновления Modrinth
> работают через блок `[update.modrinth]`.

### Публикация на GitHub

1. Создайте **публичный** репозиторий `nebesny-archiv`.
2. Замените `YOUR_GITHUB_USER` в `server/pack-url.txt` и в этом README на свой ник.
3. Запушьте репозиторий:

```bat
git init
git add .
git commit -m "Nebesny Archiv 1.0.0"
git branch -M main
git remote add origin https://github.com/ВАШ_НИК/nebesny-archiv.git
git push -u origin main
```

4. Создайте релиз `v1.0.0` и прикрепите `dist/NebesnyArchiv-1.0.0.mrpack`.
5. Адрес пака для сервера и packwiz-клиента:

```
https://raw.githubusercontent.com/ВАШ_НИК/nebesny-archiv/main/packwiz/pack.toml
```

Репозиторий должен быть публичным: raw-ссылки приватных репозиториев требуют токен.
GitHub Pages не обязателен — packwiz отлично работает с raw.githubusercontent.com.

### Обновление версии

1. Поменяйте `version` в `packwiz/pack.toml`.
2. Пересоберите `.mrpack` с новым именем.
3. `git commit`, `git push`, новый Release.
4. Сервер подхватит изменения при следующем запуске; клиентам нужно обновить пак.

---

## Известные ограничения

- **Мобильный Lite** — это не отдельный мир, а облегчённый клиент **той же сборки**:
  те же контентные моды, что на сервере, минус 11 тяжёлых клиентских (Iris, Distant Horizons,
  Particle Rain, Sound Physics, First Person, Not Enough Animations, EMF/ETF, GTBCS,
  Xaero World Map). Остаётся 199 модов — это минимум для совместимости с общим сервером.
  На Poco X5 Pro ожидаемо 15–30 FPS в спокойных местах и 5–15 FPS у большой базы;
  загрузка 3–8 минут. Полной плавности телефон не даст. Если не тянет — нужен отдельный
  Lite-сервер с урезанным набором модов, но это уже другой мир.
- **Диалоги пока не проверены в игре.** Всё сюжетное проверено на сервере: NPC
  импортируются, метки и ветки диалогов на месте, правила привязки к квестам
  записаны в NBT сущности. Клик по NPC в окне игры нужно проверить руками —
  GUI-клиента в этой среде нет.
- В логе есть некритичные ошибки рецептов и loot-таблиц от Create-аддонов
  (`railways`, `dndecor`, `create_connected`, `tfmg`). Они не мешают игре.
- `spectrum:fusion_shrine` в старых квестах заменён на `fusion_shrine_basalt`.
- Alex's Caves требует **Feature Recycler** — не удаляйте его, иначе возможен краш мира.

---

## Благодарности

Все моды, текстуры и звуки принадлежат их авторам. Сборка лишь собирает их вместе
и добавляет квесты, советы и конфиги. Перед публикацией убедитесь, что лицензии
модов разрешают распространение в составе пака.
