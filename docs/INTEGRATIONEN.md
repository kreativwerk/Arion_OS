# Integrationen

Alle Integrationen folgen demselben Muster: **ein Zulieferer-Prozess sammelt Daten und
schreibt sie per HTTP in den Datenkern** (`/api/data/...`). Die App bleibt dadurch schlank
und jede Integration ist unabhängig austauschbar.

Konfiguration über `.env.local` (Vorlage: `.env.example`).

---

## 1. Arion Bot mit Claude API (empfohlener erster Schritt)

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5   # optional
```

Mehr ist nicht nötig. `lib/assistant/engine.ts` stellt pro Frage den relevanten
Datenkontext zusammen (Aufgaben, Verträge, Wissen, Post, Mails, Termine, Slack, Portale)
und schickt ihn als System-Prompt an die Claude API. Ohne Key antwortet Arion Bot
deterministisch aus der Datenbank.

## 2. Mail-Abruf per IMAP (eingebaut) – Digest + Wissens-Extraktion

Der Abruf ist fest eingebaut (`lib/mail-fetch.ts`). Er läuft täglich über Vercel Cron
(`vercel.json` → `/api/cron/mail`) und jederzeit manuell über **„Jetzt abrufen“** im
Mail-Modul. Pro Lauf passiert dreierlei:

1. **Neue Mails holen** (letzte Tage, max. 25 pro Konto, Dedupe über `mail_seen`).
   Die Mails bleiben im Postfach und werden nicht als gelesen markiert.
2. **Digest:** Treffer der Wichtig-Regeln (VIP-Absender, Stichwörter) landen mit
   Ein-Satz-Zusammenfassung im Mail-Modul.
3. **Wissen:** Ist `ANTHROPIC_API_KEY` gesetzt, extrahiert Claude aus **allen** neuen
   Mails dauerhaft Nützliches (Fristen, Preise, Ansprechpartner, Vorgänge) und legt es
   als Notizen in der Wissensbasis ab (Tag `email-import`, Quelle im Text).

**Postfächer verbindest du direkt in der App:** Mail-Modul → Karte „Postfächer“ →
Anbieter wählen (IONOS/GMX/Andere), E-Mail-Adresse + Passwort eingeben,
**„Verbinden & speichern“**. Die Verbindung wird sofort getestet; die Zugangsdaten
liegen AES-256-verschlüsselt in der Datenbank (Schlüssel aus `AUTH_SECRET` bzw.
`APP_PASSWORD` – deshalb gehört eines von beiden gesetzt; ändert man es später,
müssen die Postfach-Passwörter einmal neu eingegeben werden).

Alternativ (oder zusätzlich) gehen Umgebungsvariablen – auf Vercel unter
*Settings → Environment Variables*, lokal in `.env.local`:

```
MAIL_1_LABEL=IONOS
MAIL_1_HOST=imap.ionos.de
MAIL_1_USER=info@arion-logistics.de
MAIL_1_PASS=<normales Postfach-Passwort>

