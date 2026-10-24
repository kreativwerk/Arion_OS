import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { withLock } from "@/lib/run-lock";
import { runAbgleich } from "@/lib/beleg-abgleich";
import { MONTH_RE } from "@/lib/buch-overview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** „Abgleichen“ auf /buchhaltung: Qonto-Abbuchungen eines Monats gegen die Belege im Drive. */
export const POST = withApi(async (req: NextRequest) => {
  const b = (await req.json().catch(() => ({}))) as { monat?: string };
  if (!b.monat || !MONTH_RE.test(b.monat)) return NextResponse.json({ error: "monat (YYYY-MM) fehlt." }, { status: 400 });
  const start = Date.now();
  const d = await getDb();
  const res = await withLock(d, "abgleich", () => runAbgleich(d, b.monat!, start + 55_000));
  if (!res) return NextResponse.json({ error: "Ein Abgleich läuft bereits – bitte gleich noch einmal." }, { status: 409 });
  return NextResponse.json(res);
});
