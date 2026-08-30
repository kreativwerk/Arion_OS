import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { createHash, randomBytes } from "crypto";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** API-Tokens für externe Zulieferer (Codriver & Co.).
 *  Das Token wird nur einmal bei der Erstellung angezeigt; gespeichert wird ein Hash. */

export const GET = withApi(async () => {
  const d = await getDb();
  const rows = await d.all("SELECT id, label, created_at, last_used FROM api_tokens ORDER BY id DESC");
  return NextResponse.json(rows);
});

export const POST = withApi(async (req: NextRequest) => {
  const { label } = (await req.json()) as { label: string };
  if (!label?.trim()) return NextResponse.json({ error: "label fehlt" }, { status: 400 });
  const d = await getDb();
  const token = "arion_" + randomBytes(24).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const id = await d.insert("INSERT INTO api_tokens (label, token_hash) VALUES (?,?)", [label.trim(), hash]);
  return NextResponse.json({ id, label: label.trim(), token }, { status: 201 });
});

export const DELETE = withApi(async (req: NextRequest) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  const d = await getDb();
  await d.run("DELETE FROM api_tokens WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
});
