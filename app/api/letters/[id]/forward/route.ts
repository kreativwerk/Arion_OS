import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { letterForwardDraft } from "@/lib/letter-forward";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Brief als E-Mail weiterleiten: legt einen Entwurf im Postfach an – mit dem
 * Scan als PDF-Anhang, Betreff und Kurzfassung. Absender-Postfach passend zur
 * Firma des Briefs. Verschickt wird erst, wenn im Postfach auf Senden gedrückt wird.
 */
export const POST = withApi(async (req: NextRequest, ctx: Ctx) => {
  const id = Number((await ctx.params).id);
  const body = (await req.json().catch(() => ({}))) as { to?: string };
  const d = await getDb();
  const letter = await d.get<{
    subject: string;
    sender: string;
    summary: string;
    action: string;
    reference: string;
    received_date: string;
    firma: string | null;
    file_ref: string;
    mime: string;
  }>("SELECT subject, sender, summary, action, reference, received_date, firma, file_ref, mime FROM letters WHERE id = ?", [id]);
  if (!letter) return NextResponse.json({ error: "Brief nicht gefunden" }, { status: 404 });
  const blob = await d.get<{ data: Buffer | Uint8Array }>("SELECT data FROM letter_blobs WHERE letter_id = ?", [id]);

  const accounts = await d.all<{ id: number; label: string; address: string; username: string }>(
    "SELECT id, label, address, username FROM mail_accounts WHERE active = 1 AND password_enc <> '' ORDER BY id"
  );
  const draft = letterForwardDraft(letter, accounts);
  if (!draft.accountId) return NextResponse.json({ error: "Kein Postfach zum Versenden eingerichtet." }, { status: 400 });

  const draftId = await d.insert(
    `INSERT INTO mail_drafts (account_id, to_addr, cc_addr, bcc_addr, subject, body_text, source, note)
     VALUES (?,?,?,?,?,?,?,?)`,
    [draft.accountId, (body.to ?? "").trim().slice(0, 500), "", "", draft.subject, draft.body, "app", `Weiterleitung Brief #${id}`]
  );
  if (blob) {
    await d.run("INSERT INTO mail_draft_files (draft_id, filename, mime, data) VALUES (?,?,?,?)", [
      draftId,
      draft.filename,
      letter.mime || "application/pdf",
      Buffer.isBuffer(blob.data) ? blob.data : Buffer.from(blob.data),
    ]);
  }
  return NextResponse.json({ ok: true, draftId }, { status: 201 });
});
