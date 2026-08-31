import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb, getConfig, todayIso } from "@/lib/db";

export const dynamic = "force-dynamic";

const STEP_DEFAULT = 250;

async function today() {
  const d = await getDb();
  const cfg = await getConfig();
  const goal = Number(cfg.water_goal_ml) || 2500;
  const row = await d.get<{ ml: number }>("SELECT ml FROM water_log WHERE date = ?", [todayIso()]);
  return { ml: Number(row?.ml ?? 0), goal, step: STEP_DEFAULT };
}

/** Heutiger Wasserstand. */
export const GET = withApi(async () => {
  return NextResponse.json(await today());
});

/** +/− Milliliter für heute (Standard-Schritt 250 ml, nie unter 0). */
export const POST = withApi(async (req: NextRequest) => {
  const { delta } = (await req.json().catch(() => ({}))) as { delta?: number };
  const change = Number.isFinite(delta) ? Number(delta) : STEP_DEFAULT;
  const d = await getDb();
  const date = todayIso();
  const row = await d.get<{ ml: number }>("SELECT ml FROM water_log WHERE date = ?", [date]);
  const ml = Math.max(0, Number(row?.ml ?? 0) + change);
  if (row) {
    await d.run("UPDATE water_log SET ml = ? WHERE date = ?", [ml, date]);
  } else {
    await d.run("INSERT INTO water_log (date, ml) VALUES (?,?)", [date, ml]);
  }
  return NextResponse.json(await today());
});
