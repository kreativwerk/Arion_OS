/**
 * ARION – Sprachausgabe (TTS) und Spracherkennung (STT), serverseitiger Teil.
 *
 * Reihenfolge der TTS-Provider:
 *  (0) ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID gesetzt → ElevenLabs
 *      (eleven_multilingual_v2, Deutsch, gestreamt). Optional ELEVENLABS_MODEL.
 *  (a) ARION_TTS_URL gesetzt → OpenAI-kompatibler Endpunkt /v1/audio/speech
 *      (geplant: lokaler VoiceStudio-Server auf dem Mac, per Tunnel erreichbar).
 *      Die App proxyt über POST /api/arion/tts – der Browser sieht weder URL
 *      noch Tunnel-Token.
 *  (b) Fallback im Browser: speechSynthesis mit deutscher Stimme
 *      (siehe components/arion/useArionVoice.ts). Fällt (a) aus, wird die
 *      Antwort trotzdem angezeigt und vorgelesen.
 *
 * STT analog: ARION_STT_URL → OpenAI-kompatibles /v1/audio/transcriptions
 * (z. B. lokales Whisper). Primär erkennt aber der Browser selbst (Web Speech API).
 *
 * Optional ARION_TUNNEL_TOKEN: wird als `X-Arion-Token` und als Bearer-Token
 * an den Tunnel geschickt – der Mac-Server muss ihn prüfen.
 */

export const TTS_TIMEOUT_MS = 15_000;
export const STT_TIMEOUT_MS = 30_000;
export const TTS_MAX_CHARS = 1500;

/** Basis-URL oder vollständige URL zu einem OpenAI-kompatiblen Pfad auflösen. */
export function resolveOpenAiUrl(raw: string | undefined, path: "audio/speech" | "audio/transcriptions"): string | null {
  const base = (raw || "").trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base)) return null;
  if (base.endsWith("/" + path)) return base;
  if (/\/v1$/.test(base)) return `${base}/${path}`;
  return `${base}/v1/${path}`;
}

export function elevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim() && process.env.ELEVENLABS_VOICE_ID?.trim());
}

/** Irgendeine Server-Stimme eingerichtet? Sonst liest der Browser selbst vor. */
export function ttsConfigured(): boolean {
  return elevenLabsConfigured() || Boolean(ttsUrl());
}

/** ElevenLabs-Endpunkt (Streaming, MP3). Stimme nur aus [A-Za-z0-9] – kein Pfad-Missbrauch. */
export function elevenLabsUrl(voiceId: string): string | null {
  if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) return null;
  return `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`;
}

export function ttsUrl(): string | null {
  return resolveOpenAiUrl(process.env.ARION_TTS_URL, "audio/speech");
}

export function sttUrl(): string | null {
  return resolveOpenAiUrl(process.env.ARION_STT_URL, "audio/transcriptions");
}

/** Header für den Tunnel zum Mac – Token nie an den Browser geben. */
export function tunnelHeaders(): Record<string, string> {
  const token = process.env.ARION_TUNNEL_TOKEN?.trim();
  return token ? { "X-Arion-Token": token, Authorization: `Bearer ${token}` } : {};
}

/** Text für die Stimme vorbereiten (Länge begrenzen, Steuerzeichen raus). */
export function ttsInput(text: string): string {
  // Steuerzeichen (außer Zeilenumbruch/Tab) entfernen
  const clean = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= TTS_MAX_CHARS) return clean;
  const cut = clean.slice(0, TTS_MAX_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 200 ? cut.slice(0, end + 1) : cut;
}

/**
 * Ruft den TTS-Server auf und liefert die Upstream-Response (MP3-Stream).
 * Wirft bei Fehlern – die Route antwortet dann mit 502 und der Browser
 * fällt auf speechSynthesis zurück.
 */
export async function synthesize(text: string): Promise<Response> {
  if (elevenLabsConfigured()) return synthesizeElevenLabs(text);
  const url = ttsUrl();
  if (!url) throw new Error("ARION_TTS_URL ist nicht gesetzt");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...tunnelHeaders() },
    body: JSON.stringify({
      model: process.env.ARION_TTS_MODEL || "tts-1",
      input: ttsInput(text),
      voice: process.env.ARION_TTS_VOICE || "alloy",
      response_format: "mp3",
      // VoiceStudio-Erweiterung: Sprache vorgeben statt erraten lassen (OpenAI ignoriert das Feld)
      language: "de",
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`TTS-Server antwortet mit ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return res;
}

/** Audio an den Whisper-kompatiblen Server schicken, liefert den Text. */
export async function transcribe(file: Blob, filename: string): Promise<string> {
  const url = sttUrl();
  if (!url) throw new Error("ARION_STT_URL ist nicht gesetzt");
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", process.env.ARION_STT_MODEL || "whisper-1");
  form.append("language", "de");
  form.append("response_format", "json");
  const res = await fetch(url, {
    method: "POST",
    headers: tunnelHeaders(),
    body: form,
    signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`STT-Server antwortet mit ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const data = (await res.json()) as { text?: string };
    return String(data.text ?? "").trim();
  }
  return (await res.text()).trim();
}

/** ElevenLabs: deutsche Butler-Stimme (Stimme per ELEVENLABS_VOICE_ID). */
async function synthesizeElevenLabs(text: string): Promise<Response> {
  const url = elevenLabsUrl(process.env.ELEVENLABS_VOICE_ID!.trim());
  if (!url) throw new Error("ELEVENLABS_VOICE_ID ist ungültig");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "audio/mpeg",
      "xi-api-key": process.env.ELEVENLABS_API_KEY!.trim(),
    },
    body: JSON.stringify({
      text: ttsInput(text),
      model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs antwortet mit ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return res;
}
