import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { berichtDaten, berichtText, mailSenden } from "@/lib/tagesbericht";
import { berichtHtml } from "@/lib/tagesbericht-html";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = 86_400_000;

/**
 * Tagesbericht ansehen oder als Test senden (nur mit Login, siehe middleware.ts).
 *   GET  /api/tagesbericht          → HTML-Vorschau im Browser
 *   GET  /api/tagesbericht?format=text → Text-Fassung
 *   POST /api/tagesbericht          → Test-Mail an den Berichts-Empfänger
 * Beides ändert nichts am täglichen Versand (kein Eintrag in app_config).
 * Zeitraum für SD Worx und Briefe: die letzten 24 Stunden (?stunden=48 möglich).
 */
async function bauen(req: NextRequest) {
  const d = await getDb();
  const now = new Date();
  const stunden = Math.min(24 * 14, Math.max(1, Number(req.nextUrl.searchParams.get("stunden")) || 24));
  const seit = new Date(now.getTime() - (stunden * DAY) / 24).toISOString();
  const daten = await berichtDaten(d, now, seit);
  const b = berichtText(daten);
  return { d, daten, b };
}

export const GET = withApi(async (req: NextRequest) => {
  const { daten, b } = await bauen(req);
  if (req.nextUrl.searchParams.get("format") === "text") {
    return new NextResponse(`${b.betreff}\n\n${b.text}`, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new NextResponse(berichtHtml(daten, b.betreff), { headers: { "content-type": "text/html; charset=utf-8" } });
});

export const POST = withApi(async (req: NextRequest) => {
  const { d, daten, b } = await bauen(req);
  const betreff = `[Test] ${b.betreff}`;
  const mail = await mailSenden(d, betreff, b.text, berichtHtml(daten, betreff));
  return NextResponse.json({ ok: mail === "gesendet", mail, betreff });
});
