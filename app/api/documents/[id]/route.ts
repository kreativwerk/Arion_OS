import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Dokument herunterladen / im Browser öffnen. */
export const GET = withApi(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const d = await getDb();
  const meta = await d.get<{ filename: string; mime: string }>(
    "SELECT filename, mime FROM documents WHERE id = ?",
    [id]
  );
  const blob = await d.get<{ data: Buffer | Uint8Array }>(
    "SELECT data FROM document_blobs WHERE document_id = ?",
    [id]
  );
  if (!meta || !blob) return NextResponse.json({ error: "Dokument nicht gefunden" }, { status: 404 });

  const body = Buffer.isBuffer(blob.data) ? blob.data : Buffer.from(blob.data);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": meta.mime || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
      "Content-Length": String(body.length),
      "Cache-Control": "private, max-age=0",
    },
  });
});
