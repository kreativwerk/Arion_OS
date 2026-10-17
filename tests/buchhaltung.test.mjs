// Kleine Tests ohne Netzwerk für das Buchhaltungs-Modul.
// Aufruf: npm run test:buchhaltung   (Node 22.6+ mit TypeScript-Stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { parsePageRanges, firstFreeName, numberedName } from "../lib/buch-pages.ts";
import { buildServiceAccountJwt, GOOGLE_TOKEN_URL } from "../lib/google-jwt.ts";

test("Seitenangaben: leer = alle Seiten", () => {
  assert.deepEqual(parsePageRanges("", 3), [0, 1, 2]);
  assert.deepEqual(parsePageRanges(null, 2), [0, 1]);
});

test("Seitenangaben: Bereiche, Einzelseiten, Leerzeichen, Duplikate", () => {
  assert.deepEqual(parsePageRanges("1-11", 12), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(parsePageRanges("3,5", 5), [2, 4]);
  assert.deepEqual(parsePageRanges(" 1 - 3 , 5 ", 5), [0, 1, 2, 4]);
  assert.deepEqual(parsePageRanges("2,2,1-2", 3), [1, 0]);
  assert.deepEqual(parsePageRanges("4–5", 5), [3, 4]); // Gedankenstrich
});

test("Seitenangaben: ungültige Eingaben werfen", () => {
  assert.throws(() => parsePageRanges("0", 3), /beginnen bei 1/);
  assert.throws(() => parsePageRanges("4", 3), /existiert nicht/);
  assert.throws(() => parsePageRanges("3-1", 3), /Absteigend/);
  assert.throws(() => parsePageRanges("a", 3), /Ungültige/);
  assert.throws(() => parsePageRanges("1;DROP TABLE", 3), /Ungültige/);
  assert.throws(() => parsePageRanges(",", 3), /keine Seiten/);
});

test("Dateinamen: nie überschreiben, (2), (3) vor der Endung", () => {
  assert.equal(numberedName("Allianz_28.573,88.pdf", 2), "Allianz_28.573,88 (2).pdf");
  assert.equal(firstFreeName("A.pdf", []), "A.pdf");
  assert.equal(firstFreeName("A.pdf", ["A.pdf"]), "A (2).pdf");
  assert.equal(firstFreeName("A.pdf", ["A.pdf", "A (2).pdf"]), "A (3).pdf");
});

test("JWT: RS256, korrekte Claims, gültige Signatur", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  // Im JSON-Key stehen Zeilenumbrüche oft als "\n"-Escape – muss auch gehen
  const key = { client_email: "arion@projekt.iam.gserviceaccount.com", private_key: pem.replace(/\n/g, "\\n") };
  const jwt = buildServiceAccountJwt(key, "https://www.googleapis.com/auth/drive", 1_700_000_000, "albert@example.de");
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  for (const p of parts) assert.match(p, /^[A-Za-z0-9_-]+$/);
  const dec = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  assert.deepEqual(dec(parts[0]), { alg: "RS256", typ: "JWT" });
  const claims = dec(parts[1]);
  assert.equal(claims.iss, key.client_email);
  assert.equal(claims.aud, GOOGLE_TOKEN_URL);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/drive");
  assert.equal(claims.iat, 1_700_000_000);
  assert.equal(claims.exp, 1_700_003_600);
  assert.equal(claims.sub, "albert@example.de");
  const v = createVerify("RSA-SHA256");
  v.update(`${parts[0]}.${parts[1]}`);
  assert.ok(v.verify(publicKey, Buffer.from(parts[2], "base64url")));
});

test("JWT: unvollständiger Schlüssel wirft", () => {
  assert.throws(() => buildServiceAccountJwt({ client_email: "", private_key: "" }, "x"), /unvollständig/);
});

test("PDF: Seiten ausschneiden und Fotos in A4 setzen", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const { buildPdf } = await import("../lib/buch-pdf.ts");
  const src = await PDFDocument.create();
  for (let i = 0; i < 5; i++) src.addPage([200 + i, 300]); // Breite markiert die Seite
  const bytes = await src.save();

  const part = await PDFDocument.load(await buildPdf(bytes, "application/pdf", "2-3,5"));
  assert.deepEqual(part.getPages().map((p) => Math.round(p.getWidth())), [201, 202, 204]);

  const all = await buildPdf(bytes, "application/pdf", "");
  assert.equal(all, bytes); // ohne Seitenangabe: Original unverändert

  await assert.rejects(() => buildPdf(bytes, "application/pdf", "6"), /existiert nicht/);

  // 1x1-PNG → eine A4-Seite
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const img = await PDFDocument.load(await buildPdf(png, "image/png", ""));
  assert.equal(img.getPageCount(), 1);
  assert.equal(Math.round(img.getPage(0).getWidth()), 595);

  await assert.rejects(() => buildPdf(png, "image/heic", ""), /nicht als PDF/);
});

