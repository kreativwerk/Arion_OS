import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Eigene Anhänge an einen Entwurf hängen (und vor dem Versand wieder abnehmen).
 * Die Dateien landen in `mail_draft_files`; lib/mail-send.ts nimmt sie beim
 * Senden mit. Nur solange der Entwurf „entwurf“ oder „fehler“ ist.
 *
 * Eine Datei pro Anfrage – Vercel begrenzt den Request-Body auf ca. 4,5 MB.
 */

const MAX_FILE = 4 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;

async function editable(draftId: number) {
  const d = await getDb();
  const cur = await d.get<{ status: string }>("SELECT status FROM mail_drafts WHERE id = ?", [draftId]);
  if (!cur) return { d, error: NextResponse.json({ error: "Entwurf nicht gefunden" }, { status: 404 }) };
  if (!["entwurf", "fehler"].includes(cur.status)) {
    return { d, error: NextResponse.json({ error: `Entwurf ist „${cur.status}“ – Anhänge nicht mehr änderbar.` }, { status: 409 }) };
  }
  return { d, error: null };
}

async function filesOf(draftId: number) {
  const d = await getDb();
  return d.all<{ id: number; filename: string }>("SELECT id, filename FROM mail_draft_files WHERE draft_id = ? ORDER BY id", [draftId]);
}

export const POST = withApi(async (req: NextRequest) => {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Upload erwartet multipart/form-data." }, { status: 400 });
  const draftId = Number(form.get("draft_id"));
  const file = form.get("file");
  if (!draftId) return NextResponse.json({ error: "draft_id erforderlich" }, { status: 400 });
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Keine Datei erhalten." }, { status: 400 });
  if (file.size > MAX_FILE) {
    return NextResponse.json({ error: `„${file.name}“ ist zu groß (max. 4 MB pro Datei).` }, { status: 413 });
  }

  const { d, error } = await editable(draftId);
  if (error) return error;
  const total = await d.get<{ n: number | string | null }>(
    "SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM mail_draft_files WHERE draft_id = ?",
    [draftId]
  );
  if (Number(total?.n ?? 0) + file.size > MAX_TOTAL) {
    return NextResponse.json({ error: "Anhänge zusammen über 20 MB – das nehmen viele Mailserver nicht an." }, { status: 413 });
  }

  const name = (file.name || "Anhang").replace(/[\\/\r\n]/g, "_").slice(0, 200);
  await d.run("INSERT INTO mail_draft_files (draft_id, filename, mime, data) VALUES (?,?,?,?)", [
    draftId,
    name,
    file.type || "application/octet-stream",
    Buffer.from(await file.arrayBuffer()),
  ]);
  await d.run("UPDATE mail_drafts SET updated_at = ? WHERE id = ?", [new Date().toISOString(), draftId]);
  return NextResponse.json({ ok: true, files: await filesOf(draftId) }, { status: 201 });
});

/** Anhang vom Entwurf abnehmen (nur vor dem Versand; betrifft nur die Kopie im Entwurf). */
export const DELETE = withApi(async (req: NextRequest) => {
  const draftId = Number(req.nextUrl.searchParams.get("draft_id"));
  const fileId = Number(req.nextUrl.searchParams.get("id"));
  if (!draftId || !fileId) return NextResponse.json({ error: "draft_id und id erforderlich" }, { status: 400 });
  const { d, error } = await editable(draftId);
  if (error) return error;
  await d.run("DELETE FROM mail_draft_files WHERE id = ? AND draft_id = ?", [fileId, draftId]);
  return NextResponse.json({ ok: true, files: await filesOf(draftId) });
});
