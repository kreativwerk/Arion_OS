import type { DB } from "@/lib/db";
import { accountsFromDb, accountsFromEnv } from "@/lib/mail-fetch";
import { openImap } from "@/lib/mail-archive";
import { parseAttachmentMeta } from "@/lib/mail-parts";

/**
 * Weiterleiten: Anhänge der Originalmail liegen nur auf dem IMAP-Server.
 * Sie werden erst beim Versand geladen (nur lesend) und an die Mail gehängt –
 * so braucht der Entwurf nur einen Verweis (mail_drafts.forward_mail_id).
 */

export const FORWARD_MAX_BYTES = 20 * 1024 * 1024;

export type LoadedAttachment = { filename: string; mime: string; content: Buffer };

export async function loadForwardAttachments(d: DB, mailId: number): Promise<LoadedAttachment[]> {
  const mail = await d.get<{ account: string; folder: string; uid: number; uidvalidity: string; attachments: string }>(
    "SELECT account, folder, uid, uidvalidity, attachments FROM mails WHERE id = ?",
    [mailId]
  );
  if (!mail) throw new Error("Originalmail nicht gefunden.");
  const metas = parseAttachmentMeta(mail.attachments);
  if (!metas.length) return [];
  if (metas.reduce((s, a) => s + a.size, 0) > FORWARD_MAX_BYTES) {
    throw new Error("Anhänge der Originalmail sind zusammen größer als 20 MB.");
  }

  // Alle Anhänge schon als Kopie in der Datenbank? Dann ohne IMAP-Abruf.
  const blobs = await d.all<{ part: string; data: Buffer | Uint8Array }>(
    "SELECT part, data FROM mail_attachment_blobs WHERE mail_id = ?",
    [mailId]
  );
  const byPart = new Map(blobs.map((b) => [b.part, Buffer.from(b.data)]));
  if (metas.every((a) => byPart.has(a.part))) {
    return metas.map((a) => ({ filename: a.filename, mime: a.mime, content: byPart.get(a.part)! }));
  }

  const hints: string[] = [];
  const acc = [...(await accountsFromDb(d, hints)), ...accountsFromEnv()].find((a) => a.label === mail.account);
  if (!acc) throw new Error(`Postfach „${mail.account}“ ist nicht (mehr) verbunden.`);

  const client = openImap(acc);
  const out: LoadedAttachment[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mail.folder, { readOnly: true });
    try {
      const mb = client.mailbox;
      if (!mb || typeof mb === "boolean" || String(mb.uidValidity) !== mail.uidvalidity) {
        throw new Error("Ordner der Originalmail wurde auf dem Server neu aufgebaut.");
      }
      for (const a of metas) {
        const dl = await client.download(String(mail.uid), a.part, { uid: true, maxBytes: FORWARD_MAX_BYTES });
        const chunks: Buffer[] = [];
        for await (const c of dl.content as AsyncIterable<Buffer>) chunks.push(c);
        out.push({ filename: a.filename, mime: a.mime, content: Buffer.concat(chunks) });
      }
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
  return out;
}
