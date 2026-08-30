import { NextResponse } from "next/server";
import { getDb, getConfig } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Aggregierte Daten für die "Heute"-Ansicht. */
export async function GET() {
  const d = await getDb();
  const today = new Date().toISOString().slice(0, 10);

  const contractsDueQuery =
    d.dialect === "sqlite"
      ? `SELECT *, CAST(julianday(end_date) - julianday('now') - cancel_period_days AS INTEGER) AS days_to_cancel
         FROM contracts
         WHERE end_date IS NOT NULL
           AND julianday(end_date) - julianday('now') - cancel_period_days BETWEEN -365 AND 60
         ORDER BY days_to_cancel ASC LIMIT 5`
      : `SELECT *, (end_date::date - current_date - cancel_period_days) AS days_to_cancel
         FROM contracts
         WHERE end_date IS NOT NULL
           AND (end_date::date - current_date - cancel_period_days) BETWEEN -365 AND 60
         ORDER BY days_to_cancel ASC LIMIT 5`;

  const [
    config,
    tasksToday,
    inboxRow,
    habits,
    habitLogsToday,
    events,
    mails,
    letters,
    watcherEvents,
    slack,
    contractsDue,
  ] = await Promise.all([
    getConfig(),
    d.all(
      "SELECT * FROM tasks WHERE done = 0 AND accepted = 1 AND due_date IS NOT NULL AND due_date <= ? ORDER BY priority ASC, due_date ASC",
      [today]
    ),
    d.get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE done = 0 AND accepted = 0"),
    d.all("SELECT * FROM habits ORDER BY id ASC"),
    d.all("SELECT habit_id FROM habit_logs WHERE date = ?", [today]),
    d.all("SELECT * FROM calendar_events WHERE date >= ? ORDER BY date ASC, start_time ASC LIMIT 5", [today]),
    d.all("SELECT * FROM mail_digest WHERE read = 0 AND important = 1 ORDER BY received_at DESC LIMIT 5"),
    d.all("SELECT * FROM letters WHERE status IN ('neu','aktion') ORDER BY received_date DESC LIMIT 5"),
    d.all(
      "SELECT we.*, w.name AS watcher_name FROM watcher_events we JOIN watchers w ON w.id = we.watcher_id WHERE we.seen = 0 ORDER BY we.created_at DESC LIMIT 5"
    ),
    d.all("SELECT * FROM slack_notifications WHERE read = 0 AND important = 1 ORDER BY created_at DESC LIMIT 5"),
    d.all(contractsDueQuery),
  ]);

  return NextResponse.json({
    today,
    config,
    inboxCount: Number(inboxRow?.n ?? 0),
    tasksToday,
    habits,
    habitLogsToday,
    events,
    mails,
    letters,
    watcherEvents,
    slack,
    contractsDue,
  });
}
