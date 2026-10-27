#!/bin/bash
# ARION-Stimme auf dem Büro-Mac einrichten: VoiceStudio + Torwächter + Tailscale Funnel.
#
# Einmal im Terminal starten:  bash arion-stimme-einrichten.command
# Das Skript darf mehrfach laufen; fertige Schritte überspringt es.
#
# Ergebnis: Arion OS (Vercel) erreicht die Stimme und die Spracherkennung
# unter https://<dein-mac>.ts.net – nur mit dem geheimen Token und nur für
# Sprechen (/v1/audio/speech) und Zuhören (/v1/audio/transcriptions).
set -euo pipefail

APP_DIR="$HOME/Library/Application Support/ArionVoice"
PROBE_DIR="$HOME/ArionVoice/Alistair-Probe"
AGENT_ID="de.arion.voiceproxy"
AGENT_PLIST="$HOME/Library/LaunchAgents/$AGENT_ID.plist"
VS_URL="http://127.0.0.1:3900"
PROXY_PORT=3901
VOICE_NAME="Alistair"
TTS_MODEL="voxcpm2"   # Apache 2.0, geschäftlich erlaubt (OmniVoice ist nur nicht-kommerziell)

schritt() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ok() { printf '   ✓ %s\n' "$1"; }
hinweis() { printf '   → %s\n' "$1"; }
stopp() { printf '\n\033[31m✕ %s\033[0m\n' "$1"; exit 1; }

# ── 0. Voraussetzungen ───────────────────────────────────────────────
schritt "Mac prüfen"
[ "$(uname -s)" = "Darwin" ] || stopp "Das Skript läuft nur auf dem Mac."
[ "$(uname -m)" = "arm64" ] || stopp "VoiceStudio braucht einen Mac mit Apple-Chip (M1 oder neuer)."
ok "Apple-Chip, macOS $(sw_vers -productVersion)"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  stopp "macOS installiert jetzt die Entwicklerwerkzeuge (für Python). Danach das Skript nochmal starten."
fi
ok "Python vorhanden"

# ── 1. VoiceStudio ───────────────────────────────────────────────────
schritt "VoiceStudio"
if [ ! -d "/Applications/VoiceStudio.app" ] && [ ! -d "$HOME/Applications/VoiceStudio.app" ]; then
  hinweis "Installiere VoiceStudio (offizielles Installationsskript, prüft die Prüfsumme) …"
  curl -fsSL https://voicestudio.sh/install | sh
fi
ok "VoiceStudio installiert"
if ! curl -fsS -m 3 "$VS_URL/health" >/dev/null 2>&1; then
  open -a VoiceStudio
  hinweis "VoiceStudio startet. Beim ersten Start lädt es Python und die Stimmenmodelle (ca. 2–5 GB)."
  hinweis "Falls macOS fragt: Rechtsklick auf VoiceStudio → Öffnen. Die Einrichtung im Fenster bitte durchklicken."
  for i in $(seq 1 180); do
    curl -fsS -m 3 "$VS_URL/health" >/dev/null 2>&1 && break
    sleep 10
  done
fi
curl -fsS -m 3 "$VS_URL/health" >/dev/null 2>&1 || stopp "VoiceStudio antwortet nicht auf Port 3900. Einrichtung im VoiceStudio-Fenster abschließen und das Skript nochmal starten."
ok "VoiceStudio läuft (Port 3900, nur lokal)"
osascript -e 'tell application "System Events" to if not (exists login item "VoiceStudio") then make login item at end with properties {path:"/Applications/VoiceStudio.app", hidden:true}' >/dev/null 2>&1 \
  && ok "VoiceStudio startet beim Anmelden automatisch" \
  || hinweis "Autostart bitte selbst setzen: Systemeinstellungen → Allgemein → Anmeldeobjekte → VoiceStudio"

