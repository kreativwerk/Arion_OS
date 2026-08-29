import { NextResponse } from "next/server";
import { db, getConfig } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Aggregierte Daten für die "Heute"-Ansicht. */
export async function GET() {
  const d = db();
  const today = new Date().toISOString().slice(0, 10);

  const tasksToday = d
    .prepare(
      "SELECT * FROM tasks WHERE done = 0 AND accepted = 1 AND due_date IS NOT NULL AND due_date <= ? ORDER BY priority ASC, due_date ASC"
    )
    .all(today);
  const inboxCount = (
    d.prepare("SELECT COUNT(*) AS n FROM tasks WHERE done = 0 AND accepted = 0").get() as { n: number }
  ).n;
  const habits = d.prepare("SELECT * FROM habits").all();
  const habitLogsToday = d.prepare("SELECT habit_id FROM habit_logs WHERE date = ?").all(today);
  const events = d
    .prepare("SELECT * FROM calendar_events WHERE date >= ? ORDER BY date ASC, start_time ASC LIMIT 5")
    .all(today);
  const mails = d
    .prepare("SELECT * FROM mail_digest WHERE read = 0 AND important = 1 ORDER BY received_at DESC LIMIT 5")
    .all();
  const letters = d
    .prepare("SELECT * FROM letters WHERE status IN ('neu','aktion') ORDER BY received_date DESC LIMIT 5")
    .all();
  const watcherEvents = d
    .prepare(
      "SELECT we.*, w.name AS watcher_name FROM watcher_events we JOIN watchers w ON w.id = we.watcher_id WHERE we.seen = 0 ORDER BY we.created_at DESC LIMIT 5"
    )
    .all();
  const slack = d
    .prepare("SELECT * FROM slack_notifications WHERE read = 0 AND important = 1 ORDER BY created_at DESC LIMIT 5")
    .all();
  const contractsDue = d
    .prepare(
      `SELECT *, CAST(julianday(end_date) - julianday('now') - cancel_period_days AS INTEGER) AS days_to_cancel
       FROM contracts
       WHERE end_date IS NOT NULL
         AND julianday(end_date) - julianday('now') - cancel_period_days BETWEEN -365 AND 60
       ORDER BY days_to_cancel ASC LIMIT 5`
    )
    .all();

  return NextResponse.json({
    today,
    config: getConfig(),
    inboxCount,
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
