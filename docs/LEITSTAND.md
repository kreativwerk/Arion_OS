# Leitstand

Seite `/leitstand` (Navigation unter „Heute“): alle Bereiche auf einen Blick, je Bereich eine Ampel.
Rot = jetzt handeln · Gelb = ansehen · Grün = läuft · Grau = Quelle fehlt. Rote Karten stehen oben.

| Bereich | Quelle | Rot | Gelb |
| --- | --- | --- | --- |
| Geld | Qonto-Saldo (`buch_kennzahlen`), Lastschrift-Mails, Amazon-Zahlungsavise | Saldo deckt die Lastschriften der nächsten 7 Tage nicht | Zahlung für eine fremde Station (nicht DBY5/DBZ4) |
| Buchhaltung | `dashboardBuchhaltung` | > 20 Abbuchungen ohne Beleg oder Frist überschritten | Belege fehlen oder Frist in ≤ 5 Tagen |
| Vorgänge | `tasks` (wie „Jetzt dran“) | Frist überschritten | etwas liegt bei Albert, Nachhaken fällig, Entwurf wartet |
| Fristen | `fristen()` (Buchhaltung, Vorgänge, Verträge, Termine) | abgelaufen | in ≤ 3 Tagen |
| Eingang | `eingangZahlen` | > 100 offen | > 0 offen |
| Station & Personal | Codriver (`codriver_docs`) | – | Unfall in den letzten 7 Tagen, offener Antrag |
| Flotte | Codriver (`codriver_docs`) | > 5 Fahrzeuge ausgefallen | ≥ 1 ausgefallen |

- Regeln: `lib/leitstand.ts` (rein, getestet in `tests/leitstand.test.mjs`), Daten: `app/api/leitstand/route.ts` (nur lesend).
- Amazon-Zahlungsavise („Remittance Advice“) der letzten 14 Tage werden ausgelesen und nach Zahlungsnummer
  zusammengefasst; Posten für Stationen außerhalb von `EIGENE_STATIONEN` werden gelb markiert.
- Codriver-Bereiche bleiben grau, bis der Codriver-Sync wieder Daten in `codriver_docs` schreibt.
