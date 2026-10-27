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
