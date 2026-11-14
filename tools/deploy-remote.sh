#!/usr/bin/env bash
# ============================================================================
#  Nebesny Archiv — remote deployment for a dedicated Linux machine.
#  Run from THIS repo (Windows) via ssh, or directly on the target.
#
#  Requires: ssh access, a user-level home dir with ~2 GB free, internet.
#  Does:     Java 21, NeoForge 21.1.250 server, the modpack (via packwiz),
#            server.properties / eula, JVM tuning, optional systemd service.
#
#  Usage: bash tools/deploy-remote.sh <target-dir>
# ============================================================================
set -euo pipefail

TARGET_DIR="${1:-$HOME/nebesny-archiv}"
NEOFORGE="21.1.250"
HERE="$(cd "$(dirname "$0")" && pwd)"
KIT="$HERE"

PACK_URL="$(head -n 1 "$KIT/pack-url.txt" 2>/dev/null | tr -d '\r\n' || true)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!!! %s\033[0m\n' "$*" >&2; exit 1; }

say "Система"
cat /etc/os-release 2>/dev/null | head -2 || true
echo "CPU: $(nproc) ядер | RAM: $(free -g | awk '/^Mem:/{print $2}') ГБ | Java: $(java -version 2>&1 | head -1 || echo 'нет')"

# --- 1. Java 21 ------------------------------------------------------------
say "Java 21"
if java -version 2>&1 | grep -q '"21'; then
  echo "уже установлена"
else
  case "$(uname -m)" in
    x86_64)  JARCH=x64;  JURL='https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jre/hotspot/normal/eclipse' ;;
    aarch64) JARCH=aarch64; JURL='https://api.adoptium.net/v3/binary/latest/21/ga/linux/aarch64/jre/hotspot/normal/eclipse' ;;
    *) die "неподдерживаемая архитектура $(uname -m)" ;;
  esac
  mkdir -p "$HOME/jre"
  say "скачиваем Temurin JRE 21 ($JARCH) — ~50 МБ"
  curl -fsSL "$JURL" -o /tmp/temurin.tar.gz || die "не скачался Temurin"
  tar -xzf /tmp/temurin.tar.gz -C "$HOME/jre" --strip-components=1 || die "не распаковался Temurin"
  rm -f /tmp/temurin.tar.gz
  "$HOME/jre/bin/java" -version 2>&1 | head -1
fi
JAVA="$HOME/jre/bin/java"
[ -x "$JAVA" ] || JAVA="java"

# --- 2. каталог сервера ----------------------------------------------------
say "Каталог сервера: $TARGET_DIR"
mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

for f in packwiz-installer-bootstrap.jar start-server.sh user_jvm_args.txt pack-url.txt server.properties.example; do
  [ -f "$KIT/$f" ] && cp -f "$KIT/$f" "$TARGET_DIR/" || true
done
[ -f pack-url.txt ] || printf '%s\n' "$PACK_URL" > pack-url.txt
chmod +x start-server.sh 2>/dev/null || true

# start-server.sh ищет jre/bin/java рядом с собой — подсовываем Temurin из ~/jre
if [ -x "$HOME/jre/bin/java" ]; then
  ln -sfn "$HOME/jre" "$TARGET_DIR/jre"
fi
ls -1

# --- 3. NeoForge ------------------------------------------------------------
if [ ! -f "libraries/net/neoforged/neoforge/$NEOFORGE/unix_args.txt" ]; then
  say "NeoForge $NEOFORGE"
  curl -fsSL "https://maven.neoforged.net/releases/net/neoforged/neoforge/$NEOFORGE/neoforge-$NEOFORGE-installer.jar" -o neoforge-installer.jar \
    || die "не скачался инсталлятор NeoForge"
  "$JAVA" -jar neoforge-installer.jar --installServer || die "инсталлятор NeoForge упал"
else
  say "NeoForge $NEOFORGE уже установлен"
fi

# --- 4. пак модов (packwiz) -------------------------------------------------
say "Ставим пак модов (это долго — ~2 ГБ)"
"$JAVA" -jar packwiz-installer-bootstrap.jar -g -s server "$(head -n 1 pack-url.txt | tr -d '\r\n')" \
  || die "packwiz не смог поставить пак"

# --- 5. EULA и server.properties -------------------------------------------
say "EULA и server.properties"
[ -f eula.txt ] || echo "eula=false" > eula.txt
sed -i 's/^eula=.*/eula=true/' eula.txt
grep -qi 'eula=true' eula.txt || die "не удалось принять EULA"

if [ -f server.properties ]; then
  cp server.properties server.properties.bak
else
  cp server.properties.example server.properties 2>/dev/null || true
fi
setprop() { grep -q "^$1=" server.properties 2>/dev/null && sed -i "s|^$1=.*|$1=$2|" server.properties || echo "$1=$2" >> server.properties; }
setprop server-port 25565
setprop max-players 8
setprop online-mode false
setprop enforce-secure-profile false
setprop allow-flight true
setprop enable-command-block true
setprop spawn-protection 0
setprop view-distance 8
setprop simulation-distance 6
setprop max-tick-time 180000
setprop white-list false
setprop enable-status true
setprop pause-when-empty-seconds 0
setprop sync-chunk-writes false

# --- 6. JVM под 8 ГБ --------------------------------------------------------
say "JVM-параметры под объём памяти"
TOTAL_GB=$(free -g | awk '/^Mem:/{print $2}')
if [ "$TOTAL_GB" -le 0 ]; then TOTAL_GB=8; fi
# оставляем системе ~2.5 ГБ, но не больше 60% RAM
HEAP=$(( TOTAL_GB * 6 / 10 ))
[ "$HEAP" -lt 3 ] && HEAP=3
[ "$HEAP" -gt 6 ] && HEAP=6
echo "RAM: ${TOTAL_GB} ГБ -> куча ${HEAP} ГБ"
cat > user_jvm_args.txt <<EOF
# Nebesny Archiv - dedicated server (auto-tuned for ${TOTAL_GB} GB RAM, $(nproc) cores)

-Xms$((HEAP - 1))G
-Xmx${HEAP}G
-XX:+UseG1GC
-XX:+ParallelRefProcEnabled
-XX:MaxGCPauseMillis=200
-XX:+UnlockExperimentalVMOptions
-XX:+DisableExplicitGC
-XX:G1NewSizePercent=30
-XX:G1MaxNewSizePercent=40
-XX:G1HeapRegionSize=8M
-XX:G1ReservePercent=20
-XX:G1HeapWastePercent=5
-XX:G1MixedGCCountTarget=4
-XX:InitiatingHeapOccupancyPercent=15
-XX:G1MixedGCLiveThresholdPercent=90
-XX:G1SetMaxFreeSizePercent=30
-XX:SurvivorRatio=32
-XX:+PerfDisableSharedMem
-XX:MaxTenuringThreshold=1
-Dusing.aikars.flags=https://mcflags.emc.gs
-Daikars.new.flags=true
EOF

say "Готово. Запуск: cd $TARGET_DIR && ./start-server.sh"
