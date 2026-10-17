import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Nur diese Typen werden im Browser angezeigt; alles andere als Download. */
const INLINE_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
/** Vercel begrenzt Funktionsantworten auf 4,5 MB – größere Belege nur über Drive. */
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

/** GET /api/buchhaltung/eingang/:id/datei[?download=1] – Original-Beleg (Vorschau/Download). */
export const GET = withApi(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "Ungültige id" }, { status: 400 });
  const d = await getDb();
  const meta = await d.get<{ filename: string; mime: string; size: number }>(
    "SELECT filename, mime, size FROM buch_eingang WHERE id = ?",
    [Number(id)]
  );
  if (meta && Number(meta.size) > MAX_PREVIEW_BYTES) {
    return NextResponse.json(
      { error: "Zu groß für die Vorschau (über 4 MB) – nach der Ablage über Google Drive öffnen." },
      { status: 413 }
    );
  }
  const blob = await d.get<{ data: Buffer | Uint8Array }>("SELECT data FROM buch_eingang_blobs WHERE eingang_id = ?", [Number(id)]);
  if (!meta || !blob) return NextResponse.json({ error: "Datei nicht gefunden" }, { status: 404 });

  const body = Buffer.isBuffer(blob.data) ? blob.data : Buffer.from(blob.data);
  if (body.length > MAX_PREVIEW_BYTES) {
    return NextResponse.json(
      { error: "Zu groß für die Vorschau (über 4 MB) – nach der Ablage über Google Drive öffnen." },
      { status: 413 }
    );
  }
  const inline = INLINE_MIME.has(meta.mime) && req.nextUrl.searchParams.get("download") !== "1";
  const filename = encodeURIComponent(meta.filename || `beleg-${id}`);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": inline ? meta.mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
      "Content-Length": String(body.length),
      "Cache-Control": "private, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
