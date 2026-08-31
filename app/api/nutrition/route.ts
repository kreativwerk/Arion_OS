import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb, getConfig, todayIso, type DB } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Ernährungs-Tracker (Dashboard): Wasser, Proteine, Vitamin – je ein Zähler
 * pro Tag. Erreicht ein Wert sein Tagesziel, wird automatisch die passende
 * Gewohnheit für heute abgehakt (und beim Zurücknehmen wieder entfernt).
 */

const KINDS = {
  water: {
    goalKey: "water_goal_ml",
    goalDefault: 2500,
    step: 250,
    habitMatch: ["wasser"],
    habitName: "Wasser trinken",
    habitIcon: "water_drop",
  },
  protein: {
    goalKey: "protein_goal_g",
    goalDefault: 140,
    step: 35,
    habitMatch: ["protein", "eiweiß"],
    habitName: "Proteine",
    habitIcon: "egg_alt",
  },
  vitamin: {
    goalKey: "vitamin_goal",
    goalDefault: 1,
    step: 1,
    habitMatch: ["vitamin"],
    habitName: "Vitamine",
    habitIcon: "medication",
  },
} as const;

type Kind = keyof typeof KINDS;

async function snapshot() {
  const d = await getDb();
  const cfg = await getConfig();
  const date = todayIso();
  const rows = await d.all<{ kind: string; amount: number }>(
    "SELECT kind, amount FROM nutrition_log WHERE date = ?",
    [date]
  );
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, Number(r.amount)]));
  const out: Record<string, { amount: number; goal: number; step: number }> = {};
  for (const [kind, def] of Object.entries(KINDS)) {
    out[kind] = {
      amount: byKind[kind] ?? 0,
      goal: Number(cfg[def.goalKey]) || def.goalDefault,
      step: def.step,
    };
  }
  return out;
}

/** Passende Gewohnheit finden (Namens-Match) oder anlegen. */
async function ensureHabit(d: DB, kind: Kind): Promise<number> {
  const def = KINDS[kind];
  const where = def.habitMatch.map(() => "LOWER(name) LIKE ?").join(" OR ");
  const row = await d.get<{ id: number }>(
    `SELECT id FROM habits WHERE ${where} ORDER BY id ASC LIMIT 1`,
    def.habitMatch.map((m) => `%${m}%`)
  );
  if (row) return Number(row.id);
  return d.insert("INSERT INTO habits (name, emoji) VALUES (?,?)", [def.habitName, def.habitIcon]);
}

/** Habit-Log für heute setzen/entfernen, wenn das Ziel über-/unterschritten wird. */
async function syncHabit(d: DB, kind: Kind, before: number, after: number, goal: number) {
  const wasDone = before >= goal;
  const isDone = after >= goal;
  if (wasDone === isDone) return;
  const habitId = await ensureHabit(d, kind);
  const date = todayIso();
  if (isDone) {
    await d.run("INSERT INTO habit_logs (habit_id, date) VALUES (?,?) ON CONFLICT DO NOTHING", [habitId, date]);
  } else {
    await d.run("DELETE FROM habit_logs WHERE habit_id = ? AND date = ?", [habitId, date]);
  }
}

export const GET = withApi(async () => {
  return NextResponse.json(await snapshot());
});

export const POST = withApi(async (req: NextRequest) => {
  const { kind, delta } = (await req.json().catch(() => ({}))) as { kind?: string; delta?: number };
  if (!kind || !(kind in KINDS)) {
    return NextResponse.json({ error: "kind muss water, protein oder vitamin sein." }, { status: 400 });
  }
  const k = kind as Kind;
  const def = KINDS[k];
  const cfg = await getConfig();
  const goal = Number(cfg[def.goalKey]) || def.goalDefault;
  const change = Number.isFinite(delta) ? Number(delta) : def.step;

  const d = await getDb();
  const date = todayIso();
  const row = await d.get<{ amount: number }>(
    "SELECT amount FROM nutrition_log WHERE date = ? AND kind = ?",
    [date, k]
  );
  const before = Number(row?.amount ?? 0);
  // Vitamin ist binär (0/1), die anderen offen nach oben
  const after = k === "vitamin" ? Math.min(goal, Math.max(0, before + change)) : Math.max(0, before + change);

  if (row) {
    await d.run("UPDATE nutrition_log SET amount = ? WHERE date = ? AND kind = ?", [after, date, k]);
  } else {
    await d.run("INSERT INTO nutrition_log (date, kind, amount) VALUES (?,?,?)", [date, k, after]);
  }
  await syncHabit(d, k, before, after, goal);

  return NextResponse.json(await snapshot());
});
