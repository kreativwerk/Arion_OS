import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { answer } from "@/lib/assistant/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const d = await getDb();
  const rows = await d.all("SELECT * FROM assistant_messages ORDER BY id ASC");
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const { message } = (await req.json()) as { message: string };
  if (!message?.trim()) return NextResponse.json({ error: "Nachricht fehlt" }, { status: 400 });
  const reply = await answer(message.trim());
  return NextResponse.json({ reply });
}

export async function DELETE() {
  const d = await getDb();
  await d.run("DELETE FROM assistant_messages");
  return NextResponse.json({ ok: true });
}
