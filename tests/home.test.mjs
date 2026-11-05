// Startseiten-Widgets und Qonto-Auswertung. Aufruf: npm run test:home
import { test } from "node:test";
import assert from "node:assert/strict";
import { STANDARD_LAYOUT, moveItem, normalizeLayout, parseEuro, parseQontoEingang, parseQontoLastschrift } from "../lib/home-widgets.ts";

test("Layout: leer → Standard, Unbekanntes raus, Fehlendes ergänzt", () => {
  assert.equal(normalizeLayout(null).length, STANDARD_LAYOUT.length);
  const l = normalizeLayout('[{"id":"konto","an":false},{"id":"quatsch"},{"id":"konto"},{"id":"aufgaben","breit":true}]');
  // Gespeicherte Einträge behalten Einstellungen und Reihenfolge
  assert.deepEqual(l[0], { id: "konto", an: false, breit: false });
  const aufgaben = l.find((x) => x.id === "aufgaben");
  assert.deepEqual(aufgaben, { id: "aufgaben", an: true, breit: true });
  assert.ok(l.indexOf(aufgaben) > 0);
  assert.equal(l.length, STANDARD_LAYOUT.length);
  assert.equal(new Set(l.map((x) => x.id)).size, l.length);
});

test("Neues Widget landet hinter seinem Vorgänger statt ganz unten", () => {
  // Gespeichertes Layout von vor „Fälle mit Claude“: faelle fehlt
  const alt = STANDARD_LAYOUT.filter((x) => x.id !== "faelle").reverse();
  const l = normalizeLayout(JSON.stringify(alt));
  const iWartet = l.findIndex((x) => x.id === "wartet");
  assert.equal(l[iWartet + 1].id, "faelle");
  assert.equal(l.length, STANDARD_LAYOUT.length);
  // Ohne Vorgänger im Layout: ans Ende
  const ohne = normalizeLayout('[{"id":"konto"}]');
  assert.equal(ohne[0].id, "konto");
});

test("Verschieben an den Rändern bleibt stabil", () => {
  const l = normalizeLayout(null);
  assert.equal(moveItem(l, l[0].id, -1), l);
  assert.equal(moveItem(l, l[0].id, 1)[1].id, l[0].id);
});

test("Qonto-Mails auswerten", () => {
  assert.equal(parseEuro("1.349,82 EUR"), 1349.82);
  assert.equal(parseEuro("470,00 EUR"), 470);
  assert.deepEqual(parseQontoEingang("Hallo Albert,\nBetrag: 470,00 EUR\nVon: Liridon Shkodra\nKonto: Hauptkonto"), { betrag: 470, von: "Liridon Shkodra" });
  assert.equal(parseQontoEingang("kein Betrag"), null);
  assert.deepEqual(
    parseQontoLastschrift("ALD AutoLeasing D GmbH wird Ihr Konto am 21. Okt 2026 belasten", "…\nBetrag: 34.824,71 EUR\nKonto: Hauptkonto"),
    { an: "ALD AutoLeasing D GmbH", datum: "2026-10-21", betrag: 34824.71 }
  );
  assert.equal(parseQontoLastschrift("E.ON Energie Deutschland GmbH wird Ihr Konto am 3. Mär 2027 belasten", "").datum, "2027-03-03");
});

test("Entwurf: Vorschau und Push-Text", async () => {
  const { entwurfVorschau } = await import("../lib/home-data.ts");
  assert.equal(entwurfVorschau("Hallo Dennis,\r\n\r\nanbei   die Unterlagen.\n\nViele Grüße"), "Hallo Dennis, anbei   die Unterlagen. Viele Grüße");
  assert.equal(entwurfVorschau("x".repeat(300), 20).length, 20);
  const { draftPushPayload } = await import("../lib/draft-notify.ts");
  const p = draftPushPayload({ id: 7, to_addr: "a@b.de, c@d.de", subject: "Hallo", dateien: 3 });
  assert.equal(p.title, "Entwurf wartet: an a@b.de");
  assert.match(p.body, /Hallo · 3 Anhänge/);
  assert.equal(p.url, "/?entwurf=7");
  assert.equal(draftPushPayload({ id: 1, to_addr: "", subject: "", dateien: 1 }).body.startsWith("(ohne Betreff) · 1 Anhang"), true);
});

