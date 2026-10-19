import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Eine archivierte Mail komplett (Text, HTML, Anhangsliste). */
export const GET = withApi(async (req: NextRequest) => {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id erforderlich" }, { status: 400 });
  const d = await getDb();
  const mail = await d.get<Record<string, unknown>>("SELECT * FROM mails WHERE id = ?", [id]);
  if (!mail) return NextResponse.json({ error: "Mail nicht gefunden" }, { status: 404 });
  const html = mail.has_html ? await d.get<{ html: string }>("SELECT html FROM mail_html WHERE mail_id = ?", [id]) : undefined;
  let attachments: unknown[] = [];
  try {
    attachments = JSON.parse(String(mail.attachments || "[]"));
  } catch {
    /* leer lassen */
  }
  return NextResponse.json({ ...mail, attachments, html: html?.html ?? "" });
});
