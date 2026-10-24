// Ablage-Regeln für die automatische Belegablage. Aufruf: npm run test:beleg
import { test } from "node:test";
import assert from "node:assert/strict";
import { amazonSchonAbgelegt, betragDe, gleicherBeleg, kennzeichenListe, kennzeichenNorm, pfadOk, sauber, zielFuer } from "../lib/beleg-regeln.ts";

test("Duplikat nur bei gleicher oder fehlender Rechnungsnummer", () => {
  const a = { lieferant: "GO EZY (EZY GmbH)", betrag: 1487.74, dateiname: "GO EZY_1.487,74 (RG 2026-MR52979-RENT, SAD-EZ 45).pdf" };
  const b = { lieferant: "GoEzy", betrag: 1487.74, dateiname: "GoEzy_1.487,74 (RG 2026-MR52981-RENT, SAD-EZ 53).pdf" };
  assert.equal(gleicherBeleg(a, b), false);
  assert.equal(gleicherBeleg(a, { ...b, dateiname: a.dateiname }), true);
  assert.equal(gleicherBeleg(a, { ...b, dateiname: "GoEzy_1.487,74.pdf" }), true);
  assert.equal(gleicherBeleg(a, { ...b, betrag: 1309.14 }), false);
  assert.equal(gleicherBeleg(a, { ...b, lieferant: "Allianz" }), false);
});

const basis = {
  seiten: "1", firma: "arion", art: "beleg", kategorie: "sonstiges", lieferant: "Aral", betrag: 19, belegdatum: "2026-05-19",
  kurzinhalt: "Tankquittung", rg_nr: "", kennzeichen: "", fahrzeug_ordner: "", person: "", objekt: "", objekt_ordner: "",
  einnahme: false, bar: false, sicherheit: "hoch",
};
const z = (f) => zielFuer({ ...basis, ...f }, new Date("2026-10-19T10:00:00Z"));

test("Beträge deutsch", () => {
  assert.equal(betragDe(1247.12), "1.247,12");
  assert.equal(betragDe(19), "19,00");
  assert.equal(betragDe(1234567.5), "1.234.567,50");
  assert.equal(betragDe(-5.5), "-5,50");
});

test("Kennzeichen normalisieren", () => {
  assert.equal(kennzeichenNorm("erh al 339"), "ERH-AL 339");
  assert.equal(kennzeichenNorm("MAZ6358E"), "M-AZ 6358E");
  assert.equal(kennzeichenNorm("FÜ-BB 362"), "FÜ-BB 362");
});

test("Arion-Beleg → Monatsordner, Name Lieferant_Betrag", () => {
  assert.deepEqual(z({}), [{ ziel_pfad: "Ausgaben/2026/Mai/Rechnungseingang/Belege", dateiname: "Aral_19,00.pdf" }]);
  assert.equal(z({ rg_nr: "RG/42" })[0].dateiname, "Aral_19,00 (RG RG-42).pdf");
  assert.equal(z({ art: "gutschrift", betrag: 5 })[0].dateiname, "Aral Gutschrift_5,00.pdf");
});

test("Werkstattrechnung → Beleg + Kopie in Fahrzeugakte", () => {
  const r = z({ lieferant: "Autohaus Pickel", betrag: 200.87, kategorie: "fahrzeug", kennzeichen: "erhal339", kurzinhalt: "Inspektion", fahrzeug_ordner: "" });
  assert.equal(r.length, 2);
  assert.equal(r[1].ziel_pfad, "Archiv/Arion Logistics/02 Fahrzeuge/ERH-AL 339/Wartung & TÜV");
  assert.equal(r[1].dateiname, "2026-05-19 Autohaus Pickel – Inspektion_200,87.pdf");
});

test("Mahnung und Lieferschein nicht in Belege", () => {
  assert.equal(z({ art: "mahnung" })[0].ziel_pfad, "Ausgaben/2026/Mai/Sonstiges/Mahnungen");
  assert.equal(z({ art: "lieferschein", betrag: null })[0].ziel_pfad, "Ausgaben/2026/Mai/Sonstiges/Lieferscheine & Sonstiges");
});

test("Arion-Dokumente ins Archiv", () => {
  assert.equal(z({ art: "dokument", kategorie: "personal", person: "Müller, Denise", betrag: null, lieferant: "BARMER", kurzinhalt: "DEÜV-Anmeldung" })[0].ziel_pfad,
    "Archiv/Arion Logistics/03 Personal/Müller, Denise");
  const v = z({ art: "dokument", kategorie: "fahrzeug", kennzeichen: "M-AZ 6358E", fahrzeug_ordner: "Bußgelder", betrag: 30, lieferant: "Stadt Bamberg", kurzinhalt: "Anhörung" })[0];
  assert.equal(v.ziel_pfad, "Archiv/Arion Logistics/02 Fahrzeuge/M-AZ 6358E/Bußgelder");
  assert.equal(v.dateiname, "2026-05-19 Stadt Bamberg – Anhörung_30,00.pdf");
  assert.equal(z({ art: "dokument", kategorie: "behoerde", betrag: null })[0].ziel_pfad, "Archiv/Arion Logistics/06 Behörden & Recht");
});

