import { randomUUID } from "crypto";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { DB } from "@/lib/db";
import { decryptSecret } from "@/lib/secret-store";
import { openImap } from "@/lib/mail-archive";
import { parseAddressList, sentFolder, smtpFor, type FolderInfo } from "@/lib/mail-parts";
import { loadForwardAttachments, type LoadedAttachment } from "@/lib/mail-forward";
import { signDraft } from "@/lib/draft-sign";

/**
 * Versand freigegebener Entwürfe über den SMTP-Server des Postfachs.
 *
 * Ablauf: Entwurf atomar auf „sendet“ setzen (kein Doppelversand bei
 * Doppeltipp) → SMTP → „gesendet“ → Kopie per IMAP in den Gesendet-Ordner →
 * beantwortete Mail mit \Answered markieren. Scheitert erst die Kopie, bleibt
 * der Entwurf „gesendet“ (die Mail ist ja raus) und der Hinweis steht in `error`.
 *
 * Aufgerufen wird das nur aus der App (Session-Login), nie über Bearer-Tokens.
 */

type DraftRow = {
  id: number;
  account_id: number;
  to_addr: string;
  cc_addr: string;
  bcc_addr: string;
  subject: string;
  body_text: string;
  reply_mail_id: number | null;
  forward_mail_id: number | null;
  sign_spec: string | null;
  sign_status: string | null;
  in_reply_to: string;
  references_hdr: string;
  status: string;
};

type AccountRow = {
  id: number;
  label: string;
  address: string;
  host: string;
  port: number;
  username: string;
  password_enc: string;
  smtp_host: string;
  smtp_port: number;
  display_name: string;
};

export type SendResult = { ok: boolean; status: string; messageId?: string; hinweis?: string; error?: string };

export async function sendDraft(d: DB, draftId: number): Promise<SendResult> {
  const claimed = await d.all<{ id: number }>(
    "UPDATE mail_drafts SET status = 'sendet', error = '', updated_at = ? WHERE id = ? AND status IN ('entwurf','fehler') RETURNING id",
    [new Date().toISOString(), draftId]
  );
  if (!claimed.length) {
    const cur = await d.get<{ status: string }>("SELECT status FROM mail_drafts WHERE id = ?", [draftId]);
    return { ok: false, status: cur?.status ?? "unbekannt", error: cur ? `Entwurf ist bereits „${cur.status}“.` : "Entwurf nicht gefunden." };
  }

  const fail = async (msg: string): Promise<SendResult> => {
    await d.run("UPDATE mail_drafts SET status = 'fehler', error = ?, updated_at = ? WHERE id = ?", [
      msg,
      new Date().toISOString(),
      draftId,
    ]);
    return { ok: false, status: "fehler", error: msg };
  };

  const draft = await d.get<DraftRow>("SELECT * FROM mail_drafts WHERE id = ?", [draftId]);
  if (!draft) return fail("Entwurf nicht gefunden.");
  // Unterschrifts-Auftrag noch offen? Dann jetzt – ohne fertige Unterschrift wird nicht gesendet.
  if (draft.sign_spec && draft.sign_status !== "fertig") {
    const signed = await signDraft(d, draftId);
    if (!signed.ok) return fail(`Unterschrift: ${signed.error}`);
  }
  const acc = await d.get<AccountRow>("SELECT * FROM mail_accounts WHERE id = ?", [draft.account_id]);
  if (!acc || !acc.password_enc) return fail("Absender-Postfach fehlt oder hat kein Passwort.");

  let to: string[], cc: string[], bcc: string[];
  try {
    to = parseAddressList(draft.to_addr);
    cc = parseAddressList(draft.cc_addr);
    bcc = parseAddressList(draft.bcc_addr);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (!to.length) return fail("Kein Empfänger angegeben.");
  if (!draft.subject.trim()) return fail("Betreff fehlt.");

  let pass: string;
  try {
    pass = decryptSecret(acc.password_enc);
  } catch {
    return fail("Postfach-Passwort nicht entschlüsselbar – bitte im Mail-Modul neu eingeben.");
  }

  const fromAddr = acc.username || acc.address;
  const domain = fromAddr.split("@")[1] || "arion-os.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const files = await d.all<{ filename: string; mime: string; data: Buffer | Uint8Array }>(
    "SELECT filename, mime, data FROM mail_draft_files WHERE draft_id = ? ORDER BY id",
    [draftId]
  );
  // Weiterleitung: Anhänge der Originalmail frisch vom Server – fehlen sie, wird nicht gesendet
  let forwarded: LoadedAttachment[] = [];
  if (draft.forward_mail_id) {
    try {
      forwarded = await loadForwardAttachments(d, Number(draft.forward_mail_id));
    } catch (e) {
      return fail(`Anhänge der weitergeleiteten Mail: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const composer = new MailComposer({
    from: acc.display_name ? { name: acc.display_name, address: fromAddr } : fromAddr,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    subject: draft.subject,
    text: draft.body_text,
    messageId,
    inReplyTo: draft.in_reply_to || undefined,
    references: draft.references_hdr || undefined,
    attachments: [
      ...files.map((f) => ({ filename: f.filename, contentType: f.mime, content: Buffer.from(f.data) })),
      ...forwarded.map((f) => ({ filename: f.filename, contentType: f.mime, content: f.content })),
    ],
  });
  const raw: Buffer = await composer.compile().build();

  const smtp = smtpFor(acc.host, acc.smtp_host, acc.smtp_port);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: { user: acc.username || acc.address, pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({ envelope: { from: fromAddr, to: [...to, ...cc, ...bcc] }, raw });
  } catch (e) {
    return fail(`SMTP: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    transport.close();
  }

  const now = new Date().toISOString();
  await d.run(
    "UPDATE mail_drafts SET status = 'gesendet', sent_at = ?, smtp_message_id = ?, updated_at = ? WHERE id = ?",
    [now, messageId, now, draftId]
  );

  // Kopie in „Gesendet“ + Original als beantwortet markieren (Fehler hier sind nur Hinweise)
  let hinweis = "";
  const client = openImap({ label: acc.label, host: acc.host, port: Number(acc.port) || 993, user: acc.username, pass });
  try {
    await client.connect();
    const list = (await client.list()) as FolderInfo[];
    const sent = sentFolder(list);
    if (sent) await client.append(sent, raw, ["\\Seen"]);
    else hinweis = "Kein Gesendet-Ordner gefunden – Kopie nicht abgelegt.";
    if (draft.reply_mail_id) {
      const orig = await d.get<{ folder: string; uid: number; uidvalidity: string }>(
        "SELECT folder, uid, uidvalidity FROM mails WHERE id = ?",
        [draft.reply_mail_id]
      );
      if (orig) {
        const lock = await client.getMailboxLock(orig.folder);
        try {
          const mb = client.mailbox;
          if (mb && typeof mb !== "boolean" && String(mb.uidValidity) === orig.uidvalidity) {
            await client.messageFlagsAdd(String(orig.uid), ["\\Answered"], { uid: true });
          }
        } finally {
          lock.release();
        }
      }
    }
    await client.logout();
  } catch (e) {
    hinweis = `Gesendet, aber Kopie/Markierung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
    try {
      await client.logout();
    } catch {
      /* bereits getrennt */
    }
  }
  if (hinweis) await d.run("UPDATE mail_drafts SET error = ? WHERE id = ?", [hinweis, draftId]);
  return { ok: true, status: "gesendet", messageId, hinweis: hinweis || undefined };
}
