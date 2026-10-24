import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { importiere1590, MAX_1590_BYTES, overview1590 } from "@/lib/buch-1590";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?jahr=YYYY – Konto-1590-Liste mit Status. */
export const GET = withApi(async (req: NextRequest) => {
  const jahr = req.nextUrl.searchParams.get("jahr");
  return NextResponse.json(await overview1590(await getDb(), jahr && /^\d{4}$/.test(jahr) ? jahr : null));
});

/** POST multipart (file): neue Liste vom Steuerbüro einlesen. */
export const POST = withApi(async (req: NextRequest) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "Datei fehlt." }, { status: 400 });
  if (file.size > MAX_1590_BYTES) return NextResponse.json({ error: "Datei zu groß (max. 4 MB)." }, { status: 400 });
  const name = file instanceof File ? file.name : "Liste 1590";
  const res = await importiere1590(await getDb(), Buffer.from(await file.arrayBuffer()), file.type, name);
  return NextResponse.json(res);
});

/** PATCH {id, status: offen|erledigt, notiz?} – Zeile von Hand setzen (z. B. Eigenbeleg, angefragt). */
export const PATCH = withApi(async (req: NextRequest) => {
  const b = (await req.json().catch(() => ({}))) as { id?: number; status?: string; notiz?: string };
  const id = Number(b.id);
  if (!id || !["offen", "erledigt"].includes(String(b.status))) {
    return NextResponse.json({ error: "id und status (offen|erledigt) erforderlich." }, { status: 400 });
  }
  const d = await getDb();
  const sets = b.status === "offen" ? ", datei = '', datei_url = ''" : "";
  await d.run(`UPDATE buch_1590 SET status = ?, notiz = ?, updated_at = ?${sets} WHERE id = ?`, [
    b.status,
    String(b.notiz ?? "").slice(0, 300),
    new Date().toISOString(),
    id,
  ]);
  return NextResponse.json({ ok: true });
});
