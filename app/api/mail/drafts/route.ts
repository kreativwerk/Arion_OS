import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { forwardBlock, forwardSubject, parseAddressList, replySubject } from "@/lib/mail-parts";
import { forwardFileNames } from "@/lib/mail-forward-names";
import type { DB } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Entwürfe: anlegen, bearbeiten, verwerfen. Versendet wird ausschließlich über
 * /api/mail/drafts/send nach Freigabe in der App. Entwürfe werden nie gelöscht,
 * sondern auf „verworfen“ gesetzt.
 */

const COLS = `d.id, d.account_id, a.label AS account, a.username AS from_addr, d.to_addr, d.cc_addr, d.bcc_addr, d.subject,
  d.body_text, d.reply_mail_id, d.forward_mail_id, d.sign_status, d.sign_error, d.source, d.note, d.status, d.error, d.created_at, d.updated_at, d.sent_at`;

async function list(status: string | null) {
  const d = await getDb();
  const where = status === "alle" ? "" : status ? "WHERE d.status = ?" : "WHERE d.status IN ('entwurf','sendet','fehler')";
  const rows = await d.all<Record<string, unknown>>(
    `SELECT ${COLS} FROM mail_drafts d LEFT JOIN mail_accounts a ON a.id = d.account_id ${where} ORDER BY d.id DESC LIMIT 100`,
    status && status !== "alle" ? [status] : []
  );
  const files = await d.all<{ draft_id: number; id: number; filename: string }>(
    "SELECT draft_id, id, filename FROM mail_draft_files ORDER BY id"
  );
  const fwd = await forwardFileNames(d, rows as { id: number; forward_mail_id: number | null }[]);
  return rows.map((r) => ({
    ...r,
    files: files.filter((f) => Number(f.draft_id) === Number(r.id)),
    forward_files: fwd.get(Number(r.id)) ?? [],
  }));
}

export const GET = withApi(async (req: NextRequest) => {
  return NextResponse.json(await list(req.nextUrl.searchParams.get("status")));
});

type Body = {
  id?: number;
  account_id?: number;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  reply_mail_id?: number;
  forward_mail_id?: number;
  note?: string;
  discard?: boolean;
};

function validate(b: Body) {
  parseAddressList(b.to);
  parseAddressList(b.cc);
  parseAddressList(b.bcc);
}

type OrigMail = {
  account: string;
  from_addr: string;
  to_addr: string;
  cc_addr: string;
  reply_to: string;
  subject: string;
  message_id: string;
  references_hdr: string;
  date: string;
  body_text: string;
};

/**
 * Absender = das Postfach, in dem die Mail liegt (Label oder Adresse),
 * sonst das Postfach, an das sie adressiert war.
 */
async function accountForMail(d: DB, orig: OrigMail): Promise<number> {
  const accs = await d.all<{ id: number; label: string; username: string; address: string }>(
    "SELECT id, label, username, address FROM mail_accounts WHERE active = 1 AND password_enc <> '' ORDER BY id"
  );
  const rcpt = `${orig.to_addr} ${orig.cc_addr}`.toLowerCase();
  const acc =
    accs.find((a) => a.label === orig.account) ||
    accs.find((a) => [a.username, a.address].some((x) => x && x.toLowerCase() === orig.account.toLowerCase())) ||
    accs.find((a) => [a.username, a.address].some((x) => x && rcpt.includes(x.toLowerCase())));
  return acc?.id ?? 0;
}

const ORIG_COLS = "account, from_addr, to_addr, cc_addr, reply_to, subject, message_id, references_hdr, date, body_text";

