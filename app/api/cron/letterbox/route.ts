import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { runLetterbox } from "@/lib/letterbox";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Briefkasten-Abruf aus dem Drive-Ordner „Letterbox“ (lib/letterbox.ts).
 * Aufruf alle 5 Minuten über Supabase pg_cron (net.http_post) mit
 * `Authorization: Bearer ${CRON_SECRET}` – läuft ohne Büro-Mac.
 */
export const GET = withApi(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ungültiges oder fehlendes Cron-Secret." }, { status: 401 });
  }
  return NextResponse.json(await runLetterbox(Date.now() + 270_000));
});

export const POST = GET;
