# ARION – Sprachassistent („Hey ARION“)

ARION ist die Sprachschnittstelle von Arion OS: Knopf halten, Frage stellen,
Antwort hören – mit Live-Daten aus Buchhaltung, Mail-Digest und Aufgaben.
Die Seite **`/arion`** ist ein Vollbild-HUD und läuft als installierte PWA auf
dem iPhone genauso wie am Desktop.

Dieses Dokument beschreibt den **Web-/PWA-Teil** (fertig) und wie der
**Mac-Teil** (VoiceStudio-Stimme, Whisper, Wake Word) später andockt.

---

## Architektur

```
 iPhone / Browser (/arion)                     Arion OS (Next.js, Vercel)                 Mac (später, per Tunnel)
 ─────────────────────────                     ──────────────────────────                 ────────────────────────
 Knopf halten / Leertaste / Wake-Event
   │
   ├─ STT 1: Web Speech API (de-DE, live) ───┐
   └─ STT 2: MediaRecorder ──► POST /api/arion/stt ──► ARION_STT_URL ──────────────────► Whisper (/v1/audio/transcriptions)
                                             │
                   Text ──► POST /api/arion/ask ──► lib/arion-brain.ts
                                             │        ├─ Claude + Tool Use (ANTHROPIC_API_KEY)
                                             │        │    └─ lib/arion-tools.ts → Datenkern (lib/db.ts)
                                             │        └─ ohne Key / bei Fehler: lokaler Fallback
                                             │
   ◄── { answer, spokenAnswer, actions } ────┘
   │
   ├─ TTS 1: POST /api/arion/tts ──► ARION_TTS_URL ─────────────────────────────────────► VoiceStudio (/v1/audio/speech)
   └─ TTS 2: speechSynthesis (deutsche Browser-Stimme)
```

### Bausteine im Code

| Datei | Aufgabe |
|---|---|
| `app/arion/page.tsx` | HUD: Reaktor, Push-to-Talk, Live-Transkript, Antwortkarten, Kennzahl-Kacheln, Wake-Hook |
| `components/arion/Reactor.tsx` | Canvas-Animation (eigenes Motiv), reagiert auf `idle/listening/thinking/speaking` und den Audiopegel |
| `components/arion/useArionVoice.ts` | Browser-Audio: Web Speech API, MediaRecorder-Fallback, TTS-Wiedergabe über AudioContext, speechSynthesis-Fallback, AnalyserNode-Pegel |
| `lib/arion-brain.ts` | „Gehirn“: Systemprompt, Tool-Use-Schleife (max. 5 Runden), Gesprächsverlauf, lokaler Fallback |
| `lib/arion-tools.ts` | Werkzeuge mit Live-Daten: `buchhaltung_ueberblick`, `wichtige_mails`, `offene_aufgaben`, `aufgabe_anlegen`, `daten_suchen` |
| `lib/arion-speech.ts` | Sprechtext: Markdown raus, `1.745,86 €` → „1.745 Euro 86“, Daten → „10. November“/„morgen“ (getestet) |
| `lib/arion-tts.ts` | Server-Proxy zu TTS/STT (OpenAI-kompatibel), Timeouts, Tunnel-Header |
| `app/api/arion/*` | `ask`, `tts`, `stt`, `status` |

### API

| Route | Ein/Aus |
|---|---|
| `POST /api/arion/ask` | `{ text, mode: 'voice' \| 'text', conversationId? }` → `{ answer, spokenAnswer, actions, conversationId, source }` |
| `POST /api/arion/tts` | `{ text }` → `audio/mpeg` (gestreamt). `501` ohne `ARION_TTS_URL`, `502` bei Fehler/Timeout (15 s) |
| `POST /api/arion/stt` | `multipart/form-data` mit `file` → `{ text }`. `501` mit deutschem Hinweis ohne `ARION_STT_URL` |
| `GET /api/arion/status` | `{ ki, tts, stt, kennzahlen }` – nur Ja/Nein, nie URLs oder Tokens |

`actions` enthält z. B. `{ type: 'task_created', id, title, due_date }` oder
`{ type: 'open', href: '/buchhaltung', label }` – die HUD zeigt sie als Chips.

**Modi:** `voice` → höchstens zwei, drei Sätze, kein Markdown, Beträge so wie
gesprochen. `spokenAnswer` wird zusätzlich serverseitig durch
`toSpokenText()` normalisiert und auf wenige Sätze begrenzt – auch wenn das
Modell sich nicht an die Vorgabe hält.

