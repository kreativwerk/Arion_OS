# Arion OS

**Dein persönliches Betriebssystem für den Alltag** – To-dos, Gewohnheiten, Mail-Digest,
Kalender, Wissen, Verträge, digitale Briefpost, Portal-Watcher, Slack-Filter und ein
eigener KI-Assistent („Jarvis") – in einer minimalistischen App im Apple-Stil.

## Schnellstart

```bash
npm install
npm run dev
```

Dann [http://localhost:3000](http://localhost:3000) öffnen. Beim ersten Start wird eine
lokale SQLite-Datenbank unter `data/arion.db` angelegt und mit Beispieldaten befüllt
(Aufgaben, Partner-Wissen zu Amazon/Arval/LeasePlan, Verträge, Post …). Alles kann in
der App gelöscht und durch echte Daten ersetzt werden.

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
| **Jarvis** | Chat-Assistent, der alle Daten der App kennt; mit `ANTHROPIC_API_KEY` antwortet er frei formuliert über die Claude API |

## Konfiguration

`.env.example` nach `.env.local` kopieren und ausfüllen (optional – die App läuft auch ohne):

```bash
cp .env.example .env.local
```

## Dokumentation

- [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md) – Aufbau, Datenmodell, Designprinzipien
- [`docs/INTEGRATIONEN.md`](docs/INTEGRATIONEN.md) – Anbindung von IMAP-Postfächern, Slack, Kalender, Portal-Watchern, Brief-Scans und Claude API

## Stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · SQLite (better-sqlite3)
