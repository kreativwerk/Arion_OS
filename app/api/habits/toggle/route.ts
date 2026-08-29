import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Habit für einen Tag an-/abhaken. */
export async function POST(req: NextRequest) {
  const { habit_id, date } = (await req.json()) as { habit_id: number; date: string };
  if (!habit_id || !date) return NextResponse.json({ error: "habit_id und date erforderlich" }, { status: 400 });
  const d = db();
  const existing = d.prepare("SELECT 1 FROM habit_logs WHERE habit_id = ? AND date = ?").get(habit_id, date);
  if (existing) {
    d.prepare("DELETE FROM habit_logs WHERE habit_id = ? AND date = ?").run(habit_id, date);
    return NextResponse.json({ checked: false });
  }
  d.prepare("INSERT INTO habit_logs (habit_id, date) VALUES (?,?)").run(habit_id, date);
  return NextResponse.json({ checked: true });
}

/** Alle Logs (für die Wochenansicht). */
export async function GET() {
  const rows = db().prepare("SELECT habit_id, date FROM habit_logs").all();
  return NextResponse.json(rows);
}
