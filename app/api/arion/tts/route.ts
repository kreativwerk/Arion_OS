import { NextRequest, NextResponse } from "next/server";
import { synthesize, ttsConfigured } from "@/lib/arion-tts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/arion/tts  { text } → audio/mpeg (gestreamt vom TTS-Server)
 *
 * 501, wenn ARION_TTS_URL fehlt; 502 bei Fehler/Timeout (15 s). Der Browser
 * fällt in beiden Fällen auf speechSynthesis zurück.
 */
export async function POST(req: NextRequest) {
  if (!ttsConfigured()) {
    return NextResponse.json({ error: "Keine Server-Stimme eingerichtet (ELEVENLABS_* oder ARION_TTS_URL) – der Browser liest selbst vor." }, { status: 501 });
  }
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Text fehlt" }, { status: 400 });
  try {
    const upstream = await synthesize(text);
    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") || "audio/mpeg",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "TTS-Server antwortet nicht (Timeout)" : e.message) : String(e);
    console.error("[arion] tts:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
