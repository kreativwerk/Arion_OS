# Buchhaltung – Belege, Abgleich, Drive-Ablage

Ziel: eine Belegpipeline, die **ohne lokalen Rechner** läuft. Arion OS (Vercel) holt
Belege aus den Postfächern, eine Claude-Routine in der Cloud ordnet sie zu, Arion OS
legt sie in Google Drive ab und zeigt alles unter **/buchhaltung**.

```
IONOS-Postfächer ──IMAP──▶ Arion OS (Vercel)            Claude-Routine (Cloud)
 info@ rechnung@ admin@      /api/cron/buchhaltung        liest per SQL
 scan@ …                      1. Mail-Abruf               ─────────────────────
                              2. Anhänge → buch_eingang ─▶ klassifiziert Belege,
                                                           teilt Stapelscans auf,
                              3. buch_ablage (offen) ◀──── schreibt Ablage-Aufträge,
                              4. PDF schneiden + Upload    füllt buch_ausgaben /
                                 → Google Drive            buch_fristen / Kennzahlen
                              5. /buchhaltung zeigt alles
```

Grundsätze: Es wird **nie etwas gelöscht** – weder in Postfächern (Abruf nur lesend,
Mails werden nicht als gelesen markiert) noch in Drive (gleichnamige Dateien bekommen
„ (2)“, „ (3)“ …). Die App ist der einzige Prozess mit Drive-Schreibrechten; die Routine
spricht nur SQL.

## Bausteine im Code

| Datei | Aufgabe |
| --- | --- |
| `lib/db.ts` (`buchhaltungStatements`) | Tabellen + Indizes, idempotent beim Start (SQLite und Postgres), RLS auf Supabase |
| `lib/mail-fetch.ts` | IMAP-Abruf; speichert PDF/Bild-Anhänge (≤ 20 MB) neuer Mails im Eingang |
| `lib/buch-eingang.ts` | Erkennung von Belegen, Scan-Erkennung, Speichern mit SHA-256-Dedupe |
| `lib/buch-ablage.ts` / `lib/buch-pdf.ts` | Ablage-Aufträge ausführen: Seiten schneiden, Fotos → A4-PDF, Upload |
| `lib/google-drive.ts` / `lib/google-jwt.ts` | Service-Account-Login (JWT RS256, ohne SDK), Ordnerpfade, Upload |
| `lib/buch-run.ts` | Ein Lauf = Mail-Abruf (≈ 32 s Budget) + Ablage (bis ≈ 52 s) |
| `app/api/cron/buchhaltung` | Cron-Endpunkt (CRON_SECRET), GET oder POST |
| `app/api/buchhaltung/*` | Übersicht, Datei-Vorschau, Status „ignorieren“, „Jetzt abrufen“, Ablage erneut versuchen |
| `app/buchhaltung/page.tsx` | Seite; Dashboard-Karte auf „Heute“ |

Tests ohne Netzwerk: `npm run test:buchhaltung` (Seitenangaben, JWT-Signatur,
PDF-Schnitt, Anhang-Erkennung, Drive-Logik gegen ein gemocktes Drive).

## Umgebungsvariablen (Vercel → Settings → Environment Variables)

| Variable | Inhalt |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | kompletter Inhalt der JSON-Schlüsseldatei des Service-Accounts (eine Zeile reicht, so wie heruntergeladen) |
| `DRIVE_BUCHHALTUNG_ROOT_ID` | ID des Drive-Ordners „Buchhaltung“ (aus der URL `…/folders/<ID>`) |
| `GOOGLE_IMPERSONATE_USER` | optional, nur für Variante B unten (z. B. `info@arion-logistics.de`) |
| `CRON_SECRET` | lange Zufallszeichenkette (gibt es schon für den Mail-Cron) |
| `MAIL_1_LABEL` … `MAIL_8_LABEL` | Anzeigename, z. B. `Rechnung` |
| `MAIL_n_HOST` | `imap.ionos.de` |
| `MAIL_n_USER` | vollständige Adresse, z. B. `rechnung@arion-logistics.de` |
| `MAIL_n_PASS` | Postfach-Passwort |
| `MAIL_n_PORT` | optional, Standard 993 |

