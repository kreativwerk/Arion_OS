---
name: gstack
description: Stack- und Architektur-Entscheidungen für Arion OS treffen und begründen. Nutzen, bevor neue Module, Abhängigkeiten oder Integrationen hinzukommen.
---

# gstack – Stack-Disziplin für Arion OS

Arion OS ist ein Produkt, kein Bastelprojekt. Jede technische Entscheidung folgt diesen Regeln:

## Grundsätze

1. **Ein Datenkern.** Alles läuft über `lib/db.ts` und die generische API (`/api/data/[table]`
   mit Whitelist in `lib/tables.ts`). Kein Modul greift an der API vorbei auf die DB zu,
   keine zweite Datenhaltung.
2. **Integrationen sind Zulieferer.** Externe Systeme (Codriver, IMAP, Slack, Watcher)
   schreiben per HTTP-POST in den Datenkern – authentifiziert über API-Tokens
   (`/api/external/*`). Fällt ein Zulieferer aus, läuft die App weiter.
3. **Abhängigkeiten verdienen sich ihren Platz.** Neue npm-Pakete nur, wenn sie ein
   echtes Problem lösen, das >50 Zeilen eigenen Code kosten würde. Native Dependencies
   (wie better-sqlite3) nur mit Prebuilds.
4. **Verkaufsfähig denken.** Keine hartkodierten Kundendaten im Code – alles
   Kundenspezifische (Name, Firma, Partner, Branding) lebt in `app_config` bzw. Seeds.
   Der Migrationspfad zu Multi-Tenant steht in `docs/SAAS.md` und darf nicht verbaut werden:
   jede neue Tabelle bekommt perspektivisch eine `workspace_id`-Spalte spendiert, wenn
   die SaaS-Stufe kommt.

## Checkliste vor jedem neuen Modul

- [ ] Tabelle(n) in `lib/db.ts` + Whitelist in `lib/tables.ts` – reicht die generische CRUD-API?
- [ ] Braucht es wirklich eine Spezialroute? (Nur bei Logik wie Wiederholung/Aggregation)
- [ ] Taucht das Modul im Dashboard (`/api/dashboard`) und in Jarvis (`buildContext`) auf?
- [ ] Seed-Daten ergänzt, damit ein frischer Start das Modul zeigt?
- [ ] Docs aktualisiert (`README.md`, ggf. `docs/`)?
- [ ] `npm run build` grün?
