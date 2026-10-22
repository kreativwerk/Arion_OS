import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { arionKennzahlen } from "@/lib/arion-tools";
import { sttUrl, ttsConfigured } from "@/lib/arion-tts";

export const dynamic = "force-dynamic";

/** GET /api/arion/status → welche Bausteine aktiv sind + Kennzahlen für die HUD-Karten.
 *  Gibt nur Ja/Nein zurück, nie URLs oder Tokens. */
export const GET = withApi(async () => {
  const kennzahlen = await arionKennzahlen();
  return NextResponse.json({
    ki: Boolean(process.env.ANTHROPIC_API_KEY),
    tts: ttsConfigured(),
    stt: Boolean(sttUrl()),
    kennzahlen,
  });
});
