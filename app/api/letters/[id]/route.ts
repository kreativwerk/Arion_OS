import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { analyzeStoredLetter } from "@/lib/letter-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Original-Scan im Browser öffnen. */
export const GET = withApi(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const d = await getDb();
  const meta = await d.get<{ file_ref: string; mime: string }>("SELECT file_ref, mime FROM letters WHERE id = ?", [id]);
  const blob = await d.get<{ data: Buffer | Uint8Array }>("SELECT data FROM letter_blobs WHERE letter_id = ?", [id]);
  if (!meta || !blob) return NextResponse.json({ error: "Scan nicht gefunden" }, { status: 404 });

  const body = Buffer.isBuffer(blob.data) ? blob.data : Buffer.from(blob.data);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": meta.mime || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.file_ref || `brief-${id}`)}`,
      "Content-Length": String(body.length),
      "Cache-Control": "private, max-age=0",
    },
  });
});

/** KI-Analyse erneut ausführen (z.B. nachdem ein API-Key hinterlegt wurde). */
export const POST = withApi(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const analysisError = await analyzeStoredLetter(Number(id));
  const d = await getDb();
  const row = await d.get("SELECT * FROM letters WHERE id = ?", [id]);
  return NextResponse.json({ letter: row, analysisError }, { status: analysisError ? 422 : 200 });
});

/** Brief samt Scan löschen. */
export const DELETE = withApi(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const d = await getDb();
  await d.run("DELETE FROM letter_blobs WHERE letter_id = ?", [id]);
  await d.run("DELETE FROM letters WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
});