MAIL_2_LABEL=GMX
MAIL_2_HOST=imap.gmx.net
MAIL_2_USER=<deine GMX-Adresse>
MAIL_2_PASS=<GMX-Passwort>
```

Anbieter-Hinweise:
- **IONOS:** Host `imap.ionos.de`, Port 993 (Standard), Benutzer = vollständige
  E-Mail-Adresse, normales Postfach-Passwort.
- **GMX:** Host `imap.gmx.net`, Port 993. IMAP muss einmalig aktiviert werden:
  GMX-Webmail → E-Mail → Einstellungen → POP3/IMAP Abruf → „IMAP aktivieren“.
- Gmail/Microsoft 365: App-Passwörter bzw. OAuth verwenden.

Außerdem `CRON_SECRET` setzen (beliebige lange Zufallszeichenkette) – Vercel schickt es
automatisch als Bearer-Token an den Cron-Endpunkt; ohne bleibt `/api/cron/mail` gesperrt.
Nach dem Setzen der Variablen: **Redeploy**.

**Regel-Vorschläge aus dem Postfach:** Der Button „Vorschläge“ in der Karte
„Wichtig-Regeln“ analysiert den Gesendet-Ordner der verbundenen Konten (letzte
120 Tage, nur Kopfdaten – keine Inhalte): Wem antwortest du oft → VIP-Absender-
Vorschläge; häufige Wörter aus deinen Betreffzeilen → Stichwort-Vorschläge.
Eigene Adressen, no-reply-Absender und bereits vorhandene Regeln werden
ausgefiltert; ein Tipp auf einen Vorschlag übernimmt ihn als Regel.

## 3. Briefpost-Scans vom Mitarbeiter

Heute: Der Mitarbeiter erfasst den Scan über „Scan erfassen" im Post-Modul (oder per
`POST /api/data/letters`).

Ausbaustufe:

- Eigener passwortgeschützter Upload-Link (eine kleine Route `/scan-upload`), der PDF +
  Foto entgegennimmt und unter `data/letters/` ablegt (`file_ref`).
- Automatische Zusammenfassung: PDF-Text extrahieren, per Claude API zusammenfassen und
  Betreff/Absender/Kategorie vorschlagen.
- Alternativ: dediziertes Scan-Postfach (z.B. `post@arion-logistics.de`) – der
  Mitarbeiter mailt den Scan, der Mail-Digest-Job legt daraus den Brief an.

## 4. Kalender (Google / Outlook / iCloud)

Eigene Einträge leben lokal (`calendar_events`, `source='lokal'`). Externe Kalender werden
read-only per **ICS-Feed** gespiegelt:

```
ICS_FEEDS=https://calendar.google.com/calendar/ical/…/basic.ics,https://outlook.office365.com/…/calendar.ics
```

Ein Cron-Job lädt die Feeds (z.B. mit `node-ical`), löscht alte `source='ics'`-Einträge
und schreibt die aktuellen Termine neu. So gibt es nie Konflikte mit eigenen Einträgen.

## 5. Slack – nur wichtige Personen

1. Slack-App im Workspace anlegen → **Event Subscriptions** aktivieren
   (`message.channels`, `message.im`).
2. Request-URL auf eine neue Route `/api/integrations/slack` zeigen lassen
   (Signatur mit `SLACK_SIGNING_SECRET` prüfen).
3. Absender gegen `GET /api/data/slack_rules` matchen; nur Treffer als
   `POST /api/data/slack_notifications` speichern (`important: 1`).

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

## 6. Portal-Watcher (Vendor Central, Arval, LeasePlan, Elster …)

Portale ohne API werden per **Playwright-Job** geprüft:

- Pro Portal ein kleines Skript: Login (Credentials aus `.env.local`), Zielseite öffnen,
  relevante Zahl/Liste auslesen (z.B. „offene Bestellungen"), mit dem letzten Stand
  vergleichen.
- Bei Änderung: `POST /api/data/watcher_events` mit `{watcher_id, title, detail}`.
- Zeitplan gemäß `interval_minutes` des Watchers (Cron oder systemd-Timer).

Wichtig: Zwei-Faktor-Portale brauchen ggf. App-Passwörter oder eine gespeicherte Session.
Meldungen können auch aus anderen Quellen (Zapier, Make, E-Mail-Parser) eingespeist
werden – es ist nur ein HTTP-POST.

## 7. Betrieb

- **Lokal / Mac mini im Büro:** `npm run build && npm start`, Cron-Jobs via `crontab`.
- **Server (VPS):** Node 20+, hinter Caddy/nginx mit Basic-Auth oder VPN – die App hat
  bewusst keinen eigenen Login (Single-User) und gehört nicht ungeschützt ins Internet.
- **Backup:** `data/arion.db` sichern (eine Datei genügt).
