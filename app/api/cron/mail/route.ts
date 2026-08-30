import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { runMailFetch } from "@/lib/mail-fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Täglicher Mail-Abruf über Vercel Cron (siehe vercel.json).
 * Vercel schickt automatisch `Authorization: Bearer ${CRON_SECRET}`,
 * wenn die Umgebungsvariable CRON_SECRET gesetzt ist.
 */
export const GET = withApi(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET fehlt – bitte als Umgebungsvariable setzen, sonst bleibt der Cron-Endpunkt gesperrt." },
      { status: 401 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ungültiges Cron-Secret." }, { status: 401 });
  }
  return NextResponse.json(await runMailFetch());
});