Postfächer können statt per Env weiterhin im Mail-Modul („Postfächer“) angelegt werden –
beide Quellen werden zusammengeführt. Empfohlen: `info@`, `rechnung@`, `admin@`,
`scan@arion-logistics.de`. Anhänge aus `scan@` (oder mit Betreff „Scan Bürodrucker…“)
bekommen `quelle = 'scan'`.

Nach dem Setzen: **Redeploy**.

## Schritt für Schritt: Google Drive anbinden

1. **Projekt anlegen:** <https://console.cloud.google.com> mit dem Workspace-Konto
   öffnen → Projektauswahl → „Neues Projekt“ → Name `arion-os` → Erstellen.
2. **Drive API aktivieren:** „APIs & Dienste“ → „Bibliothek“ → „Google Drive API“ →
   Aktivieren.
3. **Service-Account erstellen:** „IAM & Verwaltung“ → „Dienstkonten“ →
   „Dienstkonto erstellen“ → Name `arion-os-ablage` → Fertig (keine Rollen nötig).
4. **Schlüssel erzeugen:** Dienstkonto öffnen → Tab „Schlüssel“ → „Schlüssel hinzufügen“
   → „Neuen Schlüssel erstellen“ → JSON. Die Datei wird heruntergeladen.
   Ihren **gesamten Inhalt** als `GOOGLE_SERVICE_ACCOUNT_JSON` bei Vercel eintragen,
   danach die Datei sicher löschen bzw. verwahren (nie ins Repo).
   Falls die Organisation das Erstellen von Schlüsseln blockiert
   (`iam.disableServiceAccountKeyCreation`): admin.google.com bzw. Cloud Console →
   „Organisationsrichtlinien“ → Richtlinie für dieses Projekt ausnahmsweise aufheben.
5. **Ordner freigeben** – wichtig: Service-Accounts haben **kein eigenes
   Speicherkontingent**. Dateien, die sie in „Meine Ablage“ eines Nutzers hochladen,
   scheitern mit `storageQuotaExceeded`. Deshalb eine der beiden Varianten:
   - **Variante A (empfohlen): Geteilte Ablage.** In Drive „Geteilte Ablagen“ →
     z. B. „Arion Buchhaltung“ anlegen (bzw. vorhandene nutzen), darin den Ordner
     `Buchhaltung` (mit der bisherigen Struktur `Ausgaben/2026/…`). Geteilte Ablage →
     „Mitglieder verwalten“ → die Service-Account-Adresse
     (`arion-os-ablage@<projekt>.iam.gserviceaccount.com`, steht als `client_email` in
     der JSON) als **Inhaltsmanager** hinzufügen.
   - **Variante B: Ordner bleibt in „Meine Ablage“.** Domänenweite Delegation
     einrichten: admin.google.com → Sicherheit → API-Steuerung → „Domainweite
     Delegierung verwalten“ → Neu → Client-ID des Service-Accounts (Feld `client_id`
     in der JSON) mit Bereich `https://www.googleapis.com/auth/drive`. Dann
     `GOOGLE_IMPERSONATE_USER=<Eigentümer des Ordners>` setzen; die App handelt
     dann als dieser Nutzer. Der Ordner muss nicht extra freigegeben werden.
     (Nur mit „Freigeben → Bearbeiter“ ohne Delegation funktionieren Ordner anlegen
     und Lesen, Uploads aber nicht.)
6. **Root-ID eintragen:** Ordner `Buchhaltung` in Drive öffnen; die URL lautet
   `https://drive.google.com/drive/folders/<ID>` → `<ID>` als
   `DRIVE_BUCHHALTUNG_ROOT_ID` setzen. Redeploy.
7. **Test:** /buchhaltung → „Abrufen“. Die Karte „Abgelegt“ zeigt Fehler im Klartext
   (z. B. fehlende Rechte); „Erneut versuchen“ reiht einen fehlgeschlagenen Auftrag neu ein.

