// Tests ohne Netzwerk/Datenbank: Bescheinigungen (Briefe erkennen, Lohnzettel lesen, Vorlage bauen).
// Alle Daten sind erfunden. Aufruf: npm run test:bescheinigung
import { test } from "node:test";
import assert from "node:assert/strict";
import { centOf, parseSlips, itemsToLines } from "../lib/lohn-parse.ts";
import { erkenneAnforderung, deDatum, gleicherVorgang, normName } from "../lib/bescheinigung-erkennen.ts";
import { baueVorlage, monatsWerte, waehleQuellen } from "../lib/bescheinigung-vorlage.ts";

const zettelText = (o) => `Arion Logistics GmbH
Industrie Str. 12a
91325 Adelsdorf
                                                                       Firma / Niederlassung            400 07
                                                                       Personalnummer                   ${o.pn}
                                                                       Art der Abrechnung               Endabrechnung
                                                                       Abrechnungsmonat                 ${o.mon}/1
              Arion Logistics GmbH / Industrie Str. 12a / 91325 Adelsdorf Rückgerechnete Monate 2026
                                                                       Geburtsdatum                     01.01.1990
                                                                       Eintrittsdatum                   01.03.2026
                                                                       Austrittsdatum                   ${o.aus ?? ""}
                                                                       Versicherungs-/Verfahrensnr.     12010190M001
              Max Mustermann                                           Steuer-ID                        11111111111
              Musterweg 1
          Entgeltbescheinigung                                 ${o.mon}
          BGRS: 1111 PGR: 101 KK: 013 AOK Bayern Die Ge          2,69% Elterneig./Kinder: N    MIDI/MFB:N/N     SV-Tg.1: ${o.tage ?? 30}
          Tg Lohnart                          KO.TR./Auftr.Nr  T-SL ST SV   Vorgabe  Std./Tg.   Zul.%   Faktor     Betrag
             100 Gehalt                                             01 1                                          ${o.gehalt}
${o.extra ?? ""}          Gesamtbrutto                                                                                            ${o.brutto}
                           Soz-Vers-Brutto             KV                RV              AV            PV
          SV-Brutto  lfd.          ${o.sv}        ${o.sv}           ${o.sv}         ${o.sv}       ${o.sv}
${o.eb ? `          SV-Brutto Einmalb.       ${o.eb}        ${o.eb}\n` : ""}          Netto                                                                                                   ${o.netto}
          Auszahlung / Überweisung                                                                                ${o.netto}
          Jahreswerte
          Gesamtbrutto           99999,99
`;

test("centOf: deutsche Beträge, Minus hinten", () => {
  assert.equal(centOf("1.234,56"), 123456);
  assert.equal(centOf("90,40-"), -9040);
  assert.equal(centOf(""), 0);
});

test("parseSlips: Zettel trennen und Werte lesen", () => {
  const text =
    zettelText({ pn: "00999", mon: "07.2026", gehalt: "2802,60", brutto: "2802,60", sv: "2802,60", netto: "1956,97" }) +
    zettelText({
      pn: "00999",
      mon: "08.2026",
      aus: "13.08.2026",
      tage: 13,
      gehalt: "1175,28",
      extra: "             481 Urlaubsabgeltung                                   02 5                                           391,87\n",
      brutto: "1567,15",
      sv: "1175,28",
      eb: "391,87",
      netto: "1100,00",
    });
  const z = parseSlips(text);
  assert.equal(z.length, 2);
  assert.equal(z[0].name, "Max Mustermann");
  assert.equal(z[0].monat, "2026-07");
  assert.equal(z[0].rvnr, "12010190M001");
  assert.equal(z[0].kk, "AOK Bayern Die Ge");
  assert.equal(z[0].svLfdCt, 280260);
  assert.equal(z[1].austritt, "13.08.2026");
  assert.equal(z[1].svEbCt, 39187);
  assert.equal(z[1].svTage, 13);
  assert.deepEqual(z[1].lohnarten.map((l) => l.nr), ["100", "481"]);
  assert.equal(z[1].lohnarten[1].werte.at(-1), 391.87);
});

test("itemsToLines: Spalten aus x-Positionen, Leerraum-Stücke ignoriert", () => {
  const it = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 4.5 });
  const lines = itemsToLines([it("Personalnummer", 320, 755), it(" ", 390, 755), it("00034", 468, 755), it("Max Muster", 62, 630), it("Steuer-ID", 320, 627)]);
  assert.match(lines[0], /^\s+Personalnummer\s{2,}00034$/);
  assert.match(lines[1], /^\s+Max Muster\s{2,}Steuer-ID$/); // 3 pt Versatz = gleiche Zeile
});

