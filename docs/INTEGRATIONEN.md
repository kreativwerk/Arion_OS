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

## 2. Mail-Digest aus mehreren IMAP-Postfächern

Ziel: nicht *alle* Mails, sondern **nur Treffer** der Regeln aus dem Mail-Modul
(VIP-Absender wie `arval.de`, Stichwörter wie „Rechnung", „Kündigung").

Empfohlene Umsetzung als Cron-Job (z.B. alle 15 Minuten):

1. Pro Postfach per IMAP (`imapflow`) ungelesene Mails seit dem letzten Lauf holen.
   Zugangsdaten pro Konto in `.env.local`:
   ```
   MAIL_1_HOST=imap.strato.de
   MAIL_1_USER=info@arion-logistics.de
   MAIL_1_PASS=***
   MAIL_2_HOST=imap.gmail.com
   ...
   ```
2. Regeln aus `GET /api/data/mail_rules` laden, Absender/Betreff/Body matchen.
3. Treffer mit der Claude API in 1–2 Sätzen zusammenfassen.
4. `POST /api/data/mail_digest` mit `{account, from_addr, subject, summary, matched_rule, important: 1}`.

Bei Gmail/Microsoft 365 App-Passwörter bzw. OAuth verwenden. Die Mails selbst bleiben im
Postfach – Arion OS speichert nur die Zusammenfassung.

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
