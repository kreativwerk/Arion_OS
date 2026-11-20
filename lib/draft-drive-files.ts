import type { DB } from "@/lib/db";
import { downloadFile } from "@/lib/google-drive";

/**
 * Anhänge aus Google Drive für Mail-Entwürfe.
 *
 * Claude kann aus dem Chat keine größeren Dateien direkt in die Datenbank
 * schreiben, wohl aber nach Google Drive hochladen. Dafür legt Claude eine
 * Zeile in `mail_draft_files` mit `drive_file_id` und leerem `data` an. Dieser
 * Lauf lädt die Datei dann aus Drive in die Datenbank – im Mail-Cron und
 * spätestens direkt vor dem Versand (lib/mail-send.ts).
 */

/** Gleiche Grenzen wie beim Upload in der App (app/api/mail/drafts/files). */
export const DRIVE_FILE_MAX = 20 * 1024 * 1024;

export type DriveAnhangErgebnis = { geladen: number; fehler: string[]; offen: number };

type Zeile = { id: number; draft_id: number; filename: string; drive_file_id: string };

const OFFEN_SQL = `SELECT f.id, f.draft_id, f.filename, f.drive_file_id FROM mail_draft_files f
  JOIN mail_drafts d ON d.id = f.draft_id
  WHERE f.drive_file_id <> '' AND LENGTH(f.data) = 0 AND d.status IN ('entwurf','freigegeben','fehler')`;

/** Lädt offene Drive-Anhänge (optional nur für einen Entwurf). */
export async function ladeDriveAnhaenge(
  d: DB,
  opts: { draftId?: number; deadline?: number } = {}
): Promise<DriveAnhangErgebnis> {
  const rows = await d.all<Zeile>(
    opts.draftId ? `${OFFEN_SQL} AND f.draft_id = ? ORDER BY f.id` : `${OFFEN_SQL} ORDER BY f.id LIMIT 10`,
    opts.draftId ? [opts.draftId] : []
  );
  let geladen = 0;
  const fehler: string[] = [];
  for (const r of rows) {
    if (opts.deadline && Date.now() > opts.deadline) break; // Rest beim nächsten Lauf
    try {
      const buf = await downloadFile(r.drive_file_id, { deadline: opts.deadline });
      if (!buf.length) throw new Error("Datei ist leer");
      if (buf.length > DRIVE_FILE_MAX) throw new Error(`zu groß (${Math.round(buf.length / 1024 / 1024)} MB, max. 20 MB)`);
      await d.run("UPDATE mail_draft_files SET data = ? WHERE id = ? AND LENGTH(data) = 0", [buf, r.id]);
      geladen++;
    } catch (e) {
      fehler.push(`„${r.filename}“: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { geladen, fehler, offen: rows.length - geladen };
}

/** Fehlen einem Entwurf noch Drive-Anhänge? (für den Versand) */
export async function fehlendeDriveAnhaenge(d: DB, draftId: number): Promise<string[]> {
  const rows = await d.all<{ filename: string }>(
    "SELECT filename FROM mail_draft_files WHERE draft_id = ? AND drive_file_id <> '' AND LENGTH(data) = 0",
    [draftId]
  );
  return rows.map((r) => r.filename);
}