test("Drive: Ordnerpfad anlegen, Shared-Drive-Parameter, nie überschreiben (gemockt)", async () => {
  const { generateKeyPairSync: gen } = await import("node:crypto");
  const { privateKey } = gen("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "sa@test.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  process.env.DRIVE_BUCHHALTUNG_ROOT_ID = "ROOT_FOLDER_ID_123";

  // Mini-Drive im Speicher
  const files = [{ id: "f-exist", name: "Allianz_1,00.pdf", parent: "ROOT_FOLDER_ID_123/Ausgaben" }];
  const folders = new Map([["ROOT_FOLDER_ID_123", "ROOT_FOLDER_ID_123"]]);
  const calls = [];
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method || "GET"} ${u.pathname}${u.search}`);
    const json = (o, status = 200, headers = {}) =>
      new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
    if (u.host === "oauth2.googleapis.com") return json({ access_token: "tok", expires_in: 3600 });
    assert.equal(init.headers.authorization, "Bearer tok");
    if (u.pathname === "/drive/v3/files" && (init.method || "GET") === "GET") {
      assert.equal(u.searchParams.get("supportsAllDrives"), "true");
      assert.equal(u.searchParams.get("includeItemsFromAllDrives"), "true");
      const qy = u.searchParams.get("q");
      const parent = qy.match(/^'([^']+)' in parents/)[1];
      const exact = qy.match(/name = '((?:[^'\\]|\\.)*)'/);
      const contains = qy.match(/name contains '((?:[^'\\]|\\.)*)'/);
      if (qy.includes("application/vnd.google-apps.folder")) {
        const name = exact[1].replace(/\\(.)/g, "$1");
        const id = [...folders.entries()].find(([, v]) => v === `${parent}/${name}`)?.[0];
        return json({ files: id ? [{ id, name }] : [] });
      }
      const stem = contains[1].replace(/\\(.)/g, "$1");
      const path = folders.get(parent);
      return json({ files: files.filter((f) => f.parent === path && f.name.includes(stem)).map((f) => ({ id: f.id, name: f.name })) });
    }
    if (u.pathname === "/drive/v3/files" && init.method === "POST") {
      const body = JSON.parse(init.body);
      const id = `fold-${++n}`;
      folders.set(id, `${folders.get(body.parents[0])}/${body.name}`);
      return json({ id, name: body.name });
    }
    if (u.pathname === "/upload/drive/v3/files" && init.method === "POST") {
      assert.equal(u.searchParams.get("uploadType"), "multipart");
      assert.equal(u.searchParams.get("supportsAllDrives"), "true");
      const text = Buffer.from(init.body).toString("latin1");
      const meta = JSON.parse(text.match(/\r\n\r\n(\{.*?\})\r\n/)[1]);
      const id = `file-${++n}`;
      files.push({ id, name: meta.name, parent: folders.get(meta.parents[0]) });
      return json({ id, name: meta.name, webViewLink: `https://drive.google.com/file/d/${id}/view` });
    }
    if (init.method === "DELETE" || u.pathname.includes("/trash")) throw new Error("Löschen ist verboten");
    throw new Error(`unerwarteter Aufruf ${init.method} ${url}`);
  };
  try {
    const drive = await import("../lib/google-drive.ts");
    const existing = await drive.resolveFolderPath("Ausgaben", false);
    assert.equal(existing, null); // gibt es (noch) nicht, create=false legt nichts an
    const fid = await drive.resolveFolderPath("Ausgaben/2026/September", true);
    assert.equal(folders.get(fid), "ROOT_FOLDER_ID_123/Ausgaben/2026/September");
    const again = await drive.resolveFolderPath("/Ausgaben/2026/September/", true);
    assert.equal(again, fid); // gleicher Ordner, kein Duplikat
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const a = await drive.uploadFile(fid, "O'Neil_10,00.pdf", pdf, "application/pdf");
    const b = await drive.uploadFile(fid, "O'Neil_10,00.pdf", pdf, "application/pdf");
    assert.equal(a.name, "O'Neil_10,00.pdf");
    assert.equal(b.name, "O'Neil_10,00 (2).pdf");
    assert.match(b.url, /^https:\/\/drive\.google\.com\//);
    assert.throws(() => drive.splitDrivePath("Ausgaben/../geheim"), /\.\./);
    assert.ok(!calls.some((c) => c.startsWith("DELETE")));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Mail-Anhänge: PDFs/Fotos ja, Logos/Signaturen/Weiterleitungen nein", async () => {
  const { belegCandidates } = await import("../lib/mail-fetch.ts");
  const { isScanSource, belegMime } = await import("../lib/buch-eingang.ts");
  const structure = {
    type: "multipart/mixed",
    childNodes: [
      { part: "1", type: "text/plain", size: 900 },
      { part: "2", type: "image/png", id: "<logo>", disposition: "inline", encoding: "base64", size: 12_000 },
      { part: "3", type: "application/pdf", disposition: "attachment", dispositionParameters: { filename: "Rechnung.pdf" }, encoding: "base64", size: 200_000 },
      { part: "4", type: "application/octet-stream", parameters: { name: "Beleg.JPG" }, disposition: "attachment", encoding: "base64", size: 400_000 },
      { part: "5", type: "application/pdf", disposition: "attachment", encoding: "base64", size: 30 * 1024 * 1024 },
      { part: "6", type: "message/rfc822", size: 50_000 },
      { part: "7", type: "image/jpeg", disposition: "inline", encoding: "base64", size: 300_000 },
    ],
  };
  const c = belegCandidates(structure);
  assert.deepEqual(c.map((x) => [x.part, x.mime]), [
    ["3", "application/pdf"],
    ["4", "image/jpeg"],
    ["7", "image/jpeg"],
  ]);
  assert.equal(belegMime("application/zip", "a.zip"), null);
  assert.ok(isScanSource("Scan", "scan@arion-logistics.de", "irgendwas"));
  assert.ok(isScanSource("IONOS", "info@arion-logistics.de", "Scan Bürodrucker 17.10."));
  assert.ok(!isScanSource("IONOS", "info@arion-logistics.de", "Rechnung"));
});
