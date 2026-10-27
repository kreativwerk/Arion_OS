import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Unterschrift und Stempel für das Unterschreiben auf dem Server
 * (lib/draft-sign.ts). Nur mit App-Login erreichbar (proxy/middleware).
 * GET: welche Bilder hinterlegt sind (ohne Inhalt). POST (multipart): key + file.
 */

const KEY = /^[a-z0-9_-]{2,40}$/;
const MAX_BYTES = 2 * 1024 * 1024;

export const GET = withApi(async () => {
  const d = await getDb();
  const rows = await d.all<{ key: string; mime: string; size: number; updated_at: string }>(
    "SELECT key, mime, LENGTH(data) AS size, updated_at FROM sign_assets ORDER BY key"
  );
  return NextResponse.json(rows);
});

export const POST = withApi(async (req: NextRequest) => {
  const form = await req.formData();
  const key = String(form.get("key") ?? "");
  const file = form.get("file");
  if (!KEY.test(key)) return NextResponse.json({ error: "key: 2–40 Zeichen a–z, 0–9, _ oder -" }, { status: 400 });
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "Datei fehlt" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Bild ist größer als 2 MB" }, { status: 400 });
  const mime = file.type || "";
  if (!/^image\/(png|jpe?g)$/.test(mime)) return NextResponse.json({ error: "Nur PNG oder JPG (PNG mit transparentem Hintergrund empfohlen)" }, { status: 400 });
  const d = await getDb();
  await d.run(
    `INSERT INTO sign_assets (key, mime, data, updated_at) VALUES (?,?,?,?)
     ON CONFLICT (key) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
    [key, mime, Buffer.from(await file.arrayBuffer()), new Date().toISOString()]
  );
  return NextResponse.json({ ok: true, key, size: file.size }, { status: 201 });
});
