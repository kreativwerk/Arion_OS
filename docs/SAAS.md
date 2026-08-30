# Verkaufsfähigkeit: Vom Einzelsystem zum Produkt

Arion OS ist so gebaut, dass es **heute** als Einzelinstallation läuft und **später** an
andere Unternehmer verkauft werden kann – auf zwei Wegen, die beide vorbereitet sind.

## Was heute schon produktfähig ist

- **Kein Kundencode im Code.** Alles Kundenspezifische lebt in der Datenbank:
  Profil, Firma, Partner, App-Name (White-Label) unter **Einstellungen** (`app_config`),
  Inhalte über Seeds/Eingaben. Eine neue Kundeninstanz = frische `data/arion.db`.
- **White-Label:** `app_name`, Begrüßungsname, Firmen- und Partnerliste sind
  Konfiguration. Farbe/Logo lassen sich in `app/globals.css` (Tokens) pro Kunde anpassen.
- **Offene Zulieferer-API mit Token-Verwaltung:** Jeder Kunde kann eigene Apps
  (wie Codriver) anbinden – Tokens erstellen/widerrufen in den Einstellungen.
- **Ein Datenkern hinter einer Whitelist-API** – die einzige Stelle, die für
  Mandantenfähigkeit angefasst werden muss.

## Vertriebsmodell 1: Self-Hosted-Lizenz (sofort möglich)

Pro Kunde eine Instanz (VPS oder Rechner beim Kunden, hinter VPN/Basic-Auth):

1. Repo deployen, `data/` leer starten, Einstellungen ausfüllen, ggf. Farb-Tokens anpassen.
2. Backup = eine Datei (`data/arion.db`). Updates = `git pull && npm run build`.
3. Vorteil beim Verkauf an Mittelständler: **volle Datenhoheit** (Verträge, Post,
   Mails bleiben im Haus) – das ist ein Verkaufsargument, kein Provisorium.

## Vertriebsmodell 2: Cloud/SaaS (Ausbaustufe)

Reihenfolge der Umbauten, bewusst klein gehalten:

1. ✅ **Postgres auf Supabase** – erledigt. Projekt „Arion OS" (`hvgctketypxgangqaohs`,
   `eu-central-1`), Schema + Startdaten migriert, RLS ohne Policies (öffentliche API
   gesperrt, Zugriff nur über die direkte Verbindung der App via `DATABASE_URL`).
   Die App fällt ohne `DATABASE_URL` automatisch auf SQLite zurück.
2. ✅ **`workspace_id`** liegt bereits auf allen Tabellen (Default `'default'`).
3. **Auth:** Login (Supabase Auth oder Auth.js). Session-User in den API-Routen.
4. **Mandanten-Scoping:** `WHERE workspace_id = ?` in der generischen API (eine Datei:
   `app/api/data/[table]/route.ts`) und den Spezialrouten. Tokens (`api_tokens`)
   bekommen dann ebenfalls eine `workspace_id`.
5. **Abrechnung:** Stripe (Subscription pro Workspace), Feature-Flags in `app_config`.
6. **Betrieb:** Vercel/Fly + Supabase; Cron-Jobs (Mail-Digest, Watcher) als
   Scheduled Functions pro Workspace.

## Preis-/Paketlogik (Vorschlag)

| Paket | Inhalt |
| --- | --- |
| **Basis** | Aufgaben, Habits, Kalender, Clipboard, Wissen, Verträge |
| **Business** | + Briefpost-Digitalisierung, Mail-Digest, Mitarbeiter-API (Codriver-Muster) |
| **Assistent** | + Arion Bot mit Claude API, Portal-Watcher, Slack-Filter |

## Rote Linien (nicht verbauen!)

- Keine Modul-Logik an der generischen API vorbei (sonst wird Mandantenfähigkeit teuer).
- Keine kundenspezifischen Sonderfälle im Code – immer über `app_config`/Seeds lösen.
- Externe KI bleibt opt-in pro Instanz (`ANTHROPIC_API_KEY`) – wichtig für
  Datenschutz-Zusagen beim Verkauf.
