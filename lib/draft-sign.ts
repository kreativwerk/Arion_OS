import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import type { DB } from "@/lib/db";
import { loadMailAttachment } from "@/lib/mail-attachment-store";

/**
 * Unterschreiben auf dem Server: Ein Entwurf bekommt in `mail_drafts.sign_spec`
 * einen Auftrag (JSON), welches Dokument wo unterschrieben werden soll. Der
 * Mail-Cron (und spätestens der Versand) setzt Unterschrift, optional Stempel
 * und einen Vermerk ins PDF und hängt das Ergebnis als Datei an den Entwurf.
 *
 * Gesendet wird weiterhin nur nach Freigabe in der App – der Auftrag erzeugt
 * nur den Anhang, den Albert vor dem Senden sieht.
 *
 * Koordinaten in Punkt (1/72 Zoll), gemessen von der LINKEN OBEREN Ecke der
 * Seite (wie man ein Dokument liest). A4 = 595 × 842 pt.
 *
 * Beispiel:
 * {
 *   "quelle": { "mail_id": 26199, "part": "2" },
 *   "dateiname": "Werkstattauftrag_33998_unterschrieben.pdf",
 *   "seite": 2,
 *   "unterschrift": { "x": 325, "y": 731, "breite": 160 },
 *   "stempel": { "key": "stempel_arion", "x": 420, "y": 720, "breite": 150 },
 *   "vermerk": { "zeilen": ["Unter Vorbehalt der Kostenaufstellung"], "x": 55, "y": 825, "groesse": 8 }
 * }
 * `sign_spec` darf auch eine Liste solcher Aufträge sein.
 */

export const DEFAULT_SIGNATURE_KEY = "unterschrift_albert";
const MAX_SPECS = 5;
const MAX_LINES = 6;

