# Arion OS

**Dein persönliches Betriebssystem für den Alltag** – To-dos, Gewohnheiten, Mail-Digest,
Kalender, Wissen, Verträge, digitale Briefpost, Portal-Watcher, Slack-Filter und ein
eigener KI-Assistent („Jarvis") – in einer minimalistischen App im Apple-Stil.

## Schnellstart

```bash
npm install
npm run dev
```

Dann [http://localhost:3000](http://localhost:3000) öffnen.

## Datenbank

Eine Datenschicht, zwei Treiber (`lib/db.ts`):

- **Produktion: Supabase/Postgres.** In `.env.local` die `DATABASE_URL` des
  Supabase-Projekts **„Arion OS"** setzen (Dashboard → Connect → Session pooler).
  Schema und Startdaten liegen dort bereits; Row Level Security sperrt die
  öffentliche API komplett – nur die App selbst erreicht die Daten.
- **Entwicklung/Offline: SQLite.** Ohne `DATABASE_URL` wird automatisch
  `data/arion.db` verwendet und beim ersten Start mit Beispieldaten befüllt
  (Aufgaben, Partner-Wissen zu Amazon/Arval/LeasePlan, Verträge, Post …).

Beide Treiber teilen dieselben Queries – das Verhalten der App ist identisch.

## Module

| Modul | Was es kann |
| --- | --- |
| **Heute** | Dashboard: fällige Aufgaben, Gewohnheiten, Termine, wichtige Mails, neue Post, Portal-/Slack-Meldungen, ablaufende Kündigungsfristen |
| **Aufgaben** | Short-Term ↔ Long-Term im Switch, wiederkehrende Aufgaben (täglich/wöchentlich/monatlich), Prioritäten, Projekte |
| **Gewohnheiten** | Habit-Tracker mit 7-Tage-Raster, Wochenziel und Streaks |
| **Kalender** | Eigene Einträge; ICS-Anbindung (Google/Outlook) als Ausbaustufe |
| **Mail-Digest** | Zusammenfassungen wichtiger Mails aus mehreren Postfächern, gefiltert nach VIP-Absendern und Stichwörtern |
| **Briefpost** | Vom Mitarbeiter gescannte Post wird digital zugestellt, mit Status-Workflow (neu → gelesen → Aktion → Archiv) |
| **Wissen** | Persönliches Wissen, Firmenwissen und Partnerwissen (Amazon, Arval, LeasePlan …), durchsuchbar |
| **Verträge** | Versicherungen, Leasing & Co. mit Kündigungsfrist-Countdown und Jahreskosten |
| **Clipboard** | Textbausteine, IBANs, Kundennummern, Links – ein Klick kopiert |
| **Portale** | Watcher für Vendor Central, Arval-Portal etc. – neue Aufgaben/Infos laufen als Meldungen ein |
| **Slack** | Nur Nachrichten von definierten wichtigen Personen |
| **Jarvis** | Chat-Assistent, der alle Daten der App **und dein Profil** kennt; mit `ANTHROPIC_API_KEY` antwortet er frei formuliert über die Claude API |
| **Einstellungen** | Profil („Über mich" für Jarvis), White-Label (App-Name), API-Tokens für externe Apps |

## Mitarbeiter-Aufgaben über Codriver

Mitarbeiter können über die firmeneigene App **Codriver** Aufgaben eintragen:
Token unter *Einstellungen → API-Zugänge* erstellen, dann `POST /api/external/tasks`
(siehe [`docs/CODRIVER.md`](docs/CODRIVER.md)). Eingetragene Aufgaben landen im
**Eingang** und werden erst nach Annahme Teil der To-do-Liste.

## Konfiguration

`.env.example` nach `.env.local` kopieren und ausfüllen (optional – die App läuft auch ohne):

```bash
cp .env.example .env.local
```

## Dokumentation

- [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md) – Aufbau, Datenmodell, Designprinzipien
- [`docs/INTEGRATIONEN.md`](docs/INTEGRATIONEN.md) – Anbindung von IMAP-Postfächern, Slack, Kalender, Portal-Watchern, Brief-Scans und Claude API
- [`docs/CODRIVER.md`](docs/CODRIVER.md) – API für die Mitarbeiter-App (Aufgaben-Eingang)
- [`docs/SAAS.md`](docs/SAAS.md) – Verkaufsfähigkeit: White-Label heute, Multi-Tenant-Fahrplan

Projekt-Skills für die Entwicklung mit Claude Code liegen unter `.claude/skills/`:
`/gstack` (Architektur-Disziplin), `/grillme` (kritische Scope-Prüfung), `/taste` (Design-Regeln).

## Stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · Postgres auf Supabase
(Produktion) / SQLite (Entwicklung) · Material Symbols
