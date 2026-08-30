import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb, nowExpr, todayIso } from "@/lib/db";

export const dynamic = "force-dynamic";

type TaskRow = { id: number; recurrence: string | null; due_date: string | null; done: number };

/** Aufgabe abhaken. Wiederkehrende Aufgaben werden nicht "erledigt",
 *  sondern auf den nächsten Termin weitergeschoben. */
export const POST = withApi(async (req: NextRequest) => {
  const { id, undo } = (await req.json()) as { id: number; undo?: boolean };
  const d = await getDb();
  const task = await d.get<TaskRow>("SELECT id, recurrence, due_date, done FROM tasks WHERE id = ?", [id]);
  if (!task) return NextResponse.json({ error: "Aufgabe nicht gefunden" }, { status: 404 });

  if (undo) {
    await d.run("UPDATE tasks SET done = 0, completed_at = NULL WHERE id = ?", [id]);
  } else if (task.recurrence) {
    const today = todayIso();
    const base = new Date((task.due_date ?? today) + "T12:00:00Z");
    const next = new Date(base);
    if (task.recurrence === "daily") next.setUTCDate(next.getUTCDate() + 1);
    else if (task.recurrence === "weekly") next.setUTCDate(next.getUTCDate() + 7);
    else if (task.recurrence === "monthly") {
      // Monatsende sauber behandeln: 31.01. + 1 Monat = 28./29.02., nicht 03.03.
      const day = next.getUTCDate();
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
      next.setUTCDate(Math.min(day, daysInMonth));
    }
    // Falls der nächste Termin immer noch in der Vergangenheit liegt, auf morgen setzen
    let nextIso = next.toISOString().slice(0, 10);
    if (nextIso <= today) {
      const t = new Date(today + "T12:00:00Z");
      t.setUTCDate(t.getUTCDate() + 1);
      nextIso = t.toISOString().slice(0, 10);
    }
    await d.run("UPDATE tasks SET due_date = ? WHERE id = ?", [nextIso, id]);
  } else {
    await d.run(`UPDATE tasks SET done = 1, completed_at = ${nowExpr(d)} WHERE id = ?`, [id]);
  }

  const row = await d.get("SELECT * FROM tasks WHERE id = ?", [id]);
  return NextResponse.json(row);
});
