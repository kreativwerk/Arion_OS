// Ablage-Regeln für die automatische Belegablage. Aufruf: npm run test:beleg
import { test } from "node:test";
import assert from "node:assert/strict";
import { betragDe, kennzeichenNorm, pfadOk, sauber, zielFuer } from "../lib/beleg-regeln.ts";

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