export type SignSource = { mail_id: number; part: string } | { datei_id: number } | { brief_id: number };
export type Placement = { x: number; y: number; breite: number };
export type SignSpec = {
  quelle: SignSource;
  dateiname: string;
  seite: number; // 1-basiert, -1 = letzte Seite
  unterschrift: Placement & { key: string };
  stempel?: Placement & { key: string };
  vermerk?: { zeilen: string[]; x: number; y: number; groesse: number };
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const inPage = (v: number | null, max = 2000) => v !== null && v >= 0 && v <= max;

function placement(raw: unknown, what: string, errors: string[]): (Placement & { key?: string }) | null {
  if (!raw || typeof raw !== "object") {
    errors.push(`${what}: Angaben fehlen.`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const x = num(r.x);
  const y = num(r.y);
  const breite = num(r.breite) ?? 150;
  if (!inPage(x) || !inPage(y)) errors.push(`${what}: x/y (Punkt ab links oben) fehlen oder sind ungültig.`);
  if (breite < 20 || breite > 400) errors.push(`${what}: breite muss zwischen 20 und 400 Punkt liegen.`);
  const key = typeof r.key === "string" ? r.key : undefined;
  if (key !== undefined && !/^[a-z0-9_-]{2,40}$/.test(key)) errors.push(`${what}: key ist ungültig.`);
  return { x: x ?? 0, y: y ?? 0, breite, key };
}

function safeName(name: string): string {
  const n = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 150);
  if (!n) return "Dokument_unterschrieben.pdf";
  return /\.pdf$/i.test(n) ? n : `${n}.pdf`;
}

/** JSON aus `sign_spec` prüfen. Ungültige Aufträge werden nie teilweise ausgeführt. */
export function parseSignSpecs(json: string | null | undefined): { specs: SignSpec[]; errors: string[] } {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(json || "");
  } catch {
    return { specs: [], errors: ["sign_spec ist kein gültiges JSON."] };
  }
  const list = Array.isArray(raw) ? raw : [raw];
  if (!list.length) return { specs: [], errors: ["sign_spec ist leer."] };
  if (list.length > MAX_SPECS) return { specs: [], errors: [`Höchstens ${MAX_SPECS} Dokumente je Entwurf.`] };

  const specs: SignSpec[] = [];
  list.forEach((item, i) => {
    const p = list.length > 1 ? `Dokument ${i + 1}: ` : "";
    const e: string[] = [];
    if (!item || typeof item !== "object") {
      errors.push(`${p}Auftrag fehlt.`);
      return;
    }
    const r = item as Record<string, unknown>;
    const q = (r.quelle || {}) as Record<string, unknown>;
    let quelle: SignSource | null = null;
    if (num(q.mail_id) && typeof q.part === "string" && /^[0-9.]+$/.test(q.part)) quelle = { mail_id: Number(q.mail_id), part: q.part };
    else if (num(q.datei_id)) quelle = { datei_id: Number(q.datei_id) };
    else if (num(q.brief_id)) quelle = { brief_id: Number(q.brief_id) };
    else e.push("quelle braucht mail_id + part, datei_id oder brief_id.");

    const seite = r.seite === undefined ? -1 : num(r.seite);
    if (seite === null || seite === 0 || seite < -1 || seite > 500) e.push("seite muss ≥ 1 sein (oder -1 für die letzte).");

    const u = placement(r.unterschrift, "unterschrift", e);
    const s = r.stempel === undefined || r.stempel === null ? null : placement(r.stempel, "stempel", e);
    if (s && !s.key) e.push("stempel: key fehlt (z. B. stempel_arion).");

    let vermerk: SignSpec["vermerk"];
    if (r.vermerk !== undefined && r.vermerk !== null) {
      const v = r.vermerk as Record<string, unknown>;
      const zeilen = Array.isArray(v.zeilen) ? v.zeilen.filter((z): z is string => typeof z === "string").map((z) => z.slice(0, 160)) : [];
      const x = num(v.x);
      const y = num(v.y);
      const groesse = num(v.groesse) ?? 8;
      if (!zeilen.length || zeilen.length > MAX_LINES) e.push(`vermerk: 1 bis ${MAX_LINES} Zeilen.`);
      if (!inPage(x) || !inPage(y)) e.push("vermerk: x/y fehlen oder sind ungültig.");
      if (groesse < 5 || groesse > 16) e.push("vermerk: groesse zwischen 5 und 16.");
      vermerk = { zeilen, x: x ?? 0, y: y ?? 0, groesse };
    }

    if (e.length) {
      errors.push(...e.map((x) => p + x));
      return;
    }
    specs.push({
      quelle: quelle!,
      dateiname: safeName(typeof r.dateiname === "string" ? r.dateiname : "Dokument_unterschrieben.pdf"),
      seite: seite!,
      unterschrift: { x: u!.x, y: u!.y, breite: u!.breite, key: u!.key || DEFAULT_SIGNATURE_KEY },
      stempel: s ? { x: s.x, y: s.y, breite: s.breite, key: s.key! } : undefined,
      vermerk,
    });
  });
  return errors.length ? { specs: [], errors } : { specs, errors };
}

/** Standardschrift kennt nur WinAnsi – Zeichen außerhalb ersetzen statt abbrechen. */
export function winAnsiSafe(text: string): string {
  return text
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[‐-‒−]/g, "-")
    .replace(/[^ -~ -ÿ–—€…]/g, "?");
}

export type SignAsset = { mime: string; data: Uint8Array };
export type SourceFile = { mime: string; data: Uint8Array };

async function embed(doc: PDFDocument, a: SignAsset): Promise<PDFImage> {
  return /png/i.test(a.mime) ? doc.embedPng(a.data) : doc.embedJpg(a.data);
}

/** Bild (Foto/Scan) als PDF-Seite in A4, damit es unterschrieben werden kann. */
async function imageToPdf(src: SourceFile): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const img = /png/i.test(src.mime) ? await doc.embedPng(src.data) : await doc.embedJpg(src.data);
  const page = doc.addPage([595.28, 841.89]);
  const s = Math.min(595.28 / img.width, 841.89 / img.height);
  const w = img.width * s;
  const h = img.height * s;
  page.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - h) / 2, width: w, height: h });
  return doc;
}

