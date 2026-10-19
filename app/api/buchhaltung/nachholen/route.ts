import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { MAX_TAGE, runNachholen } from "@/lib/buch-nachholen";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/buchhaltung/nachholen?tage=30[&neustart=1] (Login über Middleware)
 * Holt Beleg-Anhänge der letzten N Tage (max. 60) aus allen Postfächern nach –
 * in Etappen; so oft aufrufen, bis `fertig` true ist.
 */
export const POST = withApi(async (req: NextRequest) => {
  const raw = req.nextUrl.searchParams.get("tage") ?? "30";
  if (!/^\d{1,2}$/.test(raw) || Number(raw) < 1 || Number(raw) > MAX_TAGE) {
    return NextResponse.json({ error: `tage muss zwischen 1 und ${MAX_TAGE} liegen.` }, { status: 400 });
  }
  const neustart = req.nextUrl.searchParams.get("neustart") === "1";
  return NextResponse.json(await runNachholen({ tage: Number(raw), neustart, deadline: Date.now() + 45_000 }));
});
