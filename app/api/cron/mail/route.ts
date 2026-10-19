import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { runMailFetch } from "@/lib/mail-fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mail-Abruf + Postfach-Archiv. Täglich über Vercel Cron (vercel.json) und –
 * für ein aktuelles Postfach – alle 10 Minuten über Supabase pg_cron
 * (siehe docs/INTEGRATIONEN.md, Abschnitt Postfach).
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
  // maxDuration 60 s: 50 s Budget, Rest als Puffer für den Abschluss
  return NextResponse.json(await runMailFetch({ push: true, deadline: Date.now() + 50_000 }));
});

/** pg_cron (net.http_post) ruft per POST auf – gleiche Logik. */
export const POST = GET;