/** Setzt Unterschrift, Stempel und Vermerk – reine Funktion, ohne Datenbank. */
export async function stampDocument(
  src: SourceFile,
  spec: SignSpec,
  assets: Record<string, SignAsset>
): Promise<Uint8Array> {
  let doc: PDFDocument;
  if (/pdf/i.test(src.mime)) doc = await PDFDocument.load(src.data, { ignoreEncryption: false });
  else if (/^image\/(png|jpe?g)$/i.test(src.mime)) doc = await imageToPdf(src);
  else throw new Error(`Dateityp ${src.mime} kann nicht unterschrieben werden (nur PDF, PNG, JPG).`);

  const pages = doc.getPages();
  const idx = spec.seite === -1 ? pages.length - 1 : spec.seite - 1;
  if (idx < 0 || idx >= pages.length) throw new Error(`Seite ${spec.seite} gibt es nicht (Dokument hat ${pages.length}).`);
  const page = pages[idx];
  const { height } = page.getSize();

  const place = async (key: string, p: Placement) => {
    const asset = assets[key];
    if (!asset) throw new Error(`Bild „${key}“ ist nicht hinterlegt (sign_assets).`);
    const img = await embed(doc, asset);
    const h = (p.breite * img.height) / img.width;
    page.drawImage(img, { x: p.x, y: height - p.y - h, width: p.breite, height: h });
  };
  // Stempel zuerst, Unterschrift darüber (Stempel darf sie leicht überlappen)
  if (spec.stempel) await place(spec.stempel.key, spec.stempel);
  await place(spec.unterschrift.key, spec.unterschrift);

  if (spec.vermerk) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const { zeilen, x, y, groesse } = spec.vermerk;
    zeilen.forEach((z, i) => {
      page.drawText(winAnsiSafe(z), { x, y: height - y - i * groesse * 1.25, size: groesse, font, color: rgb(0, 0, 0) });
    });
  }
  return doc.save();
}

async function loadSource(d: DB, draftId: number, q: SignSource): Promise<SourceFile> {
  if ("mail_id" in q) {
    const a = await loadMailAttachment(d, q.mail_id, q.part);
    return { mime: a.mime, data: new Uint8Array(a.data) };
  }
  if ("datei_id" in q) {
    const f = await d.get<{ mime: string; data: Buffer | Uint8Array }>(
      "SELECT mime, data FROM mail_draft_files WHERE id = ? AND draft_id = ?",
      [q.datei_id, draftId]
    );
    if (!f) throw new Error(`Datei ${q.datei_id} gehört nicht zu diesem Entwurf.`);
    return { mime: f.mime, data: new Uint8Array(f.data) };
  }
  const b = await d.get<{ mime: string; data: Buffer | Uint8Array }>(
    "SELECT l.mime, b.data FROM letters l JOIN letter_blobs b ON b.letter_id = l.id WHERE l.id = ?",
    [q.brief_id]
  );
  if (!b) throw new Error(`Brief ${q.brief_id} hat keine Datei.`);
  return { mime: b.mime || "application/pdf", data: new Uint8Array(b.data) };
}

async function loadAssets(d: DB, keys: string[]): Promise<Record<string, SignAsset>> {
  const out: Record<string, SignAsset> = {};
  for (const k of new Set(keys)) {
    const a = await d.get<{ mime: string; data: Buffer | Uint8Array }>("SELECT mime, data FROM sign_assets WHERE key = ?", [k]);
    if (a) out[k] = { mime: a.mime, data: new Uint8Array(a.data) };
  }
  return out;
}

/**
 * Führt den Unterschrifts-Auftrag eines Entwurfs aus. Erfolg: signierte PDFs
 * hängen am Entwurf, sign_status = 'fertig'. Fehler: sign_status = 'fehler',
 * Grund in sign_error – es wird nichts angehängt.
 */