test("Wohnwerk, privat, unklar", () => {
  assert.equal(z({ firma: "wohnwerk" })[0].ziel_pfad, "Archiv/Wohnwerk/01 Buchhaltung/2026/05 Mai/Ausgaben");
  assert.equal(z({ firma: "wohnwerk", einnahme: true })[0].ziel_pfad, "Archiv/Wohnwerk/01 Buchhaltung/2026/05 Mai/Einnahmen");
  assert.equal(z({ firma: "wohnwerk", art: "dokument", kategorie: "objekt", objekt: "Sankt Michael 27", objekt_ordner: "Mietverträge" })[0].ziel_pfad,
    "Archiv/Wohnwerk/02 Objekte/Sankt Michael 27/Mietverträge");
  assert.deepEqual(z({ firma: "nicht_arion", bar: true })[0], { ziel_pfad: "Scans/_Nicht Arion", dateiname: "Aral_19,00 (bar).pdf" });
  assert.equal(z({ sicherheit: "niedrig" })[0].ziel_pfad, "Archiv/_Unklar");
  assert.equal(z({ firma: "unklar" })[0].ziel_pfad, "Archiv/_Unklar");
});

test("Fehlendes Datum → aktueller Monat; Pfade sicher", () => {
  assert.equal(z({ belegdatum: "" })[0].ziel_pfad, "Ausgaben/2026/Oktober/Rechnungseingang/Belege");
  assert.equal(sauber("../../etc/passwd"), "etc-passwd");
  assert.ok(!pfadOk("Archiv/../x"));
  assert.ok(pfadOk(z({ art: "dokument", kategorie: "personal", person: "../../x" })[0].ziel_pfad));
});

test("Aufträge planen: Stapel, ungenutzte Seiten, ungültige Angabe", async () => {
  const { planeAuftraege } = await import("../lib/buch-klassifizieren.ts");
  const docs = [
    { ...basis, seiten: "1-2" },
    { ...basis, seiten: "4", lieferant: "Autohaus Pickel", betrag: 200.87, kategorie: "fahrzeug", kennzeichen: "ERH-AL 339", kurzinhalt: "Inspektion" },
  ];
  const p = planeAuftraege(docs.map((d) => ({ ...d })), 5, "Scan.pdf", new Date("2026-10-19"));
  assert.deepEqual(p.orders.map((o) => [o.seiten, o.ziel_pfad.split("/").slice(-1)[0], o.zahlung, o.kopie]), [
    ["1-2", "Belege", true, false],
    ["4", "Belege", true, false],
    ["4", "Wartung & TÜV", false, true],
    ["3,5", "_Unklar", false, false],
  ]);
  const bad = planeAuftraege([{ ...basis, seiten: "9" }], 2, "x.pdf");
  assert.equal(bad.orders.length, 1);
  assert.equal(bad.orders[0].seiten, "");
  assert.equal(bad.orders[0].ziel_pfad, "Archiv/_Unklar");
});

test("Amazon-Gutschriften → Rechnungsausgang, Nullbeträge separat", () => {
  const am = { art: "gutschrift", lieferant: "Amazon Deutschland S13 Transport GmbH", rg_nr: "INV-DES4FD0V-0000000374", betrag: 105852.29, belegdatum: "2026-09-23" };
  assert.deepEqual(z(am), [
    { ziel_pfad: "Ausgaben/2026/September/Rechnungsausgang/Amazon Rechnungen", dateiname: "105.852,29€ (RG INV-DES4FD0V-0000000374).pdf" },
  ]);
  assert.equal(z({ ...am, lieferant: "Amazon", betrag: 0 })[0].ziel_pfad, "Ausgaben/2026/September/Rechnungsausgang/Amazon Rechnungen/Nullbeträge");
  // Erstattung eines Amazon-Einkaufs bleibt ein Eingangsbeleg
  assert.equal(z({ art: "gutschrift", lieferant: "Amazon EU S.à r.l.", rg_nr: "DE5AB123", betrag: 12 })[0].ziel_pfad, "Ausgaben/2026/Mai/Rechnungseingang/Belege");
});