test("Fälle: Zeile „SD Worx: …“ wird zum Status", async () => {
  const { sdworxAusStand } = await import("../lib/home-data.ts");
  const a = sdworxAusStand("SD Worx: weitergeleitet 22.10.\nBrief der BA, Frist 21.10.");
  assert.equal(a.sdworx.status, "weitergeleitet");
  assert.equal(a.stand, "Brief der BA, Frist 21.10.");
  assert.equal(sdworxAusStand("Text\nSD Worx: nicht weitergeleitet").sdworx.status, "offen");
  assert.equal(sdworxAusStand("SD Worx: wartet auf unsere Wochenstunden").sdworx.status, "wartet");
  assert.equal(sdworxAusStand("ohne Bezug").sdworx, null);
});

test("Fälle: Zeile „Frist: …“ wird zur Frist", async () => {
  const { fristAusStand } = await import("../lib/home-data.ts");
  const a = fristAusStand("Frist: 03.11.2026\nBA mahnt.");
  assert.equal(a.frist, "2026-11-03");
  assert.equal(a.stand, "BA mahnt.");
  assert.equal(fristAusStand("Frist: 9.11.", 2026).frist, "2026-11-09");
  assert.equal(fristAusStand("keine").frist, null);
});

test("Fall: Dokument-Zeilen werden zu Öffnen-/Download-Links", async () => {
  const { dokumenteAusStand } = await import("../lib/home-data.ts");
  const a = dokumenteAusStand("Frist: 02.11.2026\nDokument: brief 37 – Zahlungserinnerung\nDokument: mail 24224/2\nBis 02.11. zahlen.");
  assert.equal(a.stand, "Frist: 02.11.2026\nBis 02.11. zahlen.");
  assert.equal(a.dokumente.length, 2);
  assert.deepEqual(a.dokumente[0], { art: "brief", name: "Zahlungserinnerung", oeffnen: "/api/letters/37", download: "/api/letters/37?download=1" });
  assert.equal(a.dokumente[1].art, "mail");
  assert.equal(a.dokumente[1].name, "");
  assert.equal(a.dokumente[1].oeffnen, "/api/mail/attachment?id=24224&part=2&inline=1");
  assert.equal(a.dokumente[1].download, "/api/mail/attachment?id=24224&part=2");
  // Mail ohne Anhang-Teil ist kein Dokument, Text bleibt unverändert
  const b = dokumenteAusStand("Dokument: mail 403\nText");
  assert.equal(b.dokumente.length, 0);
  assert.equal(dokumenteAusStand("ohne Dokument").stand, "ohne Dokument");
});

// ── Zahlungsdaten für „Mit Qonto bezahlen“ (lib/zahlung.ts) ──
import { ibanAusText, ibanGueltig, zahlungAus, zweckAus } from "../lib/zahlung.ts";
import { jetztAuswaehlen } from "../lib/home-data.ts";

test("IBAN: Prüfziffer und erste fremde IBAN aus dem Brieftext", () => {
  assert.equal(ibanGueltig("DE59 3608 0080 0525 9435 00"), true);
  assert.equal(ibanGueltig("DE59 3608 0080 0525 9435 01"), false);
  const text = "Steuer-Nr.: 25/207/00992\nCommerzbank AG, Essen BIC DRESDEFF360 IBAN DE59 3608 0080 0525 9435 00\nDeutsche Bank AG, Hannover BIC DEUTDE2HXXX IBAN DE72 2507 0070 0060 0338 00\nSeite 1";
  assert.deepEqual(ibanAusText(text), { iban: "DE59 3608 0080 0525 9435 00", bic: "DRESDEFF360" });
  // eigene IBAN wird übersprungen
  assert.equal(ibanAusText(text, ["DE59360800800525943500"])?.iban, "DE72 2507 0070 0060 0338 00");
  assert.equal(ibanAusText("keine Bankverbindung"), null);
});

