#!/bin/bash
# Briefkasten-Scans an Arion OS hochladen.
#
# Der Scanner (Profil „Briefkasten“) legt die geöffnete Tagespost als eine PDF
# in den Ordner Letterbox. Dieses Skript lädt jede fertige PDF zu Arion OS
# (POST /api/external/letters). Dort zerlegt Claude den Stapel in einzelne
# Briefe; sie erscheinen im Post-Modul.
#
# Nichts wird gelöscht: hochgeladene Dateien wandern nach Letterbox/_hochgeladen,
# fehlgeschlagene bleiben liegen und werden beim nächsten Lauf neu versucht.
#
# Konfiguration: ~/.arion/letterbox.env
#   LETTERBOX_DIR="/Users/…/Scans/Letterbox"
#   ARION_URL="https://arion-os.vercel.app"
#   ARION_TOKEN_FILE="$HOME/.arion/letterbox-token"   (Datei mit dem API-Token)

set -u
CONF="$HOME/.arion/letterbox.env"
[ -f "$CONF" ] && . "$CONF"
LETTERBOX_DIR="${LETTERBOX_DIR:-$HOME/Scans/Letterbox}"
ARION_URL="${ARION_URL:-https://arion-os.vercel.app}"
ARION_TOKEN_FILE="${ARION_TOKEN_FILE:-$HOME/.arion/letterbox-token}"
CHUNK=$((3 * 1024 * 1024))
LOG="$HOME/Library/Logs/arion-letterbox.log"
LOCK="/tmp/arion-letterbox.lock"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# Nur ein Lauf gleichzeitig (der Scanner schreibt oft mehrere Ereignisse)
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK"' EXIT

[ -d "$LETTERBOX_DIR" ] || { log "Ordner fehlt: $LETTERBOX_DIR"; exit 1; }
[ -s "$ARION_TOKEN_FILE" ] || { log "Token fehlt: $ARION_TOKEN_FILE"; exit 1; }
TOKEN="$(tr -d '[:space:]' < "$ARION_TOKEN_FILE")"
DONE_DIR="$LETTERBOX_DIR/_hochgeladen"
mkdir -p "$DONE_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; rmdir "$LOCK"' EXIT

json_field() { sed -n "s/.*\"$1\":\([^,}]*\).*/\1/p" | head -1 | tr -d '" '; }

upload() {
  local f="$1" name size offset id final resp code part
  name="$(basename "$f")"
  size=$(stat -f %z "$f")
  offset=0
  id=""
  while [ "$offset" -lt "$size" ]; do
    part="$TMP/part"
    dd if="$f" of="$part" bs=$CHUNK skip=$((offset / CHUNK)) count=1 2>/dev/null
    final=0
    [ $((offset + $(stat -f %z "$part"))) -ge "$size" ] && final=1
    if [ -z "$id" ]; then
      resp=$(curl -sS -w '\n%{http_code}' --max-time 320 -H "Authorization: Bearer $TOKEN" \
        -F "file=@$part;type=application/pdf" -F "name=$name" -F "type=application/pdf" \
        -F "size=$size" -F "final=$final" -F "scanned_by=Briefkasten" \
        "$ARION_URL/api/external/letters")
    else
      resp=$(curl -sS -w '\n%{http_code}' --max-time 320 -X PUT -H "Authorization: Bearer $TOKEN" \
        -F "file=@$part;type=application/pdf" -F "offset=$offset" -F "final=$final" \
        "$ARION_URL/api/external/letters/$id")
    fi
    code=$(echo "$resp" | tail -1)
    if [ "${code:0:1}" != "2" ]; then
      log "FEHLER $name ($code): $(echo "$resp" | head -1 | cut -c1-300)"
      return 1
    fi
    [ -z "$id" ] && id=$(echo "$resp" | head -1 | json_field id)
    offset=$((offset + $(stat -f %z "$part")))
  done
  log "OK $name → Brief $id, $(echo "$resp" | head -1 | json_field count) Brief(e)"
  return 0
}

now=$(date +%s)
find "$LETTERBOX_DIR" -maxdepth 1 -type f -iname '*.pdf' | sort | while read -r f; do
  # Erst hochladen, wenn der Scanner fertig geschrieben hat (30 s keine Änderung)
  age=$((now - $(stat -f %m "$f")))
  [ "$age" -lt 30 ] && continue
  if upload "$f"; then
    target="$DONE_DIR/$(date +%Y-%m-%d_%H%M)_$(basename "$f")"
    [ -e "$target" ] && target="${target%.pdf}_$$.pdf"
    mv "$f" "$target"
  fi
done
