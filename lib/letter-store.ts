import { getDb } from "@/lib/db";
import { analyzeLetter, isLetterMime, type LetterAnalysis } from "@/lib/letter-analyze";

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
