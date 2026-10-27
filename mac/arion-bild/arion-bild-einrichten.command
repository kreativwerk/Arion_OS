#!/bin/bash
# Lokale Bildgenerierung auf dem Mac einrichten: mflux + Z-Image Turbo (4-bit).
#
# Einmal im Terminal starten:  bash arion-bild-einrichten.command
# Läuft auf Macs mit Apple-Chip ab 16 GB RAM. Das Skript darf mehrfach laufen.
#
# Danach im Terminal:  arion-bild "Ein weißer Transporter vor einer Lagerhalle im Abendlicht"
# Bilder landen in ~/ArionBilder.
set -euo pipefail

MODELL="filipstrand/Z-Image-Turbo-mflux-4bit"   # vorquantisiert, ca. 6–7 GB Download statt 31 GB
ZIEL="$HOME/ArionBilder"
BIN="$HOME/.local/bin"

schritt() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ok() { printf '   ✓ %s\n' "$1"; }
hinweis() { printf '   → %s\n' "$1"; }
stopp() { printf '\n\033[31m✕ %s\033[0m\n' "$1"; exit 1; }

schritt "Mac prüfen"
[ "$(uname -s)" = "Darwin" ] || stopp "Das Skript läuft nur auf dem Mac."
[ "$(uname -m)" = "arm64" ] || stopp "mflux braucht einen Mac mit Apple-Chip (M1 oder neuer)."
RAM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
CHIP="$(sysctl -n machdep.cpu.brand_string)"
ok "$CHIP, $RAM_GB GB RAM, macOS $(sw_vers -productVersion)"
[ "$RAM_GB" -ge 16 ] || stopp "Mindestens 16 GB RAM nötig."
FREI_GB=$(( $(df -k "$HOME" | awk 'NR==2{print $4}') / 1048576 ))
[ "$FREI_GB" -ge 15 ] || stopp "Zu wenig Speicherplatz frei ($FREI_GB GB). Bitte mindestens 15 GB freimachen."

schritt "uv (Python-Werkzeug)"
export PATH="$BIN:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$BIN:$PATH"
fi
command -v uv >/dev/null 2>&1 || stopp "uv ließ sich nicht installieren."
ok "uv $(uv --version | awk '{print $2}')"

schritt "mflux (Bildmodelle für Apple-Chips, github.com/filipstrand/mflux)"
uv tool install --upgrade mflux >/dev/null
uv tool update-shell >/dev/null 2>&1 || true
ok "mflux installiert"

# M1/M2 rechnen in float16 schneller (laut mflux 20–30 % pro Schritt)
FP=""
case "$CHIP" in *M1*|*M2*) FP="--compute-precision float16" ;; esac
LOWRAM=""
[ "$RAM_GB" -le 18 ] && LOWRAM="--low-ram"

schritt "Befehl arion-bild anlegen"
mkdir -p "$BIN" "$ZIEL"
cat > "$BIN/arion-bild" <<SH
#!/bin/bash
# arion-bild "Beschreibung" [Breite] [Höhe] [Seed]
# Beispiel: arion-bild "Flyer-Hintergrund, orange Transporter, Morgennebel" 1280 720
set -euo pipefail
[ \$# -ge 1 ] || { echo 'Aufruf: arion-bild "Beschreibung" [Breite] [Höhe] [Seed]'; exit 1; }
W="\${2:-1024}"; H="\${3:-1024}"; SEED="\${4:-\$RANDOM}"
OUT="$ZIEL/\$(date +%Y-%m-%d_%H%M%S)_\${SEED}.png"
"$BIN/mflux-generate-z-image-turbo" --model "$MODELL" --prompt "\$1" \\
  --width "\$W" --height "\$H" --steps 9 --seed "\$SEED" $FP $LOWRAM --output "\$OUT"
echo "Gespeichert: \$OUT"
open "\$OUT"
SH
chmod +x "$BIN/arion-bild"
ok "arion-bild liegt in $BIN"

schritt "Erstes Bild (lädt beim ersten Mal das Modell, ca. 6–7 GB)"
hinweis "Das kann je nach Leitung 5–20 Minuten dauern, danach 1–2 Minuten pro Bild."
"$BIN/arion-bild" "Photorealistic white delivery van parked in front of a modern logistics hall at golden hour, clean composition, high detail" 1024 768 42 \
  && ok "Fertig – das Bild hat sich geöffnet." \
  || hinweis "Das erste Bild hat nicht geklappt. Bitte die Meldung oben an Claude schicken."

printf '\nFertig. Neues Terminal-Fenster öffnen, dann geht:\n  arion-bild "deine Beschreibung" 1024 1024\nBilder liegen in %s\n' "$ZIEL"
