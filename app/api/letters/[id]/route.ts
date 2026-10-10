import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { analyzeStoredLetter, appendLetterChunk } from "@/lib/letter-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

/** Nächstes Stück eines großen Scans anhängen (siehe POST /api/letters);
 *  mit `final=1` läuft danach die KI-Analyse. */
export const PUT = withApi(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const form = await req.formData();
  const chunk = form.get("file");
  if (!(chunk instanceof Blob) || chunk.size === 0) return NextResponse.json({ error: "Stück fehlt" }, { status: 400 });
  const error = await appendLetterChunk(Number(id), Number(form.get("offset")), Buffer.from(await chunk.arrayBuffer()));
  if (error) return NextResponse.json({ error }, { status: 409 });

  const result = form.get("final") === "1" ? await analyzeStoredLetter(Number(id)) : { error: null, ids: [Number(id)] };
  const d = await getDb();
  const row = await d.get("SELECT * FROM letters WHERE id = ?", [id]);
  return NextResponse.json({ letter: row, analysisError: result.error, count: result.ids.length });
});

/** KI-Analyse erneut ausführen (z.B. nachdem ein API-Key hinterlegt wurde). */
export const POST = withApi(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { error: analysisError, ids } = await analyzeStoredLetter(Number(id));
  const d = await getDb();
  const row = await d.get("SELECT * FROM letters WHERE id = ?", [id]);
  return NextResponse.json({ letter: row, analysisError, count: ids.length }, { status: analysisError ? 422 : 200 });
});

/** Brief samt Scan löschen. */
export const DELETE = withApi(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const d = await getDb();
  await d.run("DELETE FROM letter_blobs WHERE letter_id = ?", [id]);
  await d.run("DELETE FROM letters WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
});