# ── 1b. Sprach-Engine VoxCPM2 ───────────────────────────────────────
schritt "Sprach-Engine $TTS_MODEL"
hinweis "In VoiceStudio: Modellkatalog → TTS → VoxCPM2 → installieren und Lizenz (Apache 2.0) akzeptieren."
hinweis "Die OmniVoice-Lizenz NICHT akzeptieren – sie erlaubt keine geschäftliche Nutzung."
read -r -p "   VoxCPM2 installiert und Lizenz akzeptiert? [Enter] " _

# ── 2. Alistair-Stimme ───────────────────────────────────────────────
schritt "Stimme $VOICE_NAME"
mkdir -p "$PROBE_DIR"
CDN="https://d8j0ntlcm91z4.cloudfront.net/user_3EApQM9b8e9WVJaVhjLHajMjyj2"
CLIPS=(
  "hf_20261021_044622_e9a7c92a-40e0-4ab3-ba00-0c72a7d6ba33"
  "hf_20261021_044818_1a8cff78-53a4-40c4-99a6-fdabe5a3b6ea"
  "hf_20261021_044622_bf2e4715-cc24-44ba-ba40-a27b5c3a2853"
  "hf_20261021_044622_0e666c74-c5a4-40e0-96f7-f0aefd5a5d58"
  "hf_20261021_044622_771411a1-e8ca-47c2-9253-7d2a995435f1"
  "hf_20261021_044622_1d7329f5-4c31-4c11-9c95-b538b2818724"
  "hf_20261021_044622_df9b8623-6595-4141-96ea-06085e6f3e53"
)
for c in "${CLIPS[@]}"; do
  [ -s "$PROBE_DIR/$c.wav" ] || curl -fsSL -o "$PROBE_DIR/$c.wav" "$CDN/$c.wav"
done
/usr/bin/python3 -I - "$PROBE_DIR" <<'PY'
import glob, os, sys, wave
d = sys.argv[1]
files = sorted(f for f in glob.glob(os.path.join(d, "hf_*.wav")))
out = os.path.join(d, "alistair-probe.wav")
params = None; frames = []
for f in files:
    with wave.open(f) as w:
        p = w.getparams()
        if params is None: params = p
        if (p.nchannels, p.sampwidth, p.framerate) != (params.nchannels, params.sampwidth, params.framerate):
            continue
        frames.append(w.readframes(w.getnframes()))
        frames.append(b"\x00" * params.sampwidth * params.nchannels * int(params.framerate * 0.4))  # kurze Pause
with wave.open(out, "wb") as w:
    w.setnchannels(params.nchannels); w.setsampwidth(params.sampwidth); w.setframerate(params.framerate)
    for fr in frames: w.writeframes(fr)
with wave.open(out) as w:
    print(f"   ✓ Probe: {w.getnframes() / w.getframerate():.1f} Sekunden")
PY
if curl -fsS -m 10 "$VS_URL/profiles" | /usr/bin/python3 -I -c "import json,sys; sys.exit(0 if any(p.get('name','').lower()=='alistair' for p in json.load(sys.stdin)) else 1)" 2>/dev/null; then
  ok "Stimmprofil $VOICE_NAME gibt es schon"
elif curl -fsS -m 120 -F "name=$VOICE_NAME" -F "kind=clone" -F "ref_audio=@$PROBE_DIR/alistair-probe.wav;type=audio/wav" "$VS_URL/profiles" >/dev/null 2>&1; then
  ok "Stimmprofil $VOICE_NAME angelegt"
else
  hinweis "Bitte in VoiceStudio selbst anlegen: Stimme klonen → Datei $PROBE_DIR/alistair-probe.wav → Name: $VOICE_NAME"
  open "$PROBE_DIR"
fi

# ── 3. Token + Torwächter ───────────────────────────────────────────
schritt "Torwächter (lässt nur Sprechen und Zuhören mit Token durch)"
mkdir -p "$APP_DIR"; chmod 700 "$APP_DIR"
if [ ! -s "$APP_DIR/token" ]; then
  openssl rand -hex 32 > "$APP_DIR/token"
