# Codriver-Anbindung

Mitarbeiter tragen über die firmeneigene App **Codriver** Aufgaben für den Nutzer ein.
Die Aufgaben landen im **Eingang** des Aufgaben-Moduls (sichtbar auch auf dem
Heute-Dashboard) und werden dort **angenommen oder abgelehnt** – nichts rutscht
ungeprüft in die To-do-Liste.

## 1. Token erstellen

In Arion OS unter **Einstellungen → API-Zugänge** einen Token mit der Bezeichnung
`Codriver` erstellen. Der Token (`arion_…`) wird **nur einmal** angezeigt – sicher in der
Codriver-Server-Konfiguration hinterlegen (niemals in die Mobile-App selbst einbauen).
Ein Token kann jederzeit widerrufen werden; „zuletzt genutzt" zeigt, ob er aktiv ist.

## 2. Endpunkt

```
POST {ARION_OS_URL}/api/external/tasks
Authorization: Bearer arion_…
Content-Type: application/json
```

### Request-Body

| Feld | Pflicht | Typ | Beschreibung |
| --- | --- | --- | --- |
| `title` | ✅ | string (≤ 500) | Aufgabentitel |
| `submitted_by` | ✅ | string | Name des Mitarbeiters, der die Aufgabe einträgt |
| `notes` | – | string (≤ 2000) | Details |
| `due_date` | – | `YYYY-MM-DD` | Fälligkeitsdatum |
| `priority` | – | 1 \| 2 \| 3 | 1 = hoch, 2 = normal (Default), 3 = niedrig |
| `project` | – | string (≤ 200) | Projekt/Bereich |

### Beispiel

```bash
curl -X POST "$ARION_OS_URL/api/external/tasks" \
  -H "Authorization: Bearer $ARION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Palettenstellplätze Lager Nord prüfen",
    "submitted_by": "Markus Weber",
    "due_date": "2026-09-05",
    "priority": 2,
    "notes": "Reihe 4 wirkt überbelegt"
  }'
```

### Antworten

| Status | Bedeutung |
| --- | --- |
| `201` | `{ "ok": true, "id": 42, "status": "im Eingang – wartet auf Annahme" }` |
| `400` | Feld fehlt/ungültig (`error` beschreibt das Problem) |
| `401` | Token fehlt oder ungültig/widerrufen |

## 3. Verhalten in Arion OS

- Die Aufgabe erscheint mit Badge „von *Mitarbeitername*" und Quelle `codriver`.
- Bis zur Annahme (`accepted = 0`) taucht sie **nicht** in „Heute fällig" auf –
  nur im Eingang und als Hinweis auf dem Dashboard.
- Annehmen ⇒ normale Aufgabe (Short Term). Ablehnen ⇒ gelöscht.

## 4. Erweiterungen (bei Bedarf)

- **Rückkanal:** Ein `GET /api/external/tasks?since=…` für Codriver, um den Status
  („angenommen/erledigt") anzuzeigen – einfach ergänzbar, gleiche Token-Auth.
- Weitere Zulieferer (Scanner-App für Briefpost, Watcher-Jobs) nutzen dasselbe
  Token-System mit eigener Bezeichnung.