test("Amazon-Gutschrift schon abgelegt (Alberts Schreibweisen)", () => {
  const da = ["105.852,29€.pdf", "93.057,34 €.pdf", "100809,17€.pdf", "1.129,90€ (Korrektur 359).pdf"];
  assert.equal(amazonSchonAbgelegt("105.852,29€ (RG INV-1).pdf", da), true);
  assert.equal(amazonSchonAbgelegt("93.057,34€ (RG INV-2).pdf", da), true);
  assert.equal(amazonSchonAbgelegt("100.809,17€ (RG INV-3).pdf", da), true);
  assert.equal(amazonSchonAbgelegt("2.003,23€ (RG INV-4).pdf", da), false);
  assert.equal(amazonSchonAbgelegt("0,00€ (RG INV-5).pdf", ["0,00€ (RG INV-6).pdf"]), false);
});

test("Mehrere Kennzeichen → je Fahrzeugakte eine Kopie", () => {
  assert.deepEqual(kennzeichenListe("FÜ-BB 357, FÜ-DE 319"), ["FÜ-BB 357", "FÜ-DE 319"]);
  assert.deepEqual(kennzeichenListe("erh al 339 und ERH-AL 339"), ["ERH-AL 339"]);
  const r = z({ kategorie: "fahrzeug", kennzeichen: "FÜ-BB 357, FÜ-DE 319", lieferant: "LeasePlan", fahrzeug_ordner: "Leasing & Miete" });
  assert.deepEqual(r.map((x) => x.ziel_pfad).slice(1), [
    "Archiv/Arion Logistics/02 Fahrzeuge/FÜ-BB 357/Leasing & Miete",
    "Archiv/Arion Logistics/02 Fahrzeuge/FÜ-DE 319/Leasing & Miete",
  ]);
});

test("Abgleich: Betrag aus Dateiname, Zuordnung, Monatsordner, 1590-Schlüssel", async () => {
  const r = await import("../lib/abgleich-regeln.ts");
  assert.equal(r.betragAusDateiname("Aral_334,56.pdf"), 334.56);
  assert.equal(r.betragAusDateiname("Sixt_1.211,42 (9603296267 Jan).pdf"), 1211.42);
  assert.equal(r.betragAusDateiname("Amazon 120,17 €.pdf"), 120.17);
  assert.equal(r.betragAusDateiname("Expert_690,00 (RG VR4790109170).pdf"), 690);
  assert.equal(r.betragAusDateiname("Vertrag.pdf"), null);
  assert.equal(r.monatsOrdner("2026-09"), "Ausgaben/2026/September");
  assert.equal(r.nachbarMonat("2026-01", -1), "2025-12");
  assert.equal(r.monatAusPfad("Ausgaben/2026/März/Rechnungseingang/Belege"), "2026-03");

  const dateien = [
    { name: "Sixt_1.211,42 (9603296336 Jan).pdf", url: "a", pfad: "1590/2026" },
    { name: "Sixt_1.211,42 (9603296267 Jan).pdf", url: "b", pfad: "1590/2026" },
    { name: "Amazon_41,42.pdf", url: "c", pfad: "1590/2026" },
  ];
  const m = r.ordneZu(
    [
      { key: 1, betrag: 1211.42, text: "Sixt, Beleg fehlt", belegnr: "9603296267" },
      { key: 2, betrag: 1211.42, text: "Sixt, Beleg fehlt", belegnr: "9603296336" },
      { key: 3, betrag: 41.42, text: "Amazon, Beleg fehlt" },
      { key: 4, betrag: 41.42, text: "Amazon, Beleg fehlt" },
    ],
    dateien
  );
  assert.equal(m.get(1)?.url, "b");
  assert.equal(m.get(2)?.url, "a");
  assert.equal(m.get(3)?.url, "c");
  assert.equal(m.has(4), false); // jede Datei nur einmal

  assert.equal(r.ohneBelegGrund({ operation_type: "qonto_fee" }), "Qonto-Gebühr (Rechnung in Qonto)");
  assert.equal(r.ohneBelegGrund({ operation_type: "transfer", referenz: "Lohn 09/2026" }), "Lohn/Gehalt");
  assert.equal(r.ohneBelegGrund({ operation_type: "card", label: "Aral" }), null);
  assert.equal(r.ohneBelegGrund({ label: "Max Muster", gemerkt: ["max muster"] }), "gemerkt");

  const keys = r.schluessel1590([
    { datum: "2026-02-15", text: "Amazon, Beleg fehlt", betrag: 41.42, belegnr: "" },
    { datum: "2026-02-15", text: "Amazon, Beleg fehlt", betrag: 41.42, belegnr: "" },
  ]);
  assert.notEqual(keys[0], keys[1]);
  assert.equal(r.dateiname1590("Sixt, Beleg fehlt", 1211.42, "9603296267", "pdf"), "Sixt_1.211,42 (9603296267).pdf");
});