**Gedächtnis:** Tabelle `assistant_messages`, neue Spalte `conversation_id`
(per `ensureSchema`, `ADD COLUMN IF NOT EXISTS`). Der Chat „Arion Bot“ nutzt
weiter die leere ID; jedes ARION-Gespräch eine eigene (`arion-<uuid>`, pro Tab
in `sessionStorage`, „Neues Gespräch“ setzt sie zurück). Die letzten 12
Nachrichten gehen als Verlauf mit.

**Ohne `ANTHROPIC_API_KEY`** antwortet ARION trotzdem: einfache
Intent-Erkennung (Buchhaltung, Mails, Aufgaben, „Erinnere mich …“ legt eine
Aufgabe an) auf denselben Datenfunktionen, sonst ein kurzer Überblick plus
Hinweis auf den fehlenden Schlüssel. Fällt die Claude-API aus, gilt dasselbe.

---

## Bedienung

- **Knopf halten** → sprechen → loslassen = Push-to-Talk.
- **Kurz tippen** → Freihand: hört zu, bis ~1,7 s Sprechpause (oder 8 s Stille, max. 20 s).
  Erneut tippen beendet.
- **Desktop:** Leertaste halten (nicht, wenn ein Eingabefeld fokussiert ist).
- **Tastatur-Symbol:** Frage tippen. **Lautsprecher-Symbol:** Stimme an/aus.
  **Wiederholen-Symbol:** letzte Antwort erneut vorlesen bzw. Vorlesen stoppen.
- Drücken während ARION spricht unterbricht sofort.

### iPhone (PWA)

- Spracherkennung: Safari/WebKit bietet `webkitSpeechRecognition` (de-DE) ab
  iOS 14.5, in der installierten PWA je nach iOS-Version eingeschränkt
  („Diktieren“ muss in den iOS-Einstellungen aktiv sein). Meldet WebKit
  `service-not-allowed`, schaltet ARION automatisch auf **Aufnahme + Server-
  Erkennung** um (braucht `ARION_STT_URL`).
- Audio wird beim ersten Tippen freigeschaltet (iOS-Vorgabe); die Server-Stimme
  wird über einen `AudioContext` abgespielt, damit auch nach dem Netzwerkabruf
  ohne erneute Geste gesprochen werden kann.
- Safe Areas (Notch, Home-Indikator) sind berücksichtigt; nichts hängt an Hover.

---

## Weckruf „Hey ARION“ (Browser)

Auf der ARION-Seite schaltet das Ohr-Symbol oben rechts den Weckruf ein (pro Gerät gemerkt).
Solange die Seite offen und sichtbar ist, hört eine eigene Spracherkennung (Web Speech API,
de-DE) auf „Hey/Hallo/Okay ARION“ oder „ARION“ am Satzanfang (`lib/arion-wake.ts`). Dann:

1. Clip in der Butler-Stimme Alistair – erster Weckruf des Tages „Guten Morgen/Tag/Abend, Sir.“,
   sonst „Zu Diensten, Sir.“ (Clips: `CLIP_URLS` in `lib/arion-wake.ts`),
2. ARION hört im Freihand-Modus zu, antwortet und schläft danach wieder auf das Weckwort.

Während ARION zuhört/denkt/spricht ist der Weckruf pausiert. Funktioniert in Chrome/Edge am
Mac und auf Android; auf dem iPhone blendet die Seite den Schalter aus (Safari beendet
Dauer-Erkennung). Für „immer an“ ohne offene Seite bleibt der Wake-Hook oben für einen
späteren Mac-Helfer.

## Umgebungsvariablen

Alle optional – ohne sie läuft ARION mit Browser-Spracherkennung und Browser-Stimme.

| Variable | Zweck | Beispiel |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude mit Tool Use (sonst lokaler Fallback) | `sk-ant-…` |
| `ARION_MODEL` | Modell nur für ARION (sonst `ANTHROPIC_MODEL`, sonst `claude-sonnet-5`) | `claude-sonnet-5` |
| `ELEVENLABS_API_KEY` | ElevenLabs-Schlüssel – hat Vorrang vor `ARION_TTS_URL`, läuft ohne Mac | `sk_…` |
| `ELEVENLABS_VOICE_ID` | Stimme aus der ElevenLabs-Voice-Library (Butler-Stimme) | `JBFqnCBsd6RMkjVDRZzb` |
| `ELEVENLABS_MODEL` | Modell (Standard `eleven_multilingual_v2`, spricht Deutsch) | `eleven_multilingual_v2` |
| `ARION_TTS_URL` | OpenAI-kompatibler TTS-Endpunkt (Basis-URL oder voller Pfad `/v1/audio/speech`) | `https://voice.example.com` |
| `ARION_TTS_VOICE` | Stimmenname, wie ihn der TTS-Server erwartet (Standard `alloy`) | `arion` |
| `ARION_TTS_MODEL` | Modellname für den TTS-Server (Standard `tts-1`) | `voxcpm2` |
| `ARION_TTS_TIMEOUT_MS` | Wartezeit auf die Stimme in ms (Standard 15000, max. 55000) | `45000` |
| `ARION_STT_URL` | OpenAI-kompatibler STT-Endpunkt (Basis-URL oder `/v1/audio/transcriptions`) | `https://voice.example.com` |
| `ARION_STT_MODEL` | Modellname für Whisper (Standard `whisper-1`) | `whisper-1` |
| `ARION_TUNNEL_TOKEN` | Geheimnis für den Tunnel – wird als `X-Arion-Token` **und** `Authorization: Bearer …` mitgeschickt | (langer Zufallswert) |

