#!/bin/bash
# Einrichtung auf dem Büro-Mac:  bash scripts/letterbox/install.sh "/Pfad/zu/Scans"
# Legt Scans/Letterbox an, installiert das Upload-Skript und startet den Hintergrunddienst.
# Den API-Token legst du selbst ab (siehe Ausgabe am Ende) – das Skript fragt ihn nicht ab.
set -e
SCANS="${1:?Pfad zum freigegebenen Ordner „Scans“ angeben}"
DIR="$SCANS/Letterbox"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/_hochgeladen" "$HOME/.arion" "$HOME/Library/LaunchAgents"
cp "$HERE/arion-letterbox.sh" "$HOME/.arion/arion-letterbox.sh"
chmod +x "$HOME/.arion/arion-letterbox.sh"
[ -f "$HOME/.arion/letterbox.env" ] || cat > "$HOME/.arion/letterbox.env" <<CONF
LETTERBOX_DIR="$DIR"
ARION_URL="https://arion-os.vercel.app"
ARION_TOKEN_FILE="$HOME/.arion/letterbox-token"
CONF
PLIST="$HOME/Library/LaunchAgents/de.arion.letterbox.plist"
sed -e "s#__HOME__#$HOME#g" -e "s#__LETTERBOX_DIR__#$DIR#g" "$HERE/de.arion.letterbox.plist" > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Fertig: $DIR wird überwacht (Log: ~/Library/Logs/arion-letterbox.log)."
[ -s "$HOME/.arion/letterbox-token" ] || echo "Noch offen: API-Token aus Arion OS (Einstellungen → API-Tokens) in ~/.arion/letterbox-token speichern."
