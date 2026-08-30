import { NextRequest, NextResponse } from "next/server";
import { getDb, nowExpr } from "@/lib/db";

export const dynamic = "force-dynamic";

type TaskRow = { id: number; recurrence: string | null; due_date: string | null; done: number };

/** Aufgabe abhaken. Wiederkehrende Aufgaben werden nicht "erledigt",
 *  sondern auf den nächsten Termin weitergeschoben. */
export async function POST(req: NextRequest) {
  const { id, undo } = (await req.json()) as { id: number; undo?: boolean };
  const d = await getDb();
  const task = await d.get<TaskRow>("SELECT id, recurrence, due_date, done FROM tasks WHERE id = ?", [id]);
  if (!task) return NextResponse.json({ error: "Aufgabe nicht gefunden" }, { status: 404 });

  if (undo) {
    await d.run("UPDATE tasks SET done = 0, completed_at = NULL WHERE id = ?", [id]);
  } else if (task.recurrence) {
    const base = task.due_date ? new Date(task.due_date) : new Date();
    const next = new Date(base);
    if (task.recurrence === "daily") next.setDate(next.getDate() + 1);
    else if (task.recurrence === "weekly") next.setDate(next.getDate() + 7);
    else if (task.recurrence === "monthly") next.setMonth(next.getMonth() + 1);
    // Falls der nächste Termin immer noch in der Vergangenheit liegt, auf morgen setzen
    const today = new Date().toISOString().slice(0, 10);
    let nextIso = next.toISOString().slice(0, 10);
    if (nextIso <= today) {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      nextIso = t.toISOString().slice(0, 10);
    }
    await d.run("UPDATE tasks SET due_date = ? WHERE id = ?", [nextIso, id]);
  } else {
    await d.run(`UPDATE tasks SET done = 1, completed_at = ${nowExpr(d)} WHERE id = ?`, [id]);
  }

  const row = await d.get("SELECT * FROM tasks WHERE id = ?", [id]);
  return NextResponse.json(row);
}
