// Startseiten-Widgets und Qonto-Auswertung. Aufruf: npm run test:home
import { test } from "node:test";
import assert from "node:assert/strict";
import { STANDARD_LAYOUT, moveItem, normalizeLayout, parseEuro, parseQontoEingang, parseQontoLastschrift } from "../lib/home-widgets.ts";

test("Layout: leer → Standard, Unbekanntes raus, Neues hinten dran", () => {
  assert.equal(normalizeLayout(null).length, STANDARD_LAYOUT.length);
  const l = normalizeLayout('[{"id":"konto","an":false},{"id":"quatsch"},{"id":"konto"},{"id":"aufgaben","breit":true}]');
  assert.deepEqual(l.slice(0, 2), [
    { id: "konto", an: false, breit: false },
    { id: "aufgaben", an: true, breit: true },
  ]);
  assert.equal(l.length, STANDARD_LAYOUT.length);
  assert.equal(new Set(l.map((x) => x.id)).size, l.length);
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