fi
chmod 600 "$APP_DIR/token"
TOKEN="$(cat "$APP_DIR/token")"
cat > "$APP_DIR/proxy.py" <<'PROXY'
__PROXY_PY__
PROXY
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$AGENT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$AGENT_ID</string>
  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>-I</string><string>$APP_DIR/proxy.py</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$APP_DIR/proxy.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$AGENT_ID" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$AGENT_PLIST"
sleep 2
curl -fsS -m 3 "http://127.0.0.1:$PROXY_PORT/health" >/dev/null || stopp "Torwächter startet nicht – siehe $APP_DIR/proxy.log"
ok "Torwächter läuft (Port $PROXY_PORT, startet automatisch)"

# ── 4. Tailscale Funnel ─────────────────────────────────────────────
schritt "Tailscale Funnel (feste Adresse fürs Internet)"
TS=""
for c in tailscale /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
  if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then TS="$c"; break; fi
done
if [ -z "$TS" ]; then
  open "https://tailscale.com/download/mac"
  stopp "Tailscale fehlt. Bitte installieren, mit Google-Konto anmelden, dann das Skript nochmal starten."
fi
"$TS" status >/dev/null 2>&1 || { hinweis "Tailscale-Anmeldung im Browser …"; "$TS" up; }
HOST="$("$TS" status --json | /usr/bin/python3 -I -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
[ -n "$HOST" ] || stopp "Tailscale-Adresse nicht gefunden."
if ! "$TS" funnel --bg "$PROXY_PORT"; then
  stopp "Funnel ist im Tailscale-Konto noch nicht freigeschaltet. Den Link oben öffnen, Funnel erlauben, dann das Skript nochmal starten."
fi
ok "Öffentlich erreichbar: https://$HOST"
for i in 1 2 3 4 5 6; do
  curl -fsS -m 10 "https://$HOST/health" >/dev/null 2>&1 && break
  sleep 10
done
curl -fsS -m 10 "https://$HOST/health" >/dev/null 2>&1 && ok "Von außen getestet" || hinweis "Die Adresse braucht manchmal ein paar Minuten, bis sie erreichbar ist."

# ── 5. Kurztest Sprechen ─────────────────────────────────────────────
schritt "Probe: Alistair spricht (beim ersten Mal lädt VoxCPM2, das kann einige Minuten dauern)"
if curl -fsS -m 1500 -H "X-Arion-Token: $TOKEN" -H "content-type: application/json" \
  -d "{\"model\":\"$TTS_MODEL\",\"voice\":\"$VOICE_NAME\",\"language\":\"de\",\"input\":\"Guten Tag, Sir. Die Stimme von ARION läuft jetzt auf Ihrem Mac.\",\"response_format\":\"mp3\"}" \
  -o "$APP_DIR/probe.mp3" "http://127.0.0.1:$PROXY_PORT/v1/audio/speech"; then
  afplay "$APP_DIR/probe.mp3" || true
  ok "Stimme klingt? Dann passt alles."
else
  hinweis "Sprechen hat nicht geklappt – in VoiceStudio prüfen: VoxCPM2 installiert und Lizenz akzeptiert, Profil $VOICE_NAME vorhanden."
fi

# ── 6. Werte für Vercel ─────────────────────────────────────────────
schritt "In Vercel eintragen (Arion OS → Settings → Environment Variables), dann neu deployen"
WERTE="ARION_TTS_URL=https://$HOST
ARION_STT_URL=https://$HOST
ARION_TTS_VOICE=$VOICE_NAME
ARION_TTS_MODEL=$TTS_MODEL
ARION_TTS_TIMEOUT_MS=45000
ARION_TUNNEL_TOKEN=$TOKEN"
printf '%s\n' "$WERTE"
printf '%s\n' "$WERTE" | pbcopy && hinweis "Die Zeilen liegen auch in der Zwischenablage. Vercel nimmt sie per Einfügen in das erste Feld."
hinweis "Den Token niemandem schicken und nicht in Mails oder Chats einfügen."
printf '\nFertig. Der Mac sollte nicht in den Ruhezustand gehen (Systemeinstellungen → Energie).\n'
