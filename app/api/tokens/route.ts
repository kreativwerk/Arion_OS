import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** API-Tokens für externe Zulieferer (Codriver & Co.).
 *  Das Token wird nur einmal bei der Erstellung angezeigt; gespeichert wird ein Hash. */

export async function GET() {
  const rows = db()
    .prepare("SELECT id, label, created_at, last_used FROM api_tokens ORDER BY id DESC")
    .all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const { label } = (await req.json()) as { label: string };
  if (!label?.trim()) return NextResponse.json({ error: "label fehlt" }, { status: 400 });
  const token = "arion_" + randomBytes(24).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const info = db().prepare("INSERT INTO api_tokens (label, token_hash) VALUES (?,?)").run(label.trim(), hash);
  return NextResponse.json({ id: info.lastInsertRowid, label: label.trim(), token }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  db().prepare("DELETE FROM api_tokens WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
