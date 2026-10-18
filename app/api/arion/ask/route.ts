import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { ask, type ArionMode } from "@/lib/arion-brain";
import { toSpokenText } from "@/lib/arion-speech";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/arion/ask  { text, mode: 'voice' | 'text', conversationId? }
 *   → { answer, spokenAnswer, actions, conversationId, source }
 *
 * Geschützt über die App-Session (middleware.ts). Antwortet auch ohne
 * ANTHROPIC_API_KEY – dann mit einem lokalen Überblick aus den Daten.
 */
export const POST = withApi(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as { text?: unknown; mode?: unknown; conversationId?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    const answer = "Ich habe nichts verstanden. Halte den Knopf gedrückt und sprich deine Frage.";
    return NextResponse.json({ error: "Text fehlt", answer, spokenAnswer: toSpokenText(answer), actions: [] }, { status: 400 });
  }
  const mode: ArionMode = body?.mode === "text" ? "text" : "voice";
  try {
    return NextResponse.json(await ask({ text, mode, conversationId: body?.conversationId }));
  } catch (e) {
    // Letzte Verteidigungslinie (z. B. Datenbank weg): freundlich antworten
    console.error("[arion] ask:", e instanceof Error ? e.message : e);
    const answer = "Entschuldige, ich komme gerade nicht an deine Daten. Versuch es gleich noch einmal.";
    return NextResponse.json(
      { answer, spokenAnswer: answer, actions: [], conversationId: body?.conversationId ?? null, source: "lokal", error: e instanceof Error ? e.message : String(e) },
      { status: 503 }
    );
  }
});
