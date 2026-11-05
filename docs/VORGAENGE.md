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
- **Dokumente am Vorgang** (Heute → Jetzt dran, Fristen-Ampel): Zeilen `Dokument: brief N` / `Dokument: mail ID/Teil` im Stand und alle Briefe mit `letters.task_id` = Vorgang. Ein Tipp öffnet das PDF.
- **Mit Qonto bezahlen** (`lib/zahlung.ts`, `components/BezahlSheet.tsx`): Steht im Titel oder nächsten Schritt ein Zahlwort (überweisen, Mahnung, Rechnung, …) und ein Betrag, zeigt die Karte den Knopf. Das Sheet liest Empfänger, IBAN/BIC (erste gültige IBAN im Brieftext, eigene `QONTO_IBAN` ausgenommen), Betrag und Verwendungszweck (Ref./Rechnung aus dem nächsten Schritt, sonst Brief-Referenz) – alles zum Kopieren, dazu Dokument und Sprung nach Qonto. Arion OS überweist nichts; Albert gibt die Zahlung in Qonto frei und hakt danach ab.
- **Abhaken** (`/api/tasks/complete`): setzt verknüpfte Briefe auf erledigt (`archiv`).

Claude pflegt die Felder beim Anlegen und bei jedem neuen Stand mit.
Plan und Alltag: Dokument „Arion OS – Neuordnung und Alltag“.
