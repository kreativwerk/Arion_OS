import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { answer } from "@/lib/assistant/engine";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const d = await getDb();
  const rows = await d.all("SELECT * FROM assistant_messages ORDER BY id ASC");
  return NextResponse.json(rows);
});

export const POST = withApi(async (req: NextRequest) => {
  const { message } = (await req.json()) as { message: string };
  if (!message?.trim()) return NextResponse.json({ error: "Nachricht fehlt" }, { status: 400 });
  const reply = await answer(message.trim());
  return NextResponse.json({ reply });
});

export const DELETE = withApi(async () => {
  const d = await getDb();
  await d.run("DELETE FROM assistant_messages");
  return NextResponse.json({ ok: true });
});