test("deDatum", () => {
  assert.equal(deDatum("01. August 2025"), "01.08.2025");
  assert.equal(deDatum("1. November 2026"), "01.11.2026");
  assert.equal(deDatum("21.12.1986"), "21.12.1986");
  assert.equal(deDatum("irgendwas"), "");
});

const ba = (text, subject = "") => ({ subject, sender: "Bundesagentur für Arbeit", summary: "x", extracted: JSON.stringify({ text }), due_date: "" });

test("erkennt Arbeitsbescheinigung der BA", () => {
  const a = erkenneAnforderung(
    ba(`Mein Zeichen: 727D000001 (Bei jeder Antwort bitte angeben)
Arbeitsbescheinigung für Max Mustermann
(geboren am 01.01.1990; Rentenversicherungsnummer: 12010190M001)
Max Mustermann hat Arbeitslosengeld beantragt und einen Beschäftigungszeitraum vom 01. August 2025 bis zum 30. September 2025 bei Ihnen angegeben.
Ich bitte um Erledigung bis zum 02. Oktober 2026.`)
  );
  assert.equal(a.art, "arbeitsbescheinigung");
  assert.equal(a.person, "Max Mustermann");
  assert.equal(a.rvnr, "12010190M001");
  assert.equal(a.geb, "01.01.1990");
  assert.equal(a.von, "01.08.2025");
  assert.equal(a.bis, "30.09.2025");
  assert.equal(a.frist, "2026-10-02");
  assert.equal(a.zeichen, "727D000001");
  assert.equal(a.erinnerung, false);
});

test("erkennt Nebeneinkommen und Erinnerung", () => {
  const a = erkenneAnforderung(
    ba(`Bescheinigung über Nebeneinkommen
für Herrn Erika Beispiel (geboren am 14. Februar 1992)
Ich habe Sie am 21.09.2026 gebeten ... Diese liegt mir bisher nicht vor.
Ich bitte um Erledigung bis zum 3. November 2026.`)
  );
  assert.equal(a.art, "nebeneinkommen");
  assert.equal(a.person, "Erika Beispiel");
  assert.equal(a.geb, "14.02.1992");
  assert.equal(a.frist, "2026-11-03");
  assert.equal(a.erinnerung, true);
});

test("erkennt Entgeltbescheinigung Krankengeld und DEÜV-Liste", () => {
  const e = erkenneAnforderung({
    subject: "Erinnerung Entgeltbescheinigung",
    sender: "BARMER",
    summary: "",
    extracted: JSON.stringify({ text: "Versichertennummer Y000000001\nEntgeltersatzleistung für unseren Versicherten\n\nMax Mustermann\n\nGeburtsdatum: 01.01.1990\nArbeitsunfähigkeit ab: 08.08.2026" }),
  });
  assert.equal(e.art, "entgeltbescheinigung");
  assert.equal(e.person, "Max Mustermann");
  assert.equal(e.von, "08.08.2026");
  assert.equal(e.zeichen, "Y000000001");

  const d = erkenneAnforderung({
    subject: "Fehlende Entgeltmeldungen / Jahresmeldungen",
    sender: "BKK Test",
    summary: "",
    extracted: JSON.stringify({ text: "Bitte lassen Sie uns diese Meldungen zukommen.\nName: Mustermann, Vorname: Max, Geb.-Dat.: 01.01.1990, RVNR: 12010190M001, Beginn 21.10.2025, Ende 31.12.2025" }),
  });
  assert.equal(d.art, "deuev");
  assert.equal(d.person, "Max Mustermann");
  assert.equal(d.von, "21.10.2025");
  assert.equal(d.bis, "31.12.2025");

  assert.equal(erkenneAnforderung({ subject: "Rechnung", summary: "Strom", extracted: "" }), null);
});

test("gleicherVorgang / normName", () => {
  assert.equal(normName("Cüneyt  Kaplan"), normName("Kaplan, Cuneyt"));
  assert.ok(gleicherVorgang({ art: "arbeitsbescheinigung", person: "A B", rvnr: "X" }, { art: "arbeitsbescheinigung", person: "C", rvnr: "X" }));
  assert.ok(!gleicherVorgang({ art: "nebeneinkommen", person: "A B", rvnr: "" }, { art: "arbeitsbescheinigung", person: "A B", rvnr: "" }));
});

const Z = (monat, sv, extra = {}) => ({
  pn: "00999", monat, name: "Max Mustermann", geb: "01.01.1990", rvnr: "12010190M001", eintritt: "01.03.2026", austritt: "13.08.2026",
  kk: "AOK", bgrs: "1111", pgr: "101", sv_tage: 30, brutto_ct: sv, sv_lfd_ct: sv, sv_eb_ct: 0, netto_ct: Math.round(sv * 0.7),
  lohnarten: [{ nr: "100", text: "Gehalt", werte: [sv / 100] }], ...extra,
});

