import type { ImapFlow } from "imapflow";
import type { DB } from "@/lib/db";
import { accountsFromDb, accountsFromEnv } from "@/lib/mail-fetch";
import { openImap } from "@/lib/mail-archive";
import { parseAttachmentMeta, type AttachmentInfo } from "@/lib/mail-parts";

/**
 * Kopie der Mail-Anhänge in der Datenbank (Tabelle mail_attachment_blobs).
 *
 * Bisher lagen Anhänge nur auf dem IMAP-Server und kamen erst beim Öffnen
 * (eingeloggter Browser) oder beim Weiterleiten dazu. Der Mail-Cron lädt jetzt
 * PDFs und Bilder der letzten Wochen nach – nur lesend, im Postfach ändert sich
 * nichts. Damit stehen Anhänge auch ohne Browser zur Verfügung, z. B. für das
 * Unterschreiben auf dem Server (lib/draft-sign.ts).
 */

/** Nur Dokumente und Bilder – keine Archive, Kalender, weitergeleiteten Mails. */
const STORE_MIME = /^(application\/pdf|image\/(png|jpe?g|gif|webp|heic|tiff))$/i;
export const STORE_MAX_BYTES = 10 * 1024 * 1024;
/** Wie weit der Cron zurück nachlädt. */
export const STORE_DAYS = Number(process.env.MAIL_ATTACHMENT_DAYS || 60);
const MAILS_PER_RUN = 25;

export type StoredAttachment = { filename: string; mime: string; data: Buffer };

/** Lohnt sich die Kopie dieses Anhangs? */
export function storableAttachment(a: Pick<AttachmentInfo, "mime" | "size">): boolean {
  return STORE_MIME.test(a.mime || "") && a.size > 0 && a.size <= STORE_MAX_BYTES;
}

/** Mails, deren speicherbare Anhänge noch fehlen (neueste zuerst). */
export function missingParts(attachmentsJson: string, stored: Set<string>): AttachmentInfo[] {
  return parseAttachmentMeta(attachmentsJson).filter((a) => storableAttachment(a) && !stored.has(a.part));
}

async function readAll(stream: AsyncIterable<Buffer>, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of stream) {
    n += c.length;
    if (n > max) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function saveBlob(d: DB, mailId: number, a: AttachmentInfo, data: Buffer) {
  await d.run(
    `INSERT INTO mail_attachment_blobs (mail_id, part, filename, mime, size, data) VALUES (?,?,?,?,?,?)
     ON CONFLICT (mail_id, part) DO NOTHING`,
    [mailId, a.part, a.filename, a.mime, data.length, data]
  );
}

/**
 * Lädt für ein Konto fehlende Anhänge nach (läuft im Mail-Archiv mit offener
 * IMAP-Verbindung). Gibt die Zahl der neu gespeicherten Anhänge zurück.
 */
export async function storeAttachmentBlobs(client: ImapFlow, d: DB, account: string, deadline: number): Promise<number> {
  const since = new Date(Date.now() - STORE_DAYS * 86_400_000).toISOString();
  const rows = await d.all<{ id: number; folder: string; uid: number; uidvalidity: string; attachments: string }>(
    `SELECT m.id, m.folder, m.uid, m.uidvalidity, m.attachments FROM mails m
     WHERE m.account = ? AND m.date >= ? AND m.attachments <> '[]'
       AND NOT EXISTS (SELECT 1 FROM mail_attachment_blobs b WHERE b.mail_id = m.id)
     ORDER BY m.id DESC LIMIT ?`,
    [account, since, MAILS_PER_RUN * 4]
  );
  const todo = rows
    .map((r) => ({ ...r, parts: missingParts(r.attachments, new Set()) }))
    .filter((r) => r.parts.length)
    .slice(0, MAILS_PER_RUN);
  if (!todo.length) return 0;

  let saved = 0;
  const byFolder = new Map<string, typeof todo>();
  for (const r of todo) byFolder.set(r.folder, [...(byFolder.get(r.folder) || []), r]);
  for (const [folder, mails] of byFolder) {
    if (deadline - Date.now() < 4_000) break;
    const lock = await client.getMailboxLock(folder, { readOnly: true });
    try {
      const mb = client.mailbox;
      const validity = mb && typeof mb !== "boolean" ? String(mb.uidValidity) : "";
      for (const m of mails) {
        if (deadline - Date.now() < 3_000) break;
        if (m.uidvalidity !== validity) continue;
        for (const a of m.parts) {
          const dl = await client.download(String(m.uid), a.part, { uid: true, maxBytes: STORE_MAX_BYTES + 1 });
          const data = await readAll(dl.content as AsyncIterable<Buffer>, STORE_MAX_BYTES);
          if (!data || !data.length) continue;
          await saveBlob(d, Number(m.id), a, data);
          saved++;
        }
      }
    } finally {
      lock.release();
    }
  }
  return saved;
}

/**
 * Ein Anhang einer archivierten Mail: aus der Datenbank, sonst live vom
 * IMAP-Server (und dann für das nächste Mal gespeichert, sofern geeignet).
 */
export async function loadMailAttachment(d: DB, mailId: number, part: string, maxBytes = 25 * 1024 * 1024): Promise<StoredAttachment> {
  const blob = await d.get<{ filename: string; mime: string; data: Buffer | Uint8Array }>(
    "SELECT filename, mime, data FROM mail_attachment_blobs WHERE mail_id = ? AND part = ?",
    [mailId, part]
  );
  if (blob) return { filename: blob.filename, mime: blob.mime, data: Buffer.from(blob.data) };

  const mail = await d.get<{ account: string; folder: string; uid: number; uidvalidity: string; attachments: string }>(
    "SELECT account, folder, uid, uidvalidity, attachments FROM mails WHERE id = ?",
    [mailId]
  );
  if (!mail) throw new Error("Mail nicht gefunden.");
  const meta = parseAttachmentMeta(mail.attachments).find((a) => a.part === part);
  if (!meta) throw new Error("Anhang nicht gefunden.");

  const hints: string[] = [];
  const acc = [...(await accountsFromDb(d, hints)), ...accountsFromEnv()].find((a) => a.label === mail.account);
  if (!acc) throw new Error(`Postfach „${mail.account}“ ist nicht (mehr) verbunden.`);
  const client = openImap(acc);
  let data: Buffer | null = null;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mail.folder, { readOnly: true });
    try {
      const mb = client.mailbox;
      if (!mb || typeof mb === "boolean" || String(mb.uidValidity) !== mail.uidvalidity) {
        throw new Error("Ordner wurde auf dem Server neu aufgebaut – Mail bitte neu suchen.");
      }
      const dl = await client.download(String(mail.uid), part, { uid: true, maxBytes: maxBytes + 1 });
      data = await readAll(dl.content as AsyncIterable<Buffer>, maxBytes);
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    try {
      await client.logout();
    } catch {
      /* bereits getrennt */
    }
    throw e;
  }
  if (!data) throw new Error("Anhang ist zu groß.");
  if (storableAttachment({ mime: meta.mime, size: data.length })) await saveBlob(d, mailId, meta, data);
  return { filename: meta.filename, mime: meta.mime, data };
}
