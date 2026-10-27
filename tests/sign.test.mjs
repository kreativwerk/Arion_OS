// Tests ohne Netzwerk/Datenbank: Unterschreiben auf dem Server + Anhang-Kopie.
// Aufruf: npm run test:sign
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { parseSignSpecs, stampDocument, winAnsiSafe, signDraft, DEFAULT_SIGNATURE_KEY } from "../lib/draft-sign.ts";
import { storableAttachment, missingParts } from "../lib/mail-attachment-store.ts";

// 1×1 Pixel PNG (transparent)
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
);

const spec = {
  quelle: { mail_id: 26199, part: "2" },
  dateiname: "Werkstattauftrag 33998 unterschrieben",
  seite: 2,
  unterschrift: { x: 325, y: 731, breite: 160 },
  vermerk: { zeilen: ["Unter Vorbehalt der Kostenaufstellung – nur Schadenfeststellung"], x: 55, y: 825, groesse: 7.6 },
};

test("gültiger Auftrag wird übernommen, Standard-Unterschrift und .pdf ergänzt", () => {
  const { specs, errors } = parseSignSpecs(JSON.stringify(spec));
  assert.deepEqual(errors, []);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].unterschrift.key, DEFAULT_SIGNATURE_KEY);
  assert.equal(specs[0].dateiname, "Werkstattauftrag 33998 unterschrieben.pdf");
  assert.deepEqual(specs[0].quelle, { mail_id: 26199, part: "2" });
});

test("Liste von Aufträgen und Quellen datei_id / brief_id", () => {
  const { specs, errors } = parseSignSpecs(
    JSON.stringify([
      { ...spec, quelle: { datei_id: 5 } },
      { ...spec, quelle: { brief_id: 62 }, seite: -1 },
    ])
  );
  assert.deepEqual(errors, []);
  assert.equal(specs.length, 2);
  assert.equal(specs[1].seite, -1);
});

test("ungültige Aufträge werden komplett abgelehnt", () => {
  assert.match(parseSignSpecs("kein json").errors[0], /JSON/);
  assert.ok(parseSignSpecs(JSON.stringify({ ...spec, quelle: {} })).errors.some((e) => /quelle/.test(e)));
  assert.ok(parseSignSpecs(JSON.stringify({ ...spec, seite: 0 })).errors.some((e) => /seite/.test(e)));
  assert.ok(parseSignSpecs(JSON.stringify({ ...spec, unterschrift: { x: 10 } })).errors.some((e) => /x\/y/.test(e)));
  assert.ok(parseSignSpecs(JSON.stringify({ ...spec, stempel: { x: 1, y: 1 } })).errors.some((e) => /stempel: key/.test(e)));
  assert.ok(parseSignSpecs(JSON.stringify({ ...spec, unterschrift: { ...spec.unterschrift, key: "../x" } })).errors.length);
  // gemischt gültig/ungültig → gar nichts ausführen
  const mixed = parseSignSpecs(JSON.stringify([spec, { ...spec, seite: -5 }]));
  assert.equal(mixed.specs.length, 0);
  assert.match(mixed.errors[0], /Dokument 2/);
});

test("Text wird für die Standardschrift bereinigt, Umlaute bleiben", () => {
  assert.equal(winAnsiSafe("Prüfung – „ok“ ✓"), 'Prüfung – "ok" ?');
});

async function twoPagePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  return { mime: "application/pdf", data: await doc.save() };
}

test("PDF: Unterschrift + Vermerk landen auf der gewählten Seite", async () => {
  const { specs } = parseSignSpecs(JSON.stringify(spec));
  const out = await stampDocument(await twoPagePdf(), specs[0], { [DEFAULT_SIGNATURE_KEY]: { mime: "image/png", data: PNG } });
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 2);
  const res2 = doc.getPage(1).node.Resources();
  const res1 = doc.getPage(0).node.Resources();
  assert.ok(String(res2).includes("XObject"), "Seite 2 hat ein Bild");
  assert.ok(!String(res1 ?? "").includes("XObject"), "Seite 1 bleibt unverändert");
});

test("fehlendes Bild oder Seite → verständlicher Fehler", async () => {
  const { specs } = parseSignSpecs(JSON.stringify({ ...spec, seite: 3 }));
  await assert.rejects(stampDocument(await twoPagePdf(), specs[0], { [DEFAULT_SIGNATURE_KEY]: { mime: "image/png", data: PNG } }), /Seite 3/);
  const ok = parseSignSpecs(JSON.stringify(spec)).specs[0];
  await assert.rejects(stampDocument(await twoPagePdf(), ok, {}), /nicht hinterlegt/);
});

test("Foto (PNG) wird zur A4-Seite und unterschrieben", async () => {
  const s = parseSignSpecs(JSON.stringify({ ...spec, seite: 1 })).specs[0];
  const out = await stampDocument({ mime: "image/png", data: PNG }, s, { [DEFAULT_SIGNATURE_KEY]: { mime: "image/png", data: PNG } });
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 1);
});

test("Anhang-Kopie: nur PDFs/Bilder bis 10 MB, fehlende Teile werden erkannt", () => {
  assert.equal(storableAttachment({ mime: "application/pdf", size: 600_000 }), true);
  assert.equal(storableAttachment({ mime: "image/jpeg", size: 1000 }), true);
  assert.equal(storableAttachment({ mime: "application/zip", size: 1000 }), false);
  assert.equal(storableAttachment({ mime: "application/pdf", size: 11 * 1024 * 1024 }), false);
  const json = JSON.stringify([
    { part: "2", filename: "a.pdf", mime: "application/pdf", size: 5000 },
    { part: "3", filename: "b.zip", mime: "application/zip", size: 5000 },
    { part: "4", filename: "c.png", mime: "image/png", size: 5000 },
  ]);
  assert.deepEqual(missingParts(json, new Set(["4"])).map((a) => a.part), ["2"]);
});

test("Quelle datei_id: unterschriebene Fassung ersetzt den Anhang statt ihn zu verdoppeln", async () => {
  const src = await twoPagePdf();
  const files = [{ id: 7, draft_id: 3, filename: "Stammdaten.pdf", mime: "application/pdf", data: src.data }];
  const draft = { sign_spec: JSON.stringify({ ...spec, quelle: { datei_id: 7 }, dateiname: "Stammdaten_unterschrieben" }), sign_status: "", status: "entwurf" };
  const d = {
    async get(sql, params) {
      if (/FROM mail_drafts/.test(sql)) return draft;
      if (/FROM mail_draft_files/.test(sql)) return files.find((f) => f.id === params[0] && f.draft_id === params[1]);
      if (/FROM sign_assets/.test(sql)) return { mime: "image/png", data: PNG };
      return undefined;
    },
    async run(sql, params) {
      if (/^UPDATE mail_draft_files/.test(sql)) {
        const f = files.find((x) => x.id === params[3] && x.draft_id === params[4]);
        Object.assign(f, { filename: params[0], mime: params[1], data: params[2] });
      } else if (/^INSERT INTO mail_draft_files/.test(sql)) {
        files.push({ id: files.length + 100, draft_id: params[0], filename: params[1], mime: params[2], data: params[3] });
      } else if (/^UPDATE mail_drafts/.test(sql)) {
        draft.sign_status = params[0];
      }
    },
  };
  const res = await signDraft(d, 3);
  assert.equal(res.ok, true);
  assert.equal(files.length, 1, "kein zweiter, unsignierter Anhang");
  assert.equal(files[0].filename, "Stammdaten_unterschrieben.pdf");
  assert.equal(draft.sign_status, "fertig");
});
