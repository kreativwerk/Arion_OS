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

Bis zu acht Konten (`MAIL_1_…` bis `MAIL_8_…`). PDF- und Bild-Anhänge neuer Mails
landen zusätzlich im Buchhaltungs-Eingang – Details in `docs/BUCHHALTUNG.md`.

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

### 2a. Postfach: alle Mails lesen, suchen, antworten (ersetzt Thunderbird)

Seite **/postfach**. Jeder Abruf-Lauf nutzt das restliche Zeitbudget, um **komplette
Mails** aller verbundenen Postfächer in die Datenbank zu kopieren (`lib/mail-archive.ts`):
Posteingang, Gesendet und eigene Ordner; Papierkorb, Spam und Entwürfe nicht.

- **Nur lesend:** Im Postfach wird nichts gelöscht, verschoben oder als gelesen markiert.
- **Neu zuerst, dann rückwärts:** Pro Konto und Ordner merkt sich `mail_sync`, bis wohin
  archiviert ist. Neue Mails kommen in jedem Lauf; ältere werden nach und nach
  nachgeladen, bis `MAIL_ARCHIVE_DAYS` (Standard 400 Tage) erreicht ist.
- **Anhänge** bleiben auf dem Server; die Liste steht in `mails.attachments`, der
  Download läuft live über `/api/mail/attachment`.
- **HTML-Originalansicht** im Sandbox-iframe ohne Skripte und ohne externe Bilder (kein Tracking).

**Antworten und Versand:** „Antworten“ legt einen Entwurf an (`mail_drafts`, Empfänger,
„Re:“-Betreff, Threading-Header und Absender-Postfach automatisch). Versendet wird **nur**
über den Button „Senden“ in der App (`/api/mail/drafts/send`, Session-Login; ohne
`APP_PASSWORD` ist der Versand auf Vercel gesperrt). SMTP-Server werden aus dem
IMAP-Server abgeleitet (IONOS `smtp.ionos.de:465`, GMX `mail.gmx.net:465`), Zugangsdaten
sind dieselben wie für IMAP. Die gesendete Mail wird per IMAP in „Gesendet“ abgelegt und
das Original als beantwortet markiert. Entwürfe werden nie gelöscht, nur „verworfen“.
Absendername pro Postfach: `mail_accounts.display_name` (PATCH `/api/mail/accounts`).

**Entwürfe von Claude:** Claude kann Entwürfe direkt per SQL anlegen
(`source = 'claude'`, `note` = kurze Erklärung); sie erscheinen unter „Entwürfe“ mit
dem Hinweis „von Claude“ und gehen erst nach deinem Tipp auf „Senden“ raus.

