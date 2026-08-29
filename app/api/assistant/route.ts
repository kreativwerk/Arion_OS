import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { answer } from "@/lib/assistant/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = db().prepare("SELECT * FROM assistant_messages ORDER BY id ASC").all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const { message } = (await req.json()) as { message: string };
  if (!message?.trim()) return NextResponse.json({ error: "Nachricht fehlt" }, { status: 400 });
  const reply = await answer(message.trim());
  return NextResponse.json({ reply });
}

export async function DELETE() {
  db().prepare("DELETE FROM assistant_messages").run();
  return NextResponse.json({ ok: true });
}