test("monatsWerte: Korrekturläufe addieren, Nullzettel weg", () => {
  const w = monatsWerte([Z("2026-07", 280260), Z("2026-07", 0, { brutto_ct: 0, lohnarten: [] }), Z("2026-08", 117528)]);
  assert.deepEqual(w.map((x) => [x.monat, x.svLfd]), [["2026-07", 280260], ["2026-08", 117528]]);
});

test("baueVorlage Arbeitsbescheinigung: fehlende Kündigungsangaben, Summe, Abweichung", () => {
  const v = { art: "arbeitsbescheinigung", person: "Max Mustermann", geb: "", rvnr: "12010190M001", stelle: "BA", zeichen: "", von: "01.03.2026", bis: "31.08.2026", frist: "" };
  const t = baueVorlage(v, [Z("2026-07", 280260), Z("2026-08", 117528)], {});
  const ent = t.abschnitte.find((a) => a.titel.startsWith("Arbeitsentgelt"));
  assert.equal(ent.tabelle.zeilen.length, 2);
  assert.match(ent.tabelle.summe[1], /3\.977,88/);
  assert.ok(t.fehlend.some((f) => f.includes("Beendet durch")));
  assert.ok(t.warnungen.some((w) => w.includes("31.08.2026")));
  const voll = baueVorlage(v, [Z("2026-07", 280260)], { beendet_durch: "Arbeitgeber", gekuendigt_am: "13.07.2026", kuendigungsfrist: "30 Kalendertage" });
  assert.ok(!voll.fehlend.some((f) => f.includes("Beendet durch")));
});

test("baueVorlage Nebeneinkommen: Kalenderwochen ab Montag", () => {
  const v = { art: "nebeneinkommen", person: "Max Mustermann", geb: "", rvnr: "12010190M001", stelle: "", zeichen: "", von: "10.06.2026", bis: "17.07.2026", frist: "" };
  const t = baueVorlage(v, [Z("2026-06", 35284), Z("2026-07", 49783), Z("2026-08", 27005)], { wochen: { "08.06.2026": "6,5" } });
  const kw = t.abschnitte.find((a) => a.titel === "Stunden je Kalenderwoche").felder;
  assert.equal(kw[0].woche, "08.06.2026");
  assert.equal(kw[0].wert, "6,5");
  assert.equal(kw.length, 6);
  assert.equal(t.fehlend.filter((f) => f.includes("Woche")).length, 5);
  const monate = t.abschnitte.find((a) => a.titel.startsWith("Arbeitsentgelt")).tabelle.zeilen.map((z) => z[0]);
  assert.deepEqual(monate, ["06.2026", "07.2026"]);
});

test("baueVorlage Entgeltbescheinigung: letzter Monat vor AU, 6 Wochen", () => {
  const v = { art: "entgeltbescheinigung", person: "Max Mustermann", geb: "", rvnr: "12010190M001", stelle: "", zeichen: "", von: "08.08.2026", bis: "", frist: "" };
  const t = baueVorlage(v, [Z("2026-06", 280260), Z("2026-07", 280260), Z("2026-08", 280260)], {});
  const bem = t.abschnitte.find((a) => a.titel.startsWith("Entgelt im letzten")).felder;
  assert.match(bem[0].wert, /^01\.07\.2026/);
  const au = t.abschnitte.find((a) => a.titel === "Arbeitsunfähigkeit").felder;
  assert.equal(au.find((f) => f.label.startsWith("Ende")).wert, "18.09.2026");
});

test("waehleQuellen: pro Monat nur die Datei mit der höchsten Laufnummer", () => {
  const rows = [
    { pn: "1", monat: "2026-09", quelle_id: "a", quelle_name: "2026_09_Verdienstabrechnung_40007_009306_6.pdf" },
    { pn: "1", monat: "2026-09", quelle_id: "b", quelle_name: "2026_09_Verdienstabrechnung_40007_009306_8.pdf" },
    { pn: "1", monat: "2026-09", quelle_id: "b", quelle_name: "2026_09_Verdienstabrechnung_40007_009306_8.pdf" },
    { pn: "1", monat: "2026-08", quelle_id: "c", quelle_name: "2026_08_Verdienstabrechnung_40007_009000_9.pdf" },
  ];
  assert.deepEqual(waehleQuellen(rows).map((r) => r.quelle_id), ["b", "b", "c"]);
});
