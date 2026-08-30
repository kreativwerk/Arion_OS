import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Dokumentenablage (Wissen): Wartungsverträge, Handbücher, Policen …
 *  Dateien liegen als Blob im Datenkern – funktioniert mit Supabase und SQLite
 *  identisch und wandert beim Backup automatisch mit. */

const MAX_SIZE = 4 * 1024 * 1024; // 4 MB – bleibt unter Vercels ~4,5-MB-Request-Limit

export const GET = withApi(async () => {
  const d = await getDb();
  const rows = await d.all(
    "SELECT id, title, filename, mime, size, category, scope, partner, tags, note, created_at FROM documents ORDER BY created_at DESC"
  );
  return NextResponse.json(rows);
});

export const POST = withApi(async (req: NextRequest) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Datei fehlt" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "Datei ist leer" }, { status: 400 });
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: `Datei zu groß (max. ${MAX_SIZE / 1024 / 1024} MB)` }, { status: 400 });
  }

  const str = (key: string, fallback = "") => {
    const v = form.get(key);
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : fallback;
  };
  const title = str("title", file.name);
  const category = str("category", "Allgemein");
  const scope = ["persoenlich", "unternehmen", "partner"].includes(str("scope"))
    ? str("scope")
    : "unternehmen";
  const partner = scope === "partner" ? str("partner") : "";
  const tags = str("tags");
  const note = str("note");

  const data = Buffer.from(await file.arrayBuffer());
  const d = await getDb();
  const id = await d.insert(
    "INSERT INTO documents (title, filename, mime, size, category, scope, partner, tags, note) VALUES (?,?,?,?,?,?,?,?,?)",
    [title, file.name.slice(0, 300), file.type || "application/octet-stream", file.size, category, scope, partner, tags, note]
  );
  await d.run("INSERT INTO document_blobs (document_id, data) VALUES (?,?)", [id, data]);

  const row = await d.get(
    "SELECT id, title, filename, mime, size, category, scope, partner, tags, note, created_at FROM documents WHERE id = ?",
    [id]
  );
  return NextResponse.json(row, { status: 201 });
});

export const DELETE = withApi(async (req: NextRequest) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  const d = await getDb();
  await d.run("DELETE FROM document_blobs WHERE document_id = ?", [id]);
  await d.run("DELETE FROM documents WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
});
