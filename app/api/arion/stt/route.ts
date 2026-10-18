import { NextRequest, NextResponse } from "next/server";
import { sttUrl, transcribe } from "@/lib/arion-tts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/arion/stt  multipart/form-data { file } → { text }
 *
 * Fallback für Browser ohne Web Speech API: Aufnahme per MediaRecorder,
 * Weiterleitung an ARION_STT_URL (OpenAI-kompatibel, z. B. lokales Whisper).
 */
export async function POST(req: NextRequest) {
  if (!sttUrl()) {
    return NextResponse.json(
      {
        error:
          "Spracherkennung auf dem Server ist noch nicht eingerichtet (ARION_STT_URL). " +
          "Nutze Safari oder Chrome mit eingebauter Spracherkennung – oder tippe deine Frage.",
      },
      { status: 501 }
    );
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "Keine Audiodatei erhalten" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Aufnahme zu lang (max. 8 MB)" }, { status: 413 });
  const name = file instanceof File && file.name ? file.name : "aufnahme.webm";
  try {
    return NextResponse.json({ text: await transcribe(file, name) });
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "Spracherkennung antwortet nicht (Timeout)" : e.message) : String(e);
    console.error("[arion] stt:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