export async function signDraft(d: DB, draftId: number): Promise<{ ok: boolean; dateien: number; error?: string }> {
  const row = await d.get<{ sign_spec: string; sign_status: string; status: string }>(
    "SELECT sign_spec, sign_status, status FROM mail_drafts WHERE id = ?",
    [draftId]
  );
  if (!row) return { ok: false, dateien: 0, error: "Entwurf nicht gefunden." };
  if (!row.sign_spec) return { ok: true, dateien: 0 };
  if (row.sign_status === "fertig") return { ok: true, dateien: 0 };

  // Fehler zusätzlich in `error`, damit die Entwurfs-Karte in der App ihn zeigt
  const setStatus = (status: string, error: string) =>
    status === "fehler"
      ? d.run("UPDATE mail_drafts SET sign_status = ?, sign_error = ?, error = ?, updated_at = ? WHERE id = ?", [
          status,
          error,
          `Unterschrift: ${error}`,
          new Date().toISOString(),
          draftId,
        ])
      : d.run("UPDATE mail_drafts SET sign_status = ?, sign_error = '', updated_at = ? WHERE id = ?", [status, new Date().toISOString(), draftId]);

  const { specs, errors } = parseSignSpecs(row.sign_spec);
  if (errors.length) {
    await setStatus("fehler", errors.join(" "));
    return { ok: false, dateien: 0, error: errors.join(" ") };
  }
  try {
    const assets = await loadAssets(d, specs.flatMap((s) => [s.unterschrift.key, ...(s.stempel ? [s.stempel.key] : [])]));
    const results: { name: string; data: Uint8Array; replaceId?: number }[] = [];
    for (const s of specs) {
      const src = await loadSource(d, draftId, s.quelle);
      // Quelle ist schon ein Anhang dieses Entwurfs → die unterschriebene Fassung ersetzt ihn,
      // sonst ginge das Dokument einmal ohne und einmal mit Unterschrift raus.
      const replaceId = "datei_id" in s.quelle ? s.quelle.datei_id : undefined;
      results.push({ name: s.dateiname, data: await stampDocument(src, s, assets), replaceId });
    }
    // Erst alles erzeugen, dann anhängen – kein halb unterschriebener Entwurf
    for (const r of results) {
      if (r.replaceId !== undefined) {
        await d.run("UPDATE mail_draft_files SET filename = ?, mime = ?, data = ? WHERE id = ? AND draft_id = ?", [
          r.name,
          "application/pdf",
          Buffer.from(r.data),
          r.replaceId,
          draftId,
        ]);
        continue;
      }
      await d.run("INSERT INTO mail_draft_files (draft_id, filename, mime, data) VALUES (?,?,?,?)", [
        draftId,
        r.name,
        "application/pdf",
        Buffer.from(r.data),
      ]);
    }
    await setStatus("fertig", "");
    return { ok: true, dateien: results.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setStatus("fehler", msg);
    return { ok: false, dateien: 0, error: msg };
  }
}

/** Offene Aufträge abarbeiten (Mail-Cron). */
export async function signPendingDrafts(d: DB, deadline: number): Promise<{ unterschrieben: number; fehler: string[] }> {
  const rows = await d.all<{ id: number }>(
    `SELECT id FROM mail_drafts
     WHERE status = 'entwurf' AND sign_spec IS NOT NULL AND sign_spec <> '' AND (sign_status IS NULL OR sign_status = '')
     ORDER BY id LIMIT 5`
  );
  let unterschrieben = 0;
  const fehler: string[] = [];
  for (const r of rows) {
    if (deadline - Date.now() < 5_000) break;
    const res = await signDraft(d, Number(r.id));
    if (res.ok) unterschrieben += res.dateien;
    else fehler.push(`Entwurf ${r.id}: ${res.error}`);
  }
  return { unterschrieben, fehler };
}
