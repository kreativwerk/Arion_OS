# Architektur

## Leitidee

Arion OS ist ein **persönliches Betriebssystem**: eine einzige, ruhige Oberfläche, in der
alle Informationsströme des Alltags zusammenlaufen – Aufgaben, Gewohnheiten, Mails,
Briefpost, Termine, Verträge, Portal-Meldungen, Slack – und ein Assistent (Arion Bot), der
über all das Auskunft geben kann.

Drei Prinzipien:

1. **Ein Datenkern, viele Ansichten.** Alle Module schreiben in dieselbe lokale
   SQLite-Datenbank. Das Dashboard („Heute") und Arion Bot sind nur Ansichten auf denselben Kern.
2. **Integrationen sind Zulieferer, keine Abhängigkeit.** Jede Integration (IMAP, Slack,
   Watcher, Scans) schreibt über dieselbe API in den Datenkern. Fällt eine Integration aus,
   funktioniert die App weiter – Einträge können immer auch manuell erfasst werden.
3. **Minimalistisch nach Apple-Vorbild.** Systemschrift, neutrale Flächen (#f5f5f7),
   weiße Karten mit 18-px-Radius, ein Akzentblau, automatischer Dark Mode. Keine
   Verzierung, die keine Information trägt.

## Schichten

```
┌──────────────────────────────────────────────────────────┐
│  UI (Next.js App Router, React, Tailwind)                │
│  /  /aufgaben  /gewohnheiten  /kalender  /mail  /post    │
│  /wissen  /vertraege  /clipboard  /watcher  /slack       │
│  /assistent                                              │
├──────────────────────────────────────────────────────────┤
│  API (Route Handlers)                                    │
│  /api/data/[table]   generische CRUD-API (Whitelist)     │
│  /api/dashboard      Aggregation für "Heute"             │
│  /api/tasks/complete Wiederholungslogik                  │
│  /api/habits/toggle  Habit-Logs                          │
│  /api/assistant      Arion Bot (lokal + optional Claude)    │
├──────────────────────────────────────────────────────────┤
│  Datenkern (SQLite, data/arion.db)                       │
│  tasks · habits · habit_logs · calendar_events ·         │
│  clipboard_items · knowledge_notes · contracts ·         │
│  letters · mail_* · watchers · watcher_events ·          │
│  slack_* · assistant_messages                            │
├──────────────────────────────────────────────────────────┤
│  Integrationen (Zulieferer, siehe INTEGRATIONEN.md)      │
│  IMAP-Digest · Slack Events · ICS-Kalender ·             │
│  Portal-Watcher · Brief-Scan-Upload · Claude API         │
└──────────────────────────────────────────────────────────┘
```

## Wichtige Entscheidungen

- **Eine Datenschicht, zwei Treiber** (`lib/db.ts`): Ist `DATABASE_URL` gesetzt, spricht
  die App **Postgres auf Supabase** (Projekt „Arion OS", Region `eu-central-1`, Ref
  `hvgctketypxgangqaohs`) – die Produktionsdatenbank. Ohne `DATABASE_URL` fällt sie auf
  **SQLite** (`data/arion.db`) zurück – für Entwicklung, Offline-Betrieb und Self-Hosted-
  Kunden mit maximaler Datenhoheit. Beide Treiber teilen dieselben Queries
  (`?`-Platzhalter, ISO-Text-Daten, 0/1-Booleans); das Schema entsteht in beiden Fällen
  idempotent beim Start. Auf Supabase ist Row Level Security ohne Policies aktiv: Die
  öffentliche PostgREST-API ist damit komplett gesperrt, nur die App (direkte
  Postgres-Verbindung) erreicht die Daten.
- **`workspace_id` auf allen Tabellen** (Default `'default'`): das Datenmodell ist für
  Mandantenfähigkeit vorbereitet, ohne dass die Queries heute schon scopen müssen
  (siehe `docs/SAAS.md`).
- **Generische CRUD-API mit Whitelist** (`lib/tables.ts`): jedes Modul bekommt
  Standard-CRUD geschenkt; nur Spezialfälle (Wiederholung, Habit-Toggle, Dashboard,
  Arion Bot) haben eigene Routen.
- **Wiederkehrende Aufgaben werden nicht erledigt, sondern weitergeschoben:** Beim
  Abhaken springt `due_date` auf den nächsten Termin. So bleibt die Liste ehrlich und
  es entsteht keine Duplikat-Flut.
- **Arion Bot in zwei Stufen:** Ohne API-Key beantwortet er Fragen deterministisch aus der
  Datenbank (Intent-Erkennung + Volltextsuche). Mit `ANTHROPIC_API_KEY` wird derselbe
  Datenkontext an die Claude API gegeben und die Antwort frei formuliert. Der Kontext wird
  pro Frage gezielt zusammengestellt (`lib/assistant/engine.ts` → `buildContext`).
- **Kündigungsfrist als erste Bürgerin:** Verträge speichern `end_date` +
  `cancel_period_days`; die App rechnet daraus den Countdown „noch X Tage kündbar" und
  warnt auf dem Dashboard, bevor Fristen verstreichen.

## Datenfluss am Beispiel „wichtige Mail"

1. Der IMAP-Digest-Job (Ausbaustufe, siehe INTEGRATIONEN.md) holt neue Mails aus allen
   Postfächern.
2. Er prüft sie gegen die Regeln in `mail_rules` (VIP-Absender, Stichwörter).
3. Treffer werden zusammengefasst und via `POST /api/data/mail_digest` gespeichert.
4. Dashboard, Mail-Modul und Arion Bot zeigen dieselbe Zeile – ohne weitere Kopplung.

Derselbe Weg gilt für Slack-Nachrichten, Watcher-Meldungen und Brief-Scans: **alles ist
nur ein `POST` auf den Datenkern.**

## Roadmap (empfohlene Reihenfolge)

1. **Jetzt nutzbar:** alle Module manuell + Seed-Daten, Arion Bot lokal.
2. **Arion Bot mit Claude API** – ein Env-Key, sofort spürbarer Mehrwert.
3. **IMAP-Mail-Digest** als Cron-Job (Zusammenfassung per Claude).
4. **Brief-Scan-Upload** für den Mitarbeiter (Upload-Link + PDF-Ablage + Auto-Zusammenfassung).
5. **ICS-Kalender-Sync** (Google/Outlook read-only, eigene Einträge bleiben lokal).
6. **Slack-App** (Events API, Filter auf wichtige Personen).
7. **Portal-Watcher** (Playwright-Jobs pro Portal, Meldungen in den Datenkern).
8. Bei Bedarf: Multi-Device (Supabase), Mobile-PWA, Push-Benachrichtigungen.
