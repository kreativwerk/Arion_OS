import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { runCodriverSync } from "@/lib/codriver-sync";
import { withLock } from "@/lib/run-lock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET/POST /api/cron/codriver – Codriver-Daten (nur Arion) nach Arion OS spiegeln.
 * Aufruf per Supabase pg_cron alle 15 Minuten, geschützt mit CRON_SECRET.
 */
export const GET = withApi(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET fehlt." }, { status: 401 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ungültiges Cron-Secret." }, { status: 401 });
  }
  const d = await getDb();
  const r = await withLock(d, "codriver", () => runCodriverSync({ deadline: Date.now() + 50_000 }));
  return NextResponse.json(r ?? { skipped: "läuft bereits" });
});

export const POST = GET;