Gesendet wird an TTS: `{ model, input, voice, response_format: 'mp3' }`;
an STT: `multipart` mit `file`, `model`, `language=de`, `response_format=json`.

Auf Vercel unter *Settings → Environment Variables* setzen und neu deployen.
Hinweis: Vercel begrenzt Request-Bodies auf ~4,5 MB – das reicht für
Sprachaufnahmen von deutlich über einer Minute (Opus/AAC).

---

## Günstige Cloud-Stimme: OpenAI

Ohne Mac und deutlich billiger als ElevenLabs (tts-1: 15 $ pro 1 Mio. Zeichen,
gpt-4o-mini-tts ≈ 0,015 $ pro Minute). Die OpenAI-API ist selbst der
OpenAI-kompatible Endpunkt, der Schlüssel geht als Bearer über `ARION_TUNNEL_TOKEN`:

| Variable | Wert |
|---|---|
| `ARION_TTS_URL` / `ARION_STT_URL` | `https://api.openai.com` |
| `ARION_TTS_MODEL` | `gpt-4o-mini-tts` |
| `ARION_TTS_VOICE` | z. B. `onyx` oder `ash` |
| `ARION_STT_MODEL` | `gpt-4o-mini-transcribe` |
| `ARION_TUNNEL_TOKEN` | OpenAI-API-Key (`sk-…`) |

An `api.openai.com` schickt ARION kein `language`-Feld beim Sprechen (das kennt nur VoiceStudio).

## Stimme vom Büro-Mac: VoiceStudio + Tailscale Funnel

