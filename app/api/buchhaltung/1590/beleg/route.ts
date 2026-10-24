import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { belegHochladen1590, MAX_1590_BYTES } from "@/lib/buch-1590";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST multipart (id, file): Beleg zu einer 1590-Zeile ins Drive hochladen. */
export const POST = withApi(async (req: NextRequest) => {
  const form = await req.formData();
  const id = Number(form.get("id"));
  const file = form.get("file");
  if (!id || !(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "id und Datei erforderlich." }, { status: 400 });
  if (file.size > MAX_1590_BYTES) return NextResponse.json({ error: "Datei zu groß (max. 4 MB)." }, { status: 400 });
  if (!/^(application\/pdf|image\/(jpeg|png|heic|webp))$/.test(file.type)) {
    return NextResponse.json({ error: "Nur PDF oder Foto." }, { status: 400 });
  }
  const up = await belegHochladen1590(
    await getDb(),
    id,
    Buffer.from(await file.arrayBuffer()),
    file.type,
    file instanceof File ? file.name : "Beleg.pdf"
  );
  return NextResponse.json({ ok: true, datei: up.name, url: up.url });
});
