import type { DB } from "@/lib/db";
import { parseAttachmentMeta } from "@/lib/mail-parts";

/** Dateinamen der Originalmail-Anhänge je Entwurf (für Listen und Startseite, ohne IMAP). */
export async function forwardFileNames(d: DB, drafts: { id: number; forward_mail_id?: number | null }[]): Promise<Map<number, string[]>> {
  const res = new Map<number, string[]>();
  const ids = [...new Set(drafts.map((r) => Number(r.forward_mail_id) || 0).filter(Boolean))];
  if (!ids.length) return res;
  const rows = await d.all<{ id: number; attachments: string }>(
    `SELECT id, attachments FROM mails WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  for (const r of drafts) {
    const m = rows.find((x) => Number(x.id) === Number(r.forward_mail_id));
    if (m) res.set(Number(r.id), parseAttachmentMeta(m.attachments).map((a) => a.filename));
  }
  return res;
}
