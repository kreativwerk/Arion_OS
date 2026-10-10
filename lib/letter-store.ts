import { getDb } from "@/lib/db";
import { PDFDocument } from "pdf-lib";
import { analyzeLetter, isLetterMime, letterAnalysisEnabled, splitLetterPages, type LetterAnalysis } from "@/lib/letter-analyze";

/** Max. Größe eines Scans. Die Anthropic-API nimmt PDFs bis 32 MB pro Request
 *  an – Base64 bläht um ~⅓ auf, daher 20 MB. */
export const LETTER_MAX_SIZE = 20 * 1024 * 1024;
/** Stückgröße beim Upload – unter Vercels ~4,5-MB-Request-Limit. */
export const LETTER_CHUNK_SIZE = 3 * 1024 * 1024;

/** Ein weiteres Stück an den gespeicherten Scan hängen. `offset` muss der
 *  bisherigen Länge entsprechen – so fällt ein doppelt oder verdreht
 *  gesendetes Stück auf, statt den Scan still zu beschädigen. */
export async function appendLetterChunk(id: number, offset: number, chunk: Buffer): Promise<string | null> {
  const d = await getDb();
  const blob = await d.get<{ data: Buffer | Uint8Array }>("SELECT data FROM letter_blobs WHERE letter_id = ?", [id]);
  if (!blob) return "Brief nicht gefunden.";
  const data = Buffer.isBuffer(blob.data) ? blob.data : Buffer.from(blob.data);
  if (data.length !== offset) return `Upload aus dem Tritt (erwartet Byte ${data.length}, bekommen ${offset}).`;
  if (data.length + chunk.length > LETTER_MAX_SIZE) return `Datei zu groß (max. ${LETTER_MAX_SIZE / 1024 / 1024} MB)`;
  await d.run("UPDATE letter_blobs SET data = ? WHERE letter_id = ?", [Buffer.concat([data, chunk]), id]);
  return null;
}

/** Analyse-Ergebnis in den Brief schreiben. Von Hand gepflegte Felder
 *  (Status, Notizen) bleiben unangetastet. */
async function applyAnalysis(id: number, a: LetterAnalysis) {
  const d = await getDb();
  await d.run(
    "UPDATE letters SET sender = ?, subject = ?, summary = ?, action = ?, category = ?, due_date = ?, reference = ?, extracted = ? WHERE id = ?",
    [
      a.sender.slice(0, 200),
      (a.subject || "Brief").slice(0, 200),
      a.summary,
      a.action,
      a.category,
      a.due_date,
      a.reference.slice(0, 300),
      JSON.stringify({ letter_date: a.letter_date, text: a.text }),
      id,
    ]
  );
}

export type AnalyzeResult = {
  /** Fehlermeldung zur KI-Analyse – der Brief ist trotzdem gespeichert. */
  error: string | null;
  /** Alle Briefe, die aus dem Scan entstanden sind (bei Stapelscans mehrere). */
  ids: number[];
};

/** Seiten `from`–`to` (1-basiert) als eigene PDF. */
async function extractPages(src: PDFDocument, from: number, to: number): Promise<Buffer> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
  pages.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}

/**
 * Brief (neu) analysieren. Ein Stapelscan (mehrere Briefe in einer PDF) wird
 * zuerst zerlegt: Der erste Brief behält diesen Eintrag, jeder weitere wird
 * ein eigener Brief mit eigenem Scan. Danach liest Claude jeden Brief einzeln.
 */
export async function analyzeStoredLetter(id: number): Promise<AnalyzeResult> {
  const d = await getDb();
  const meta = await d.get<{ mime: string; file_ref: string; scanned_by: string; received_date: string }>(
    "SELECT mime, file_ref, scanned_by, received_date FROM letters WHERE id = ?",
    [id]
  );
  const blob = await d.get<{ data: Buffer | Uint8Array }>("SELECT data FROM letter_blobs WHERE letter_id = ?", [id]);
  if (!meta || !blob) return { error: "Kein Scan zu diesem Brief gespeichert.", ids: [id] };
  const mime = meta.mime;
  if (!isLetterMime(mime)) return { error: `Dateityp ${mime || "unbekannt"} kann nicht analysiert werden.`, ids: [id] };
  if (!letterAnalysisEnabled()) return { error: "Keine KI-Analyse: ANTHROPIC_API_KEY ist nicht gesetzt.", ids: [id] };
  const data = Buffer.isBuffer(blob.data) ? blob.data : Buffer.from(blob.data);

  // 1. Stapel zerlegen
  let parts: { id: number; data: Buffer }[] = [{ id, data }];
  if (mime === "application/pdf") {
    try {
      const pdf = await PDFDocument.load(data, { ignoreEncryption: true });
      const ranges = await splitLetterPages(data, pdf.getPageCount());
      if (ranges.length > 1) {
        const base = meta.file_ref.replace(/\.pdf$/i, "") || "Scan";
        parts = [];
        for (const [i, [from, to]] of ranges.entries()) {
          const pages = from === to ? `S. ${from}` : `S. ${from}–${to}`;
          const fileRef = `${base} (${pages}).pdf`.slice(0, 300);
          const partData = await extractPages(pdf, from, to);
          let partId = id;
          if (i === 0) {
            await d.run("UPDATE letters SET file_ref = ? WHERE id = ?", [fileRef, id]);
            await d.run("UPDATE letter_blobs SET data = ? WHERE letter_id = ?", [partData, id]);
          } else {
            partId = await d.insert(
              "INSERT INTO letters (subject, received_date, scanned_by, status, file_ref, mime) VALUES (?,?,?,?,?,?)",
              [`${base} (${pages})`.slice(0, 200), meta.received_date, meta.scanned_by, "neu", fileRef, mime]
            );
            await d.run("INSERT INTO letter_blobs (letter_id, data) VALUES (?,?)", [partId, partData]);
          }
          parts.push({ id: partId, data: partData });
        }
      }
    } catch (e) {
      // Aufteilen ist ein Extra – scheitert es, wird der Scan als ein Brief gelesen
      console.error("[letters] Aufteilen fehlgeschlagen:", e);
    }
  }

  // 2. Jeden Brief einzeln lesen (parallel, damit große Stapel ins Zeitbudget passen)
  const errors = await Promise.all(
    parts.map(async (part) => {
      try {
        const result = await analyzeLetter(part.data, mime);
        if (result) await applyAnalysis(part.id, result);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    })
  );
  const failed = errors.filter((e): e is string => e !== null);
  const error = failed.length
    ? `Analyse fehlgeschlagen${parts.length > 1 ? ` (${failed.length} von ${parts.length} Briefen)` : ""}: ${failed[0]}`
    : null;
  return { error, ids: parts.map((p) => p.id) };
}