**Automatischer Abruf alle 10 Minuten (kostenlos, unabhängig vom Vercel-Plan)** –
im Supabase-Projekt „Arion OS“ → SQL Editor, einmalig:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Wert von CRON_SECRET aus Vercel einsetzen (liegt danach verschlüsselt im Vault)
select vault.create_secret('<CRON_SECRET>', 'arion_cron_secret');
select cron.schedule(
  'arion-postfach-10min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://<DEINE-APP>.vercel.app/api/cron/mail',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'arion_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
```

Die Seite /postfach aktualisiert sich zusätzlich jede Minute selbst, solange sie offen ist.

### Tagesbericht um 9 Uhr (Push + Mail)

`lib/tagesbericht.ts` läuft im Mail-Cron (pg_cron alle 10 Minuten) und schickt ab 9:00 Uhr Berliner
Zeit einmal pro Tag einen Bericht – als Push aufs Handy und als Mail an info@arion-logistics.de
(gesendet über dasselbe Postfach, Entwurf mit `source = 'tagesbericht'`).

Inhalt:
- **Fristen:** überfällig und in den nächsten 7 Tagen (Aufgaben, Claude-Fälle mit „Frist:“-Zeile,
  Buchhaltung, Verträge, Termine – dieselbe Quelle wie die Fristen-Ampel der Startseite).
- **SD Worx:** neue Posts, Erwähnungen und gelöste Fälle aus den Benachrichtigungs-Mails des
  Kundenportals seit dem letzten Bericht, Mails von SD-Worx-Mitarbeitern und die letzte Übersicht aus
  dem Buddy-Aufgabenzentrum. Den „To Dos“-Zähler im Portal sieht Arion OS nicht (nur mit Login).
- **Wartet auf dich:** offene Mail-Entwürfe.

Doppelversand verhindert `app_config.tagesbericht_tag` (atomares Upsert), das Fenster für SD Worx
steht in `app_config.tagesbericht_seit`. Abschalten: `ARION_TAGESBERICHT=aus`; anderer Empfänger:
`ARION_TAGESBERICHT_AN`.

## 3. Briefpost-Scans vom Mitarbeiter

Heute: Im Post-Modul werden beliebig viele Scans (PDF, JPG, PNG, GIF, WebP, HEIC – je max.
20 MB) auf einmal hochgeladen (Drag & Drop oder Dateiauswahl). Fotos verkleinert der
Browser vorab auf max. 2400 px (JPEG). Vercel nimmt pro Request nur ~4,5 MB an – größere
Dateien gehen deshalb in 3-MB-Stücken hoch: `POST /api/letters` legt den Brief mit dem
ersten Stück an, `PUT /api/letters/:id` hängt die weiteren an (`offset`, `final=1` beim
letzten). Der Scan liegt als Blob in `letter_blobs`.

Mit `ANTHROPIC_API_KEY` zerlegt Claude einen Stapelscan (mehrere Briefe in einer PDF,
z.B. die komplette Tagespost) zuerst in einzelne Briefe – jeder wird ein eigener Eintrag
mit eigenem PDF („Scan (S. 3–4).pdf“). Danach liest Claude jeden Brief einzeln und
füllt Absender, Betreff, Anliegen, „Was ist zu tun?“, Kategorie, Frist und
Aktenzeichen. Der Volltext wird in `letters.extracted` (JSON) gespeichert.

- `GET /api/letters/:id` – Original-Scan öffnen
- `POST /api/letters/:id` – KI-Analyse erneut ausführen (zerlegt ggf. auch erneut)
- `DELETE /api/letters/:id` – Brief samt Scan löschen
- Modell: `ANTHROPIC_MODEL` (Standard `claude-opus-5-5`)

Die Liste ist nach Absender gruppiert; jeder Brief lässt sich bearbeiten und als erledigt
markieren (Status `archiv`).

### Briefkasten-Scan (Drucker → Google Drive „Letterbox“ → Post-Modul)

Läuft **ohne Büro-Mac**. Die komplette Tagespost wird geöffnet, als ein Stapel in den
Einzug gelegt und am Drucker per **Brother Web Connect → Google Drive** in den Ordner
**„Letterbox“** gescannt (am besten als Shortcut „Briefkasten“ auf dem Display).

```
Brother MFC-L8390CDW ──Web Connect──▶ Google Drive: Letterbox ◀── pg_cron alle 5 Min
                                                                    /api/cron/letterbox
                                       Letterbox/_verarbeitet ◀──── Datei wird verschoben
                                                                    Claude zerlegt den Stapel,
                                                                    liest jeden Brief, ordnet
                                                                    die Firma zu → /post + Push
```

- **Firma:** Claude ordnet jeden Brief nach dem Empfänger im Anschriftenfeld zu – Arion,
  Fleet Fix, Kreativwerk, Wohnwerk, Privat oder Unklar (`letters.firma`). Auf `/post`
  filtert eine Leiste nach Firma; im Bearbeiten-Dialog lässt sie sich korrigieren.
- **Ordner:** `DRIVE_LETTERBOX_ID` (Env) oder `app_config.letterbox_folder_id`; ohne
  Angabe sucht Arion OS den Drive-Ordner „Letterbox“ und merkt sich die ID. Arion OS
  braucht Zugriff darauf (gleiches Google-Konto wie „Mit Google verbinden“ oder Ordner
  dafür freigegeben).
- Übernommen werden PDF/JPG/PNG bis 20 MB, frühestens 60 s nach dem Upload. Die Datei
  wandert danach nach `Letterbox/_verarbeitet` – **gelöscht wird nichts**. Bereits
  übernommene Dateien erkennt Arion OS an `letters.drive_file_id`.
- Analyse-Fehler landen in `letters.analysis_error` (kein Endlos-Wiederholen);
  „Neu analysieren“ auf `/post` versucht es erneut.
- **Abruf:** pg_cron ruft `/api/cron/letterbox` alle 5 Minuten (CRON_SECRET), sofort
  über „Briefkasten abrufen“ auf `/post`. Nach der Analyse kommt ein Push
  „Briefkasten: N neue Briefe · M mit To-do“ mit den Firmen.

```sql
-- pg_cron (Supabase), Muster wie der Mail-Abruf
select cron.schedule('arion-letterbox', '*/5 * * * *', $$
  select net.http_post(url := 'https://arion-os.vercel.app/api/cron/letterbox',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'), timeout_milliseconds := 300000)
$$);
```

Ausbaustufe:

- Antworten/Formulare automatisch mit Firmendaten ausfüllen – Grundlage ist der
  gespeicherte Volltext plus ein Firmenprofil (Anschrift, Steuernummer, USt-IdNr., IBAN …).
- Eigener passwortgeschützter Upload-Link für den Mitarbeiter.
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
