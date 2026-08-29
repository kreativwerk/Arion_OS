---
name: grillme
description: Pläne, Features und Scope für Arion OS kritisch grillen, bevor gebaut wird. Nutzen bei jeder größeren Anforderung oder bevor eine Integration versprochen wird.
---

# grillme – Kritische Prüfung vor dem Bauen

Bevor eine Anforderung umgesetzt wird, diese Fragen ehrlich beantworten und die
Antworten dem Nutzer transparent machen:

## Die Grill-Fragen

1. **Was ist der Kern?** Welche 20 % der Anforderung liefern 80 % des Nutzens?
   Zuerst das bauen, Rest als dokumentierte Ausbaustufe.
2. **Was kann Software hier ehrlich leisten?** Live-Zugriffe (Postfächer, Portale
   mit Login, Slack) brauchen Zugangsdaten, Jobs und Wartung – nie als „funktioniert
   einfach" verkaufen. Immer sagen, was manuell bleibt, bis die Integration steht.
3. **Wer pflegt die Daten?** Jedes Feature, das laufende Pflege braucht, nennt die
   Person (Nutzer, Mitarbeiter, Cron-Job). Features ohne Pfleger verrotten.
4. **Was passiert bei Ausfall?** Jede Integration muss ausfallen dürfen, ohne die
   App zu beschädigen (Zulieferer-Prinzip aus gstack).
5. **Verkaufsfähigkeit:** Würde ein zweiter Kunde dieses Feature so nutzen können?
   Wenn nein: Kundenspezifisches in Konfiguration/Seeds auslagern, nicht in Code.
6. **Datenschutz:** Verträge, Post, Mails sind sensibel. Neue Features dürfen Daten
   nicht ungefragt an Dritte senden; externe KI-Aufrufe (Claude API) sind opt-in
   per API-Key und werden dokumentiert.

## Ausgabeformat

Kurz und ehrlich, keine Schönfärberei:
- **Bauen wir jetzt:** …
- **Geht erst mit Einrichtung (und so geht sie):** …
- **Raten wir ab, weil:** …
