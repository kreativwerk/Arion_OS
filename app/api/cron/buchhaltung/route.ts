import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { runBelegeEinsortieren, runBuchhaltung } from "@/lib/buch-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Buchhaltungs-Lauf (Mail-Abruf inkl. Belege + Drive-Ablage).
 * Auslöser: Vercel Cron (täglich, siehe vercel.json) oder häufiger über
 * Supabase pg_cron + pg_net (siehe docs/BUCHHALTUNG.md).
 * `?modus=belege`: nur neue Eingänge automatisch einsortieren + ablegen.
 * Geschützt mit `Authorization: Bearer ${CRON_SECRET}` wie /api/cron/mail.
 */
async function handler(req: NextRequest) {
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
  if (req.nextUrl.searchParams.get("modus") === "belege") return NextResponse.json(await runBelegeEinsortieren());
  return NextResponse.json(await runBuchhaltung({ push: true }));
}

export const GET = withApi(handler);
export const POST = withApi(handler);
