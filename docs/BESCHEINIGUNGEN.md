# Bescheinigungen (Arbeitsagentur, Krankenkassen, DEÜV)

Arion OS bereitet Bescheinigungen selbst vor, statt auf das Lohnbüro zu warten.
**Abgegeben wird ausschließlich elektronisch im SV-Meldeportal** (sv-meldeportal.de) –
Arbeitsagentur und Kassen nehmen weder Papier noch Lohnabrechnungen an. Das Portal
bedient ein Mensch (Login mit dem ELSTER-Organisationszertifikat der Firma); Arion OS
liefert Feld für Feld, was einzutragen ist.

## Ablauf

1. **Briefpost → Vorgang** (`lib/bescheinigung-erkennen.ts`): Nach jedem
   Briefkasten-Lauf (`/api/cron/letterbox`) werden neue Briefe auf Anforderungen
   geprüft:
   - Arbeitsbescheinigung nach § 312 SGB III (BA)
   - Bescheinigung über Nebeneinkommen nach § 313 SGB III (BA)
   - Entgeltbescheinigung für Kranken-/Verletztengeld (Kasse, EEL)
   - fehlende DEÜV-Meldungen (An-/Ab-/Jahresmeldung)

   Erkannt werden Person, Geburtsdatum, RV-Nummer, Zeichen, Zeitraum und Frist.
   Erinnerungen hängen sich an den bestehenden Vorgang (gleiche Art + RV-Nummer
   bzw. Name) und ziehen die Frist nach. Stand: `app_config.bescheinigung_brief_cursor`.
2. **Verdienstabrechnungen → `lohn_zettel`** (`lib/lohn-parse.ts`): Die SD-Worx-
   Sammel-PDFs `JJJJ_MM_Verdienstabrechnung_40007_….pdf` werden im Drive gesucht
   (Duplikate übersprungen), gelesen (unpdf, Text mit Spaltenlayout) und je
   Mitarbeiter als Zettel gespeichert: SV-Brutto laufend/Einmalbezug, Brutto,
   Netto, Lohnarten, Ein-/Austritt, Kasse, Beitrags-/Personengruppe. Beträge in
   Cent. Pro Datei einmal (`lohn_importe`), im Drive ändert sich nichts.
   Liegt ein Monat in mehreren Dateien, zählt die mit der höchsten Laufnummer.
3. **Vorlage** (`lib/bescheinigung-vorlage.ts`): Vorgang + Zettel + Angaben, die nur
   ein Mensch kennt (Kündigung, Wochenstunden, AU-Daten, Stunden je Kalenderwoche),
   ergeben die Ausfüllvorlage. Fehlende Angaben und Unstimmigkeiten (andere
   RV-Nummer, anderes Enddatum, Korrekturläufe) stehen als Hinweise darüber.

## Seite `/bescheinigungen`

Vorgänge mit Frist und Status (Offen → Bei SD Worx → Gesendet → Erledigt). Aufklappen
zeigt die Vorlage mit Kopier-Knopf je Feld; fehlende Angaben werden direkt dort
eingetragen (gespeichert in `bescheinigungen.angaben`). Knöpfe „Briefpost prüfen“
(`POST /api/bescheinigungen {aktion:"erkennen"}`) und „Abrechnungen lesen“
(`{aktion:"lohn"}`).

## Datenschutz

`bescheinigungen`, `lohn_zettel` und `lohn_importe` enthalten Personaldaten und sind
auf Supabase per RLS für die öffentliche API gesperrt (die App verbindet als Owner).
Bankverbindungen und Steuer-IDs aus den Abrechnungen werden nicht gespeichert.