Pfade in Aufträgen sind **relativ zum Root** (`Ausgaben/2026/September/Rechnungseingang/Belege`).
Fehlende Unterordner werden mit exakt diesem Namen angelegt; vorhandene wiederverwendet.

## Häufiger als täglich abrufen

Vercel Hobby erlaubt Cron-Jobs nur **einmal täglich** (`vercel.json`: 05:00 UTC
`/api/cron/mail`, 16:00 UTC `/api/cron/buchhaltung` als Rückfallebene). Für stündliche
Läufe gibt es zwei Wege:

### Kostenlos: Supabase pg_cron + pg_net

Im Supabase-Projekt „Arion OS“ → SQL Editor (einmalig, Platzhalter ersetzen):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secret NICHT im Klartext im Job ablegen, sondern im Vault:
select vault.create_secret('<CRON_SECRET>', 'arion_cron_secret');

-- pg_cron rechnet in UTC. 05–19 UTC deckt 7–20 Uhr Berlin im Sommer (MESZ, UTC+2)
-- ab und im Winter (MEZ, UTC+1) 6–20 Uhr.
select cron.schedule(
  'arion-buchhaltung-stuendlich',
  '0 5-19 * * *',
  $$
  select net.http_post(
    url := 'https://<DEINE-APP>.vercel.app/api/cron/buchhaltung',
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

Kontrolle: `select * from cron.job_run_details order by start_time desc limit 10;`
und `select id, status_code, left(content::text, 200) from net._http_response order by id desc limit 10;`
Abschalten: `select cron.unschedule('arion-buchhaltung-stuendlich');`

Hinweis: Die Vercel Deployment Protection muss für Production aus sein (wie für den
Vercel-Cron), sonst erreicht der Aufruf die App nicht.

### Alternativ: Vercel Pro

Auf Pro sind beliebige Intervalle möglich, z. B. in `vercel.json`:
`{ "path": "/api/cron/buchhaltung", "schedule": "0 5-19 * * *" }`.

## Grenzen eines Laufs

- Pro Konto max. 25 neue Mails, Konten nacheinander, Mail-Abruf ≈ 32 s, Gesamtlauf
  ≈ 52 s (`maxDuration = 60`). Was nicht mehr passt, folgt beim nächsten Lauf (Mails
  werden erst als gesehen markiert, wenn sie verarbeitet sind).
- Anhänge: PDF, JPG, PNG, HEIC, WebP bis je 20 MB. Eingebettete Bilder < 30 KB
  (Logos/Signaturen) und Bilder < 8 KB werden übersprungen, weitergeleitete Mails
  (`message/rfc822`) nicht aufgebohrt.
- Nur **neue** Mails (letzte 4 Tage, noch nicht in `mail_seen`) werden betrachtet –
  Anhänge von Mails, die vor Einführung des Moduls schon abgerufen wurden, kommen nicht
  automatisch nach.
- Ablage: max. 15 Aufträge pro Lauf. HEIC/WebP kann die App nicht in PDF wandeln (siehe unten).
- Nach neuen Belegen/wichtigen Mails schickt der **Cron** eine Push-Nachricht
  („3 neue Belege eingegangen · 1 wichtige Mail“). Manuelles „Abrufen“ pusht nicht.

## Wichtig-Regeln

Beim ersten Start mit diesem Modul werden einmalig Standardregeln angelegt (nur wenn
der Wert noch nicht existiert; gelöschte Regeln kommen nicht zurück – Flag
`app_config.buch_rules_seeded`): Absender `finanzamt`, `bg-verkehr`, `walkowiak`,
`rnhs`, `staatsoberkasse`, `krankenkasse`, `aok`, `kkh`; Betreff `Mahnung`, `Frist`,
`Bescheid`. Neue Regelart **Betreff** (prüft nur den Betreff, nicht den Text).

---

## SQL-Vertrag für die Claude-Routine

Die Routine verbindet sich direkt mit der Supabase-Datenbank (Rolle mit Tabellenrechten,
z. B. über das Supabase-MCP `execute_sql`). RLS ist auf allen `buch_*`-Tabellen aktiv,
ohne Policies – die öffentliche API ist gesperrt, direkte DB-Verbindungen als Owner/
`postgres` sind nicht betroffen. Alle Zeitwerte sind **Text** (ISO), Beträge `NUMERIC(14,2)`,
`workspace_id` bleibt beim Default `'default'`.

### Tabellen

**`buch_eingang`** – eingegangene Dateien (schreibt die App; Routine liest + setzt Status)

| Spalte | Bedeutung |
| --- | --- |
| `id` | bigint |
| `quelle` | `mail` \| `scan` \| `upload` |
| `account`, `message_id`, `from_addr`, `subject`, `received_at` | Herkunft |
| `filename`, `mime`, `size`, `sha256` | Datei (sha256 eindeutig je Workspace) |
| `status` | `neu` → `in_pruefung` → `abgelegt` / `ignoriert` / `fehler` |
| `firma` | `arion` \| `kreativwerk` \| `fleetfix` \| NULL – setzt die Routine |
| `notiz` | Freitext (Routine: z. B. „Seiten 1–11 Allianz, 12 Telekom“) |

**`buch_eingang_blobs`** – `eingang_id`, `data` (bytea). Nur lesen.

**`buch_ablage`** – Ablage-Aufträge (schreibt die Routine; App führt aus)

| Spalte | Bedeutung |
| --- | --- |
| `eingang_id` | Bezug auf `buch_eingang.id` |
| `seiten` | `''` = alle, sonst `"1-11"`, `"3,5"`, `"1-3,7"` (1-basiert) |
| `ziel_pfad` | relativ zum Drive-Root, z. B. `Ausgaben/2026/September/Rechnungseingang/Belege` (kein `..`, max. 12 Ebenen) |
| `dateiname` | z. B. `Allianz_28.573,88.pdf` (`.pdf` wird ergänzt) |
| `lieferant`, `betrag`, `belegdatum` (YYYY-MM-DD), `monat` (YYYY-MM) | Metadaten |
| `status` | `offen` → `in_arbeit` → `erledigt` \| `fehler` (setzt die App) |
| `drive_file_id`, `drive_url`, `fehler`, `done_at` | Ergebnis (setzt die App; `dateiname` enthält danach den tatsächlichen Namen, ggf. mit „ (2)“) |

`in_arbeit` ist ein kurzer Sperrstatus gegen Doppel-Uploads paralleler Läufe; hängt ein
Auftrag > 10 Minuten darin, wird er erneut ausgeführt. Sind alle Aufträge eines
Eingangs `erledigt`, setzt die App den Eingang auf `abgelegt`. Für einen erneuten
Versuch nach `fehler`: `status` wieder auf `offen` setzen (oder Button in der App).

Bilder: JPG/PNG werden automatisch zu einer A4-Seite. HEIC/WebP scheitern mit
Fehlermeldung – die Routine kann die Datei selbst in PDF umwandeln und als neuen
Eingang (`quelle = 'upload'`) einfügen, siehe Beispiel unten.

**`buch_ausgaben`** – Abbuchungen je Monat für den Abgleich (Routine, aus Qonto)

`monat` (YYYY-MM), `datum` (YYYY-MM-DD), `empfaenger`, `zweck`, `betrag` (positiv = Abbuchung),
`kategorie` (`Beleg gefunden` \| `FEHLT` \| `Lohn/Vorschuss` \| `Sozialvers./Steuer/Behörde` \|
`Dauervertrag` \| `Bankgebühr` …), `beleg` (Dateiname), `hinweis`, `qonto_id`
(eindeutig zusammen mit `workspace_id`). „Belegt %“ = Anteil nach Betrag ohne `FEHLT`.

**`buch_fristen`** – `titel`, `faellig` (YYYY-MM-DD), `betrag`, `art` (`ust` \| `lohnsteuer` \|
`bg` \| `sonstiges`), `status` (`offen` \| `bezahlt`), `quelle`, `notiz`. In der App
editierbar („Bezahlt“).

**`buch_kennzahlen`** – Schlüssel/Wert: `qonto_saldo` (z. B. `52340.17`),
`qonto_stand` (YYYY-MM-DD); Primärschlüssel (`workspace_id`, `key`).

### Beispiel-SQL

```sql
-- 1) Neue Eingänge holen (ohne Blob)
select id, quelle, account, from_addr, subject, received_at, filename, mime, size
from buch_eingang where status = 'neu' order by id limit 20;

-- 2) Datei als Base64 laden
select encode(data, 'base64') from buch_eingang_blobs where eingang_id = $1;

-- 3) In Prüfung nehmen (verhindert Doppelbearbeitung)
update buch_eingang set status = 'in_pruefung', firma = 'arion',
       notiz = 'S. 1-11 Allianz, S. 12 Telekom', updated_at = now()::text
where id = $1 and status = 'neu';

-- 4) Ablage-Aufträge anlegen (ein Stapelscan → mehrere Aufträge)
insert into buch_ablage (eingang_id, seiten, ziel_pfad, dateiname, lieferant, betrag, belegdatum, monat)
values
  ($1, '1-11', 'Ausgaben/2026/September/Rechnungseingang/Belege', 'Allianz_28.573,88.pdf', 'Allianz', 28573.88, '2026-09-03', '2026-09'),
  ($1, '12',   'Ausgaben/2026/September/Rechnungseingang/Belege', 'Telekom_49,99.pdf',     'Telekom', 49.99,    '2026-09-05', '2026-09');

-- Kein Beleg (Werbung, AGB …)
update buch_eingang set status = 'ignoriert', notiz = 'Newsletter' where id = $1;

-- 5) Bank-Abgleich: Abbuchungen per qonto_id upserten
insert into buch_ausgaben (monat, datum, empfaenger, zweck, betrag, kategorie, beleg, hinweis, qonto_id)
values ('2026-09', '2026-09-05', 'Aral', 'Tankkarte 09/2026', 334.56, 'FEHLT', '', 'Beleg im Aral-Portal', 'tx_123')
on conflict (workspace_id, qonto_id) do update set
  monat = excluded.monat, datum = excluded.datum, empfaenger = excluded.empfaenger,
  zweck = excluded.zweck, betrag = excluded.betrag, kategorie = excluded.kategorie,
  beleg = excluded.beleg, hinweis = excluded.hinweis;

-- 6) Fristen und Kennzahlen
insert into buch_fristen (titel, faellig, betrag, art, quelle)
values ('USt-Voranmeldung September', '2026-10-10', 4120.50, 'ust', 'Elster');

insert into buch_kennzahlen (key, value, updated_at) values
  ('qonto_saldo', '52340.17', now()::text), ('qonto_stand', '2026-10-17', now()::text)
on conflict (workspace_id, key) do update set value = excluded.value, updated_at = excluded.updated_at;

-- 7) Ergebnis der Ablage prüfen
select id, dateiname, status, drive_url, fehler from buch_ablage where eingang_id = $1;

-- 8) Umgewandelte Datei (z. B. HEIC → PDF) als neuen Eingang einfügen
with e as (
  insert into buch_eingang (quelle, account, subject, received_at, filename, mime, size, sha256, status, notiz)
  values ('upload', 'claude-routine', 'Umwandlung von Eingang 42', now()::text, 'IMG_0815.pdf',
          'application/pdf', length(decode($1, 'base64')), encode(sha256(decode($1, 'base64')), 'hex'),
          'in_pruefung', 'aus HEIC umgewandelt')
  returning id)
insert into buch_eingang_blobs (eingang_id, data) select id, decode($1, 'base64') from e;
```

Die Routine löscht nichts und überschreibt keine Zeilen der App außer den oben
genannten Statusfeldern.