export const POST = withApi(async (req: NextRequest) => {
  const b = (await req.json().catch(() => ({}))) as Body;
  const d = await getDb();
  let subject = b.subject?.trim() || "";
  let to = b.to?.trim() || "";
  let body = b.body ?? "";
  let inReplyTo = "";
  let references = "";
  let accountId = Number(b.account_id) || 0;
  let forwardId: number | null = null;

  if (b.reply_mail_id && b.forward_mail_id) {
    return NextResponse.json({ error: "Entweder antworten oder weiterleiten." }, { status: 400 });
  }

  // Antwort: Empfänger, Betreff, Threading und Absender-Postfach aus der Originalmail
  if (b.reply_mail_id) {
    const orig = await d.get<OrigMail>(`SELECT ${ORIG_COLS} FROM mails WHERE id = ?`, [b.reply_mail_id]);
    if (!orig) return NextResponse.json({ error: "Originalmail nicht gefunden" }, { status: 404 });
    if (!to) to = orig.reply_to || orig.from_addr;
    if (!subject) subject = replySubject(orig.subject);
    inReplyTo = orig.message_id;
    references = [orig.references_hdr, orig.message_id].filter(Boolean).join(" ");
    if (!accountId) accountId = await accountForMail(d, orig);
  }

  // Weiterleitung: Betreff „WG:“, Originaltext unten dran, Anhänge kommen beim Versand
  if (b.forward_mail_id) {
    const orig = await d.get<OrigMail>(`SELECT ${ORIG_COLS} FROM mails WHERE id = ?`, [b.forward_mail_id]);
    if (!orig) return NextResponse.json({ error: "Originalmail nicht gefunden" }, { status: 404 });
    if (!subject) subject = forwardSubject(orig.subject);
    body = `${body.replace(/\s+$/, "")}${body.trim() ? "\n\n" : ""}${forwardBlock(orig)}`;
    forwardId = Number(b.forward_mail_id);
    if (!accountId) accountId = await accountForMail(d, orig);
  }
  if (!accountId) return NextResponse.json({ error: "Absender-Postfach wählen." }, { status: 400 });
  try {
    validate({ ...b, to });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const id = await d.insert(
    `INSERT INTO mail_drafts (account_id, to_addr, cc_addr, bcc_addr, subject, body_text, reply_mail_id, forward_mail_id, in_reply_to, references_hdr, source, note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [accountId, to, b.cc?.trim() || "", b.bcc?.trim() || "", subject, body, b.reply_mail_id ?? null, forwardId, inReplyTo, references, "app", b.note ?? ""]
  );
  return NextResponse.json({ ok: true, id, drafts: await list(null) });
});

export const PATCH = withApi(async (req: NextRequest) => {
  const b = (await req.json().catch(() => ({}))) as Body;
  if (!b.id) return NextResponse.json({ error: "id erforderlich" }, { status: 400 });
  const d = await getDb();
  const cur = await d.get<{ status: string }>("SELECT status FROM mail_drafts WHERE id = ?", [b.id]);
  if (!cur) return NextResponse.json({ error: "Entwurf nicht gefunden" }, { status: 404 });
  if (!["entwurf", "fehler"].includes(cur.status)) {
    return NextResponse.json({ error: `Entwurf ist „${cur.status}“ und kann nicht mehr geändert werden.` }, { status: 409 });
  }
  const now = new Date().toISOString();
  if (b.discard) {
    await d.run("UPDATE mail_drafts SET status = 'verworfen', updated_at = ? WHERE id = ?", [now, b.id]);
    return NextResponse.json({ ok: true, drafts: await list(null) });
  }
  try {
    validate(b);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  const map: [keyof Body, string][] = [
    ["account_id", "account_id"],
    ["to", "to_addr"],
    ["cc", "cc_addr"],
    ["bcc", "bcc_addr"],
    ["subject", "subject"],
    ["body", "body_text"],
    ["note", "note"],
  ];
  for (const [k, col] of map) {
    if (b[k] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(k === "account_id" ? Number(b[k]) : String(b[k]));
    }
  }
  sets.push("status = 'entwurf'", "updated_at = ?");
  params.push(now, b.id);
  await d.run(`UPDATE mail_drafts SET ${sets.join(", ")} WHERE id = ?`, params);
  return NextResponse.json({ ok: true, drafts: await list(null) });
});
