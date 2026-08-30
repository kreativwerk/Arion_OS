import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Habit für einen Tag an-/abhaken. */
export const POST = withApi(async (req: NextRequest) => {
  const { habit_id, date } = (await req.json()) as { habit_id: number; date: string };
  if (!habit_id || !date) return NextResponse.json({ error: "habit_id und date erforderlich" }, { status: 400 });
  const d = await getDb();
  const existing = await d.get("SELECT 1 AS x FROM habit_logs WHERE habit_id = ? AND date = ?", [habit_id, date]);
  if (existing) {
    await d.run("DELETE FROM habit_logs WHERE habit_id = ? AND date = ?", [habit_id, date]);
    return NextResponse.json({ checked: false });
  }
  await d.run("INSERT INTO habit_logs (habit_id, date) VALUES (?,?)", [habit_id, date]);
  return NextResponse.json({ checked: true });
});

/** Alle Logs (für die Wochenansicht). */
export const GET = withApi(async () => {
  const d = await getDb();
  const rows = await d.all("SELECT habit_id, date FROM habit_logs");
  return NextResponse.json(rows);
});
