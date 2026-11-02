# Vorgänge

Jede Sache, die erledigt werden muss, ist **ein Vorgang** (Tabelle `tasks`).
Briefe (`letters.task_id`) und Mail-Entwürfe (`mail_drafts.task_id`) hängen am Vorgang.

| Feld | Bedeutung |
| --- | --- |
| `wer_dran` | leer/`albert` = bei Albert · `claude` · `mitarbeiter` · `extern` |
| `wartet_auf` | Name, wenn jemand anderes dran ist (z. B. „SD Worx“) |
| `naechster_schritt` | ein Satz, steht auf der Karte |
| `nachhaken_am` | YYYY-MM-DD – ab dann wieder bei Albert („nachhaken“) |

Status (lib/vorgang.ts, `vorgangStatus`): `ich` · `nachhaken` · `wartet` · `erledigt`.

- **Vorgänge-Seite** (`/aufgaben`): Ich dran · Wartet · Langfristig. Klick auf einen Vorgang: wer ist dran, wartet auf, nachhaken, nächster Schritt.
- **Startseite, Offene Fälle**: zuerst Nachhaken und Ich dran, dann Wartet; zeigt den nächsten Schritt.
- **Tagesbericht, To-dos für dich**: nur, was bei Albert liegt oder wo Nachhaken fällig ist.
- **Abhaken** (`/api/tasks/complete`): setzt verknüpfte Briefe auf erledigt (`archiv`).

Claude pflegt die Felder beim Anlegen und bei jedem neuen Stand mit.
Plan und Alltag: Dokument „Arion OS – Neuordnung und Alltag“.
