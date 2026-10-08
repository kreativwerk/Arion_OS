import { getDb } from "@/lib/db";
import { analyzeLetter, isLetterMime, type LetterAnalysis } from "@/lib/letter-analyze";

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

/** Brief (neu) analysieren. Liefert eine Fehlermeldung oder null. */
export async function analyzeStoredLetter(id: number): Promise<string | null> {
  const d = await getDb();
  const meta = await d.get<{ mime: string }>("SELECT mime FROM letters WHERE id = ?", [id]);
  const blob = await d.get<{ data: Buffer | Uint8Array }>("SELECT data FROM letter_blobs WHERE letter_id = ?", [id]);
  if (!meta || !blob) return "Kein Scan zu diesem Brief gespeichert.";
  if (!isLetterMime(meta.mime)) return `Dateityp ${meta.mime || "unbekannt"} kann nicht analysiert werden.`;
  try {
    const data = Buffer.isBuffer(blob.data) ? blob.data : Buffer.from(blob.data);
    const result = await analyzeLetter(data, meta.mime);
    if (!result) return "Keine KI-Analyse: ANTHROPIC_API_KEY ist nicht gesetzt.";
    await applyAnalysis(id, result);
    return null;
  } catch (e) {
    return `Analyse fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
  }
}
