import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyExternalToken } from "@/lib/external-auth";
import { analyzeStoredLetter, appendLetterChunk, LETTER_CHUNK_SIZE } from "@/lib/letter-store";
import { notifyLetterbox } from "@/lib/letterbox";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** Nächstes Stück eines Briefkasten-Scans anhängen (siehe POST /api/external/letters). */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const token = await verifyExternalToken(req.headers.get("authorization"));
  if (!token) return NextResponse.json({ error: "Ungültiger oder fehlender API-Token" }, { status: 401 });

  const id = Number((await ctx.params).id);
  const d = await getDb();
  // Nur Briefe, die noch auf weitere Stücke warten: frisch angelegt und unanalysiert
  const meta = await d.get<{ status: string; summary: string | null }>("SELECT status, summary FROM letters WHERE id = ?", [id]);
  if (!meta || meta.status !== "neu" || meta.summary) {
    return NextResponse.json({ error: "Brief nicht gefunden oder bereits abgeschlossen" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const chunk = form?.get("file");
  if (!form || !(chunk instanceof Blob) || chunk.size === 0) return NextResponse.json({ error: "Stück fehlt" }, { status: 400 });
  if (chunk.size > LETTER_CHUNK_SIZE + 1024) return NextResponse.json({ error: "Stück zu groß" }, { status: 400 });
  const error = await appendLetterChunk(id, Number(form.get("offset")), Buffer.from(await chunk.arrayBuffer()));
  if (error) return NextResponse.json({ error }, { status: 409 });

  if (form.get("final") !== "1") return NextResponse.json({ id, count: 0 });
  const result = await analyzeStoredLetter(id);
  await notifyLetterbox(result.ids).catch(() => {});
  return NextResponse.json({ id, count: result.ids.length, analysisError: result.error });
}