test("Verwendungszweck: Ref. / Rechnung aus dem nächsten Schritt, sonst aus der Referenz", () => {
  assert.equal(zweckAus("614,50 EUR bis 06.11. überweisen (Ref. 1001050000049325) oder …", "Sixt", ""), "1001050000049325");
  assert.equal(zweckAus("1.288,30 € an TÜV NORD überweisen (Rechnung 5355709765)", "", ""), "5355709765");
  assert.equal(zweckAus("", "Landesjustizkasse", "Kassenzeichen 614261415201 · ReNr. 823361187658"), "614261415201");
});

test("Zahlung: Mahnung mit Betrag und Brief → Überweisungsdaten, Arbeitsbescheinigung → keine", () => {
  const z = zahlungAus(
    { titel: "TÜV NORD – Mahnung 1.288,30 € (letzte Frist 06.11.)", schritt: "1.288,30 € an TÜV NORD überweisen (Rechnung 5355709765)", notes: "" },
    [{ sender: "TÜV NORD Mobilität GmbH & Co. KG", reference: "EARG7292 · 5355709765", text: "Commerzbank AG BIC DRESDEFF360 IBAN DE59 3608 0080 0525 9435 00" }]
  );
  assert.deepEqual(z, { empfaenger: "TÜV NORD Mobilität GmbH & Co. KG", iban: "DE59 3608 0080 0525 9435 00", bic: "DRESDEFF360", betrag: 1288.3, zweck: "5355709765" });
  // Sixt ohne erkannten Brieftext: Betrag und Referenz da, IBAN fehlt
  const s = zahlungAus(
    { titel: "Sixt: letzte Erinnerung Schaden 9079072965 (614,50 €, M-TA 4227)", schritt: "614,50 EUR bis 06.11. überweisen (Ref. 1001050000049325)", notes: "" },
    [{ sender: "Sixt GmbH & Co. Autovermietung KG (Schadenregulierung)", reference: "Schadennr. 9079072965", text: "" }]
  );
  assert.equal(s?.betrag, 614.5);
  assert.equal(s?.iban, null);
  assert.equal(s?.empfaenger, "Sixt GmbH & Co. Autovermietung KG");
  assert.equal(s?.zweck, "1001050000049325");
  // Kein Zahlvorgang, auch wenn der Brief eine IBAN im Fuß hat
  assert.equal(
    zahlungAus({ titel: "David Reng – Arbeitsbescheinigung", schritt: "SD Worx übermittelt per BEA", notes: "" }, [{ text: "IBAN DE50 7600 0000 0076 0016 17" }]),
    null
  );
});

test("Jetzt dran: Dokumente aus den Zeilen „Dokument: …“ am Vorgang", () => {
  const j = jetztAuswaehlen(
    [{ id: 1, title: "Mahnung", notes: "Frist: 06.11.2026\nDokument: brief 87\nDokument: mail 403/2 – Rechnung", project: "Arion", due_date: "2026-11-06", priority: 2, recurrence: null, horizon: "short", wer_dran: "", wartet_auf: "", naechster_schritt: "", nachhaken_am: null }],
    "2026-11-05"
  );
  assert.equal(j.items[0].dokumente.length, 2);
  assert.equal(j.items[0].dokumente[0].oeffnen, "/api/letters/87");
  assert.equal(j.items[0].dokumente[1].name, "Rechnung");
  assert.equal(j.items[0].zahlung, null);
});
