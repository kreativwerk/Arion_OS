// Leitstand: Amazon-Zahlungsavis und Ampel-Regeln. Aufruf: npm run test:leitstand
import { test } from "node:test";
import assert from "node:assert/strict";
import { amazonAvis, amazonBetrag, amazonDatum, leitstandBereiche, leitstandKopf } from "../lib/leitstand.ts";

const AVIS_BODY = `*****************PLEASE DO NOT RESPOND TO THIS EMAIL********************
If you have a query regarding this payment please e-mail eu-ap-freight@amazon.co.uk
The following payment has been made by Amazon Deutschland S13 Transport Gm. It will be paid by bank transfer directly into your bank account.
Payment made to: ARION LOGISTICS GMBH:AMAZON LOGISTICS:FREIGHT(NBIKG)
Payment number: 372974455
Payment date: 09-NOV-2026
Invoice Number Invoice Date Invoice Description Discount Taken Amount Paid Amount Remaining
INV-DES4FD0V-0000000419 03-NOV-2026 Amazon Flex - Week 202645 - DBY5 18,345.55 0.00
INV-S4FD0V-0000000414 31-OCT-2026 Amazon Flex - Week 202644 - DBY5 93,222.76 0.00`;

test("Amazon-Datum und -Betrag", () => {
  assert.equal(amazonDatum("09-NOV-2026"), "2026-11-09");
  assert.equal(amazonDatum("3-Sep-2026"), "2026-09-03");
  assert.equal(amazonDatum("quatsch"), "");
  assert.equal(amazonBetrag("93,222.76"), 93222.76);
  assert.equal(amazonBetrag("(2,947.11)"), -2947.11);
});

test("Zahlungsavis: Nummer, Datum, Zahler, Posten, Summe", () => {
  const a = amazonAvis("Remittance Advice - ARION LOGISTICS GMBH:AMAZON LOGISTICS:FREIGHT(NBIKG) Payment# 372974455", AVIS_BODY);
  assert.ok(a);
  assert.equal(a.nummer, "372974455");
  assert.equal(a.zahlungsdatum, "2026-11-09");
  assert.equal(a.zahler, "Amazon Deutschland S13 Transport Gm");
  assert.equal(a.posten.length, 2);
  assert.deepEqual(a.posten[0], { rechnung: "INV-DES4FD0V-0000000419", datum: "2026-11-03", station: "DBY5", woche: "202645", betrag: 18345.55 });
  assert.equal(a.summe, 111568.31);
});

test("Zahlungsavis: Gutschrift in Klammern wird abgezogen, fremde Mails ignoriert", () => {
  const body = AVIS_BODY.replace("18,345.55 0.00", "(297.89) (533.55)").replace(/DBY5/g, "DBY8");
  const a = amazonAvis("Remittance Advice - X Payment# 1", body);
  assert.equal(a.posten[0].betrag, -297.89);
  assert.equal(a.posten[0].station, "DBY8");
  assert.equal(amazonAvis("Bestellt: Kaffee", AVIS_BODY), null);
});

const basis = () => ({
  today: "2026-11-09",
  eigeneStationen: ["DBY5", "DBZ4"],
  konto: { saldo: 50000, stand: "2026-11-08", summe7: 1000, lastschriften: [] },
  amazon: [],
  buchhaltung: { monat: "2026-10", fehlt_anzahl: 0, fehlt_summe: 0, eingang_neu: 0, naechste_frist: null },
  vorgaenge: { beiDir: 0, ueberfaellig: 0, nachhaken: 0, wartet: 2, dringend: [] },
  entwuerfe: 0,
  eingang: { briefe: 0, mails: 0, mitarbeiter: 0, gesamt: 0 },
  fristen: [],
  station: { verbunden: true, abwesend: 3, offeneAntraege: 0, vorfaelle: [] },
  flotte: { verbunden: true, gesamt: 90, ausgefallen: [] },
});
const ampel = (bereiche, id) => bereiche.find((b) => b.id === id).ampel;

test("Ampeln: alles ruhig → grün, Kopf sagt es", () => {
  const b = leitstandBereiche(basis());
  for (const x of b) assert.equal(x.ampel, "gruen", x.id);
  assert.equal(leitstandKopf(b).satz, "Alles im grünen Bereich.");
});

test("Ampeln: Geld rot, wenn der Saldo die Lastschriften nicht deckt; gelb bei fremder Station", () => {
  const x = basis();
  x.konto.saldo = 500;
  assert.equal(ampel(leitstandBereiche(x), "geld"), "rot");
  const y = basis();
  y.amazon = [amazonAvis("Remittance Advice Payment# 2", AVIS_BODY.replace(/DBY5/g, "DMU2"))];
  const g = leitstandBereiche(y).find((b) => b.id === "geld");
  assert.equal(g.ampel, "gelb");
  assert.match(g.punkte.map((p) => p.text).join(" "), /Unbekannte Station DMU2/);
  const z = basis();
  z.konto.saldo = null;
  assert.equal(ampel(leitstandBereiche(z), "geld"), "grau");
});

test("Ampeln: Vorgänge, Fristen, Buchhaltung, Codriver", () => {
  const x = basis();
  x.vorgaenge = { beiDir: 5, ueberfaellig: 1, nachhaken: 0, wartet: 0, dringend: [] };
  x.fristen = [{ titel: "USt-VA", datum: "2026-11-11", tage: 2, href: "/buchhaltung" }];
  x.buchhaltung.fehlt_anzahl = 75;
  x.station.verbunden = false;
  x.flotte.ausgefallen = [{ kennzeichen: "M-AZ 1", status: "Defekt" }];
  const b = leitstandBereiche(x);
  assert.equal(ampel(b, "vorgaenge"), "rot");
  assert.equal(ampel(b, "fristen"), "gelb");
  assert.equal(ampel(b, "buchhaltung"), "rot");
  assert.equal(ampel(b, "station"), "grau");
  assert.equal(ampel(b, "flotte"), "gelb");
  assert.equal(b.find((y) => y.id === "flotte").kennzahl, "89/90");
  const k = leitstandKopf(b);
  assert.equal(k.rot, 2);
  assert.match(k.satz, /Sofort ansehen: Buchhaltung, Vorgänge\./);
});
