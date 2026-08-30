# Deployment auf Vercel

Arion OS ist für Vercel vorbereitet: Next.js (App Router), Datenbank auf Supabase
(SQLite ist auf Vercel bewusst deaktiviert – ohne `DATABASE_URL` startet die App dort
mit einer klaren Fehlermeldung).

## 1. Projekt verbinden (einmalig, ~3 Minuten)

1. [vercel.com/new](https://vercel.com/new) öffnen und mit GitHub anmelden.
2. Repository **`kreativwerk/Arion_OS`** importieren
   (Branch `claude/personal-task-knowledge-dashboard-jv95sw` oder nach dem Merge `main`).
3. Framework wird automatisch als **Next.js** erkannt – nichts ändern.
4. Unter **Environment Variables** eintragen (Production + Preview):

   | Variable | Wert |
   | --- | --- |
   | `DATABASE_URL` | Supabase-Projekt „Arion OS" → Connect → **Transaction pooler** URI, Passwort einsetzen |
   | `VAPID_PUBLIC_KEY` | aus Schritt 2 (Push) |
   | `VAPID_PRIVATE_KEY` | aus Schritt 2 (Push) |
   | `VAPID_SUBJECT` | `mailto:info@arion-logistics.de` |
   | `ANTHROPIC_API_KEY` | optional – Jarvis antwortet dann frei formuliert |

5. **Deploy** klicken. Jeder Push auf den Branch deployt danach automatisch.

> Zugriffsschutz: Die App hat bewusst keinen eigenen Login (Single-User).
> Auf Vercel unter **Settings → Deployment Protection** „Vercel Authentication"
> aktivieren oder das Projekt hinter eine eigene Domain mit Schutz legen,
> bis die Auth-Stufe aus `docs/SAAS.md` gebaut ist. Die Codriver-API
> (`/api/external/tasks`) braucht bei aktivierter Deployment Protection eine
> Ausnahme (Protection Bypass for Automation) oder die Auth-Stufe.

## 2. Push-Benachrichtigungen (PWA)

Einmalig VAPID-Schlüssel erzeugen:

```bash
npx web-push generate-vapid-keys
```

Beide Schlüssel als `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` bei Vercel (und lokal in
`.env.local`) hinterlegen. Danach:

1. Deployte App auf dem iPhone in **Safari** öffnen → Teilen → **„Zum Home-Bildschirm"**.
2. Die installierte App vom Homescreen starten (wichtig für iOS, ab 16.4).
3. **Einstellungen → Benachrichtigungen → „Auf diesem Gerät aktivieren"** und erlauben.
4. Mit **„Test senden"** prüfen.

Benachrichtigt wird aktuell bei **neuen Aufgaben aus Codriver** (weitere Auslöser sind
eine Zeile Code: `sendPushToAll()` aus `lib/push.ts`). Android und Desktop-Browser
funktionieren auch ohne Installation.

## 3. Lokal weiterarbeiten

- Ohne `DATABASE_URL` in `.env.local` → lokale SQLite-Datenbank (`data/arion.db`).
- Mit `DATABASE_URL` → dieselbe Supabase-Datenbank wie die deployte App.
