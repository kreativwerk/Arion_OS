// Codriver-MCP: Protokoll, Kennzeichen-Suche, Fahrzeugschein. Aufruf: npm run test:codriver-mcp
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcp, normPlate, plateVarianten, ohneLinks, istFahrzeugschein, MCP_TOOL_NAMES } from "../lib/codriver-mcp.ts";
import { decodeFields } from "../lib/codriver-redact.ts";

const LINK = "https://firebasestorage.googleapis.com/v0/b/codriver-eu.appspot.com/o/u%2Fv1%2Fschein.jpg?alt=media&token=abc";

const daten = {
  vehicles: [
    { id: "v1", data: { plateNumber: "FÜ AL158", brand: "Mercedes-Benz", model: "Sprinter", vin: "WDB9066331S123456", cortex: { stationCode: "DBY5", ownershipType: "LEASED" } } },
    { id: "v2", data: { plateNumber: "ERH-AL 330", brand: "Opel", model: "Corsa", vin: "W0L0XCF6866003902" } },
    { id: "v3", data: { plateNumber: "M AZ 1441", brand: "Mercedes-Benz", model: "Sprinter", status: "DEFLEETED" } },
  ],
  vehicle_documents: [
    { id: "v1/d1", data: { plateNumber: "FÜ AL158", documentType: "FAHRZEUGSCHEIN", fileUrl: LINK } },
    { id: "v1/d2", data: { plateNumber: "FÜ AL158", documentType: "HU_TUV_CERTIFICATE", expiryDate: "2026-12-01", fileUrl: LINK } },
  ],
  drivers: [
    { id: "f1", data: { driverName: "Max Muster", employeeNumber: "17", employmentPeriods: [{ start: "2025-01-01" }] } },
    { id: "f2", data: { driverName: "Alt Fahrer", employmentPeriods: [{ start: "2020-01-01", end: "2021-01-01" }] } },
  ],
};

const geladen = [];
const src = {
  async docs(c) {
    return (daten[c] ?? []).map((d) => ({ collection: c, id: d.id, data: d.data, updated: "" }));
  },
  async stats() {
    return Object.entries(daten).map(([collection, l]) => ({ collection, anzahl: l.length, letzterSync: "2026-11-14T18:00:00Z" }));
  },
  async lastSync() {
    return "2026-11-14T18:00:00Z";
  },
  async datei(ref) {
    geladen.push(ref);
    return { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: "image/jpeg", name: "schein.jpg" };
  },
};

const call = async (name, args = {}) => {
  const r = await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, src, "2026-11-14");
  return r.result;
};
const json = async (name, args) => JSON.parse((await call(name, args)).content[0].text);

test("Kennzeichen-Normalisierung", () => {
  assert.equal(normPlate("FÜ-AL 158"), "FUAL158");
  assert.ok(plateVarianten("fue al158").includes("FUAL158"));
  assert.ok(plateVarianten("UE-AB 12").includes("UEAB12"));
  assert.equal(normPlate("ERH-AL330"), normPlate("ERH AL 330"));
});

test("initialize, tools/list, Benachrichtigung", async () => {
  const init = await handleMcp({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, src, "2026-11-14");
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.ok(init.result.capabilities.tools);
  assert.equal(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, src, "2026-11-14"), null);
  const list = await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, src, "2026-11-14");
  const names = list.result.tools.map((t) => t.name);
  assert.deepEqual(names, MCP_TOOL_NAMES);
  assert.ok(names.includes("codriver_fahrzeugschein"));
  assert.ok(list.result.tools.every((t) => t.annotations.readOnlyHint === true));
  const unbekannt = await handleMcp({ jsonrpc: "2.0", id: 3, method: "foo/bar" }, src, "2026-11-14");
  assert.equal(unbekannt.error.code, -32601);
});

test("Fahrzeug per Kennzeichen – egal welche Schreibweise, ohne Links", async () => {
  for (const q of ["FÜ-AL 158", "fual158", "FUE AL 158", "1S123456"]) {
    const r = await json("codriver_fahrzeug", { suche: q });
    assert.equal(r.gefunden, 1, q);
    assert.equal(r.fahrzeuge[0].kennzeichen, "FÜ AL158");
  }
  const r = await json("codriver_fahrzeug", { suche: "FÜ-AL 158" });
  assert.equal(r.fahrzeuge[0].vin, "WDB9066331S123456");
  assert.equal(r.fahrzeuge[0].dokumente.length, 2);
  assert.match(r.fahrzeuge[0].fahrzeugschein, /vorhanden/);
  assert.ok(!JSON.stringify(r).includes("firebasestorage"), "Links dürfen nicht nach außen");
  const nichts = await json("codriver_fahrzeug", { suche: "XX-YY 999" });
  assert.equal(nichts.gefunden, 0);
});

test("Fahrzeugschein kommt als Bild", async () => {
  const r = await call("codriver_fahrzeugschein", { kennzeichen: "FÜ-AL158" });
  assert.equal(r.isError, false);
  assert.match(r.content[0].text, /FÜ AL158.*FIN WDB9066331S123456/);
  const bild = r.content.find((c) => c.type === "image");
  assert.equal(bild.mimeType, "image/jpeg");
  assert.equal(geladen.at(-1), LINK);
  const ohne = await call("codriver_fahrzeugschein", { kennzeichen: "ERH-AL330" });
  assert.match(ohne.content[0].text, /kein Fahrzeugschein hinterlegt/);
  assert.match(ohne.content[0].text, /W0L0XCF6866003902/);
});

test("Fahrzeugliste ohne Ausgemusterte, Fahrer nur aktive", async () => {
  const f = await json("codriver_fahrzeuge", {});
  assert.deepEqual(f.fahrzeuge.map((x) => x.kennzeichen), ["ERH-AL 330", "FÜ AL158"]);
  const g = await json("codriver_fahrer", {});
  assert.deepEqual(g.fahrer.map((x) => x.name), ["Max Muster"]);
  const one = await json("codriver_fahrer", { suche: "muster" });
  assert.equal(one.mitarbeiterNr, "17");
});

test("Fristen und Volltextsuche", async () => {
  const fr = await json("codriver_fristen", { tage: 30 });
  assert.equal(fr.fristen[0].titel, "FÜ AL158 – TÜV/HU");
  const s = await json("codriver_suche", { begriff: "corsa" });
  assert.equal(s.treffer[0].id, "v2");
});

test("Fahrzeugschein-Erkennung und Link-Maskierung", () => {
  assert.equal(istFahrzeugschein({ documentType: "REGISTRATION" }), true);
  assert.equal(istFahrzeugschein({ documentType: "OTHER", name: "Fahrzeugschein FÜ AL158" }), true);
  assert.equal(istFahrzeugschein({ documentType: "TUV_CERTIFICATE" }), false);
  assert.deepEqual(ohneLinks({ a: [LINK], b: "x" }), { a: ["[Datei – mit codriver_datei abrufen]"], b: "x" });
});

test("Links bleiben nur bei Fahrzeugdaten erhalten", () => {
  const f = { url: { stringValue: LINK }, iban: { stringValue: "DE89370400440532013000" } };
  assert.deepEqual(decodeFields(f), { url: "[file]", iban: "[redacted]" });
  assert.deepEqual(decodeFields(f, { keepFiles: true }), { url: LINK, iban: "[redacted]" });
});