Statt ElevenLabs spricht ARION mit der Butler-Stimme **Alistair** aus
[VoiceStudio](https://github.com/debpalash/VoiceStudio) auf dem Büro-Mac, Engine **VoxCPM2**
(Apache 2.0, geschäftlich erlaubt, Deutsch, Klonen). Die Standard-Engine OmniVoice ist
CC-BY-NC und darf für Arion nicht genutzt werden – ihre Lizenz in VoiceStudio nicht akzeptieren.
Voraussetzung: Apple-Chip, macOS 13.3+. VoiceStudio liefert beides OpenAI-kompatibel:
`/v1/audio/speech` (Sprechen) und `/v1/audio/transcriptions` (Zuhören, damit
klappt die Spracherkennung auch auf dem iPhone).

Einrichtung: `mac/arion-voice/build.sh` baut `dist/arion-stimme-einrichten.command`,
die Datei auf dem Mac einmal im Terminal starten. Sie

1. installiert VoiceStudio (offizielles Installationsskript) und startet es beim Anmelden,
2. schneidet aus den Alistair-Sätzen (`CLIP_URLS`) eine Probe und legt das Stimmprofil „Alistair“ an,
3. startet den **Torwächter** `proxy.py` (127.0.0.1:3901, LaunchAgent): nur
   `POST /v1/audio/speech` und `POST /v1/audio/transcriptions`, nur mit `X-Arion-Token`
   (Vergleich in konstanter Zeit), max. 10 MB, alles andere 401/404,
4. veröffentlicht den Torwächter per `tailscale funnel` unter `https://<mac>.ts.net`,
5. spielt eine Probe ab und gibt die vier Werte für Vercel aus:
   `ARION_TTS_URL`, `ARION_STT_URL` (beide die ts.net-Adresse), `ARION_TTS_VOICE=Alistair`,
   `ARION_TTS_MODEL=voxcpm2`, `ARION_TTS_TIMEOUT_MS=45000` (lokales Modell braucht länger als 15 s),
   `ARION_TUNNEL_TOKEN`.

**Warum der Torwächter nötig ist:** Funnel leitet an `localhost` weiter, VoiceStudio
behandelt Anfragen von `localhost` als vertrauenswürdig und verlangt dann keinen
Schlüssel. Ohne Torwächter wäre die ganze VoiceStudio-API (auch Verwaltung und
Stimmen-Klonen) öffentlich. VoiceStudio selbst rät von Funnel ab – deshalb hängt nur
der Torwächter am Funnel, nie Port 3900.

`ELEVENLABS_*` nicht setzen, sonst hat ElevenLabs Vorrang. Ist der Mac aus, fällt
ARION still auf Browser-Stimme und -Erkennung zurück.

## Der Mac-Teil (später)

Ziel: „Hey ARION“ am Mac, Antworten mit der eigenen VoiceStudio-Stimme, lokales
Whisper – ohne Cloud-Kosten. Stimme und Erkennung sind oben gelöst; offen ist der
Weckruf ohne offene Seite. Der Web-Teil ist darauf vorbereitet:

1. **VoiceStudio** stellt einen OpenAI-kompatiblen Endpunkt
   `POST /v1/audio/speech` bereit (Antwort `audio/mpeg`).
2. **Whisper** (z. B. `faster-whisper`/`whisper.cpp` mit OpenAI-kompatiblem
   Server) stellt `POST /v1/audio/transcriptions` bereit.
3. Beide hinter **einem Tunnel** (z. B. Cloudflare Tunnel, kostenlos) unter einer
   festen Adresse veröffentlichen. Ein kleiner Reverse-Proxy davor prüft den Header
   `X-Arion-Token` gegen `ARION_TUNNEL_TOKEN` und lehnt alles andere mit `401` ab.
4. In Vercel `ARION_TTS_URL`, `ARION_STT_URL`, `ARION_TTS_VOICE`,
   `ARION_TUNNEL_TOKEN` setzen. Ist der Mac aus, fällt die App still auf
   Browser-Stimme/-Erkennung zurück (TTS-Timeout 15 s, STT 30 s).
5. **Wake Word „Hey ARION“** über openWakeWord (eigenes Modell trainieren oder
   ein nahes Wort nehmen) in einem Mac-Helfer. Erkennt er das Wort, weckt er
   die geöffnete `/arion`-Seite über den **Wake-Hook**:

### Wake-Hook (endpunktunabhängig)

Die Seite `/arion` lauscht auf drei Wegen – alle starten das Zuhören im
Freihand-Modus (endet nach Sprechpause):

```js
// 1) BroadcastChannel – aus jedem anderen Tab/Fenster derselben Herkunft
new BroadcastChannel("arion").postMessage({ type: "arion:wake" });

// 2) window.postMessage – nur gleiche Herkunft (origin wird geprüft)
window.postMessage({ type: "arion:wake" }, location.origin);

// 3) Direkter Aufruf, z. B. aus einer WKWebView (evaluateJavaScript)
//    oder per AppleScript in Safari/Chrome („do JavaScript“ / „execute“)
window.arion.wake();
```

Analog beendet `{ type: "arion:stop" }` bzw. `window.arion.stop()` Zuhören und
Sprechen. Empfehlung für den Mac-Helfer: `/arion` in einer schlanken WKWebView
(oder einem App-Fenster von Chrome) offen halten und bei erkanntem Wake Word
`window.arion.wake()` ausführen. Browser verlangen für den Mikrofonzugriff eine
einmal erteilte Berechtigung; die Audioausgabe ohne vorherige Nutzergeste kann
eingeschränkt sein – im WKWebView mit `mediaTypesRequiringUserActionForPlayback = []`
entfällt das.

---

## Sicherheit

- **Alle `/api/arion/*`-Routen liegen hinter dem App-Login** (`middleware.ts`,
  Session-Cookie). Es gibt keine Ausnahme im Matcher.
- Der Browser kennt weder Tunnel-URL noch Token: TTS/STT laufen über den
  Server-Proxy, `GET /api/arion/status` meldet nur Ja/Nein.
- **Der Tunnel muss ein Geheimnis verlangen** (`X-Arion-Token`). Ohne diese
  Prüfung wäre der Mac-Sprachserver öffentlich erreichbar. Token lang und
  zufällig wählen, nur in Vercel-Env und auf dem Mac ablegen, nie ins Repo.
- `aufgabe_anlegen` ist das einzige schreibende Werkzeug; Eingaben werden
  gekürzt und validiert, die Aufgabe trägt die Quelle „ARION“.
- Eingaben an TTS werden auf 1.500 Zeichen begrenzt, STT-Uploads auf 8 MB.
- Der Wake-Hook kann nur das Zuhören starten/stoppen; `postMessage` wird nur
  von gleicher Herkunft angenommen.

---

## Tests

```bash
npm run test:arion   # Sprechtext, Beträge, Daten, Endpunkt-Auflösung
npm test             # alle Tests
```
