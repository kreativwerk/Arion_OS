# Architektur

## Leitidee

Arion OS ist ein **persönliches Betriebssystem**: eine einzige, ruhige Oberfläche, in der
alle Informationsströme des Alltags zusammenlaufen – Aufgaben, Gewohnheiten, Mails,
Briefpost, Termine, Verträge, Portal-Meldungen, Slack – und ein Assistent (Jarvis), der
über all das Auskunft geben kann.

Drei Prinzipien:

1. **Ein Datenkern, viele Ansichten.** Alle Module schreiben in dieselbe lokale
   SQLite-Datenbank. Das Dashboard („Heute") und Jarvis sind nur Ansichten auf denselben Kern.
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
│  /api/assistant      Jarvis (lokal + optional Claude)    │
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

- **SQLite statt Cloud-Datenbank (v1).** Eine Datei, kein Betrieb, volle Datenhoheit –
  bei sensiblen Daten (Verträge, Post, Mails) bewusst gewählt. Migration auf Supabase/
  Postgres ist vorbereitet: alle Zugriffe laufen über `lib/db.ts` und die generische API.
- **Generische CRUD-API mit Whitelist** (`lib/tables.ts`): jedes Modul bekommt
  Standard-CRUD geschenkt; nur Spezialfälle (Wiederholung, Habit-Toggle, Dashboard,
  Jarvis) haben eigene Routen.
- **Wiederkehrende Aufgaben werden nicht erledigt, sondern weitergeschoben:** Beim
  Abhaken springt `due_date` auf den nächsten Termin. So bleibt die Liste ehrlich und
  es entsteht keine Duplikat-Flut.
- **Jarvis in zwei Stufen:** Ohne API-Key beantwortet er Fragen deterministisch aus der
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
4. Dashboard, Mail-Modul und Jarvis zeigen dieselbe Zeile – ohne weitere Kopplung.

Derselbe Weg gilt für Slack-Nachrichten, Watcher-Meldungen und Brief-Scans: **alles ist
nur ein `POST` auf den Datenkern.**

## Roadmap (empfohlene Reihenfolge)

1. **Jetzt nutzbar:** alle Module manuell + Seed-Daten, Jarvis lokal.
2. **Jarvis mit Claude API** – ein Env-Key, sofort spürbarer Mehrwert.
3. **IMAP-Mail-Digest** als Cron-Job (Zusammenfassung per Claude).
4. **Brief-Scan-Upload** für den Mitarbeiter (Upload-Link + PDF-Ablage + Auto-Zusammenfassung).
5. **ICS-Kalender-Sync** (Google/Outlook read-only, eigene Einträge bleiben lokal).
6. **Slack-App** (Events API, Filter auf wichtige Personen).
7. **Portal-Watcher** (Playwright-Jobs pro Portal, Meldungen in den Datenkern).
8. Bei Bedarf: Multi-Device (Supabase), Mobile-PWA, Push-Benachrichtigungen.
