import { getDb, nowExpr, type DB } from "@/lib/db";
import { buildPdf } from "@/lib/buch-pdf";
import { driveConfigured, findByAblageId, resolveFolderPath, uploadFile } from "@/lib/google-drive";

/**
 * Führt Ablage-Aufträge aus (Tabelle buch_ablage, angelegt von der
 * Claude-Routine per SQL): Seiten aus dem Eingangs-PDF schneiden bzw. Fotos in
 * ein A4-PDF setzen und nach Google Drive hochladen. Löscht nie etwas.
 *
 * Status: offen → in_arbeit (beansprucht, verhindert Doppel-Uploads paralleler
 * Läufe) → erledigt | fehler. Hängt ein Auftrag länger als 10 Min. in
 * „in_arbeit“ (Funktion abgebrochen), wird er erneut beansprucht.
 */

const MAX_PER_RUN = 15;
const STALE_MINUTES = 10;
/** Ein Auftrag wird nur begonnen, wenn noch so viel Zeit bleibt (Download, Schnitt, Upload). */
const ORDER_MIN_MS = 25_000;

export type AblageResult = {
  configured: boolean;
  erledigt: number;
  fehler: number;
  offen: number;
  hinweise: string[];
};

type Order = {
  id: number;
  eingang_id: number;
  seiten: string | null;
  ziel_pfad: string;
  dateiname: string;
};

/** Zeitstempel im Format "YYYY-MM-DD HH:MM:SS" (UTC) – vergleichbar als Text. */
function stamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function claim(d: DB, id: number): Promise<boolean> {
  const cutoff = stamp(new Date(Date.now() - STALE_MINUTES * 60_000));
  const rows = await d.all<{ id: number }>(
    `UPDATE buch_ablage SET status = 'in_arbeit', gestartet_at = ?, fehler = ''
     WHERE id = ? AND (status = 'offen' OR (status = 'in_arbeit' AND (gestartet_at IS NULL OR gestartet_at < ?)))
     RETURNING id`,
    [stamp(new Date()), id, cutoff]
  );
  return rows.length > 0;
}

function pdfName(name: string): string {
  const n = name.trim() || "Beleg";
  return /\.pdf$/i.test(n) ? n : `${n}.pdf`;
}

export async function runAblage(opts: { deadline?: number } = {}): Promise<AblageResult> {
  const deadline = opts.deadline ?? Date.now() + 50_000;
  const d = await getDb();
  const hints: string[] = [];
  const countOpen = async () =>
    Number((await d.get<{ n: number }>("SELECT COUNT(*) AS n FROM buch_ablage WHERE status IN ('offen','in_arbeit')"))?.n ?? 0);

  if (!(await driveConfigured())) {
    return {
      configured: false,
      erledigt: 0,
      fehler: 0,
      offen: await countOpen(),
      hinweise: ["Google Drive ist nicht verbunden – in Arion OS unter Buchhaltung „Mit Google verbinden“. Ablage-Aufträge warten."],
    };
  }

  const cutoff = stamp(new Date(Date.now() - STALE_MINUTES * 60_000));
  const orders = await d.all<Order>(
    `SELECT id, eingang_id, seiten, ziel_pfad, dateiname FROM buch_ablage
     WHERE status = 'offen' OR (status = 'in_arbeit' AND (gestartet_at IS NULL OR gestartet_at < ?))
     ORDER BY id ASC LIMIT ${MAX_PER_RUN}`,
    [cutoff]
  );

  let erledigt = 0;
  let fehler = 0;
  const touched = new Set<number>();
  for (const o of orders) {
    if (deadline - Date.now() < ORDER_MIN_MS) {
      hints.push("Zeitbudget erreicht – restliche Aufträge folgen beim nächsten Lauf.");
      break;
    }
    if (!(await claim(d, o.id))) continue;
    touched.add(Number(o.eingang_id));
    try {
      const meta = await d.get<{ mime: string }>("SELECT mime FROM buch_eingang WHERE id = ?", [o.eingang_id]);
      const blob = await d.get<{ data: Buffer | Uint8Array }>("SELECT data FROM buch_eingang_blobs WHERE eingang_id = ?", [
        o.eingang_id,
      ]);
      if (!meta || !blob) throw new Error(`Eingang ${o.eingang_id} oder dessen Datei fehlt.`);
      const bytes = await buildPdf(new Uint8Array(blob.data), meta.mime, o.seiten);
      const folderId = await resolveFolderPath(o.ziel_pfad, true, { deadline });
      if (!folderId) throw new Error("Zielordner konnte nicht angelegt werden.");
      // Idempotent: ein abgebrochener Lauf kann die Datei schon hochgeladen haben
      const up =
        (await findByAblageId(folderId, o.id, { deadline })) ??
        (await uploadFile(folderId, pdfName(o.dateiname), bytes, "application/pdf", {
          deadline,
          appProperties: { ablageId: String(o.id) },
        }));
      await d.run(
        `UPDATE buch_ablage SET status = 'erledigt', drive_file_id = ?, drive_url = ?, dateiname = ?, fehler = '', done_at = ${nowExpr(d)} WHERE id = ?`,
        [up.id, up.url, up.name, o.id]
      );
      erledigt++;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
      await d.run("UPDATE buch_ablage SET status = 'fehler', fehler = ? WHERE id = ?", [msg, o.id]);
      hints.push(`Auftrag ${o.id}: ${msg}`);
      fehler++;
    }
  }

  // Eingang gilt als abgelegt, wenn alle seine Aufträge erledigt sind
  for (const eid of touched) {
    const r = await d.get<{ total: number; done: number }>(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'erledigt' THEN 1 ELSE 0 END) AS done FROM buch_ablage WHERE eingang_id = ?",
      [eid]
    );
    if (r && Number(r.total) > 0 && Number(r.total) === Number(r.done)) {
      await d.run(`UPDATE buch_eingang SET status = 'abgelegt', updated_at = ${nowExpr(d)} WHERE id = ?`, [eid]);
    }
  }

  return { configured: true, erledigt, fehler, offen: await countOpen(), hinweise: hints };
}
