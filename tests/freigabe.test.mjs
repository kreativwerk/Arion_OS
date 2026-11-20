// Tests ohne Netzwerk für den Versand von im Chat freigegebenen Claude-Entwürfen.
// Aufruf: npm run test:freigabe
import { test } from "node:test";
import assert from "node:assert/strict";
import { FREIGABE_SQL, FREIGEGEBEN, freigabePushPayload, sendFreigegebene } from "../lib/draft-freigabe.ts";

test("nur freigegebene Claude-Entwürfe werden ausgewählt", () => {
  assert.equal(FREIGEGEBEN, "freigegeben");
  assert.match(FREIGABE_SQL, /status = 'freigegeben'/);
  assert.match(FREIGABE_SQL, /source = 'claude'/);
  assert.match(FREIGABE_SQL, /LIMIT 10/);
});

test("Push nach erfolgreichem Versand", () => {
  const p = freigabePushPayload(
    { id: 7, to_addr: "a@b.de, c@d.de", subject: "AW: Test" },
    { ok: true, status: "gesendet", messageId: "<x@y>" }
  );
  assert.equal(p.title, "Gesendet: an a@b.de");
  assert.equal(p.body, "AW: Test");
  assert.equal(p.url, "/postfach?entwurf=7");
});

test("Push bei Fehler nennt den Grund und führt zum Entwurf", () => {
  const p = freigabePushPayload({ id: 9, to_addr: "", subject: "" }, { ok: false, status: "fehler", error: "SMTP: timeout" });
  assert.equal(p.title, "Nicht gesendet: an ohne Empfänger");
  assert.equal(p.body, "(ohne Betreff) – SMTP: timeout");
  assert.equal(p.url, "/?entwurf=9");
});

test("abgelaufenes Zeitbudget: nichts wird gesendet", async () => {
  const fakeDb = {
    all: async () => [{ id: 1, to_addr: "a@b.de", subject: "x" }],
    get: async () => {
      throw new Error("darf nicht aufgerufen werden");
    },
    run: async () => {
      throw new Error("darf nicht aufgerufen werden");
    },
  };
  const res = await sendFreigegebene(fakeDb, Date.now() - 1);
  assert.deepEqual(res, { gesendet: 0, fehler: [] });
});
