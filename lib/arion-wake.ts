/**
 * Weckruf „Hey ARION“ – reine Hilfsfunktionen (testbar, ohne Browser-API).
 *
 * Die Browser-Spracherkennung schreibt „Arion“ je nach Aussprache unterschiedlich
 * („Arion“, „Ariane“, „Orion“, „Aaron“ …). Erkannt wird das Wort allein oder mit
 * „Hey/Hallo/Okay“ davor, damit ARION nicht bei jedem Satz mit „Orion“ anspringt
 * nur am Anfang einer Äußerung oder nach dem Anrede-Wort.
 */

const NAME = "(?:arion|ariyon|arian|ariane|arien|orion|aaron|arjon|ario)";
const WAKE_RE = new RegExp(`(?:^|\\b(?:hey|hei|hallo|okay|ok|he)\\s+)${NAME}\\b`, "i");

export function isWakePhrase(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return WAKE_RE.test(t);
}

/** Begrüßungsclip nach Tageszeit (siehe CLIP_URLS). */
export function greetingClip(hour: number): string {
  if (hour < 11) return "guten-morgen";
  if (hour < 17) return "guten-tag";
  return "guten-abend";
}

/**
 * Feste Sätze in der Butler-Stimme „Alistair“ (Higgsfield, seed_audio, 21.10.2026).
 * Liegen auf dem Higgsfield-CDN; wer sie lokal haben will, legt sie als
 * public/arion/voice/<name>.mp3 ab und trägt hier den Pfad ein.
 */
const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3EApQM9b8e9WVJaVhjLHajMjyj2";
export const CLIP_URLS: Record<string, string> = {
  "zu-diensten": `${CDN}/hf_20261021_044818_1a8cff78-53a4-40c4-99a6-fdabe5a3b6ea.wav`, // „Zu Diensten, Sir.“
  "ja-sir": `${CDN}/hf_20261021_044622_df9b8623-6595-4141-96ea-06085e6f3e53.wav`, // „Ja, Sir?“
  "guten-morgen": `${CDN}/hf_20261021_044622_e9a7c92a-40e0-4ab3-ba00-0c72a7d6ba33.wav`,
  "guten-tag": `${CDN}/hf_20261021_044622_bf2e4715-cc24-44ba-ba40-a27b5c3a2853.wav`,
  "guten-abend": `${CDN}/hf_20261021_044622_771411a1-e8ca-47c2-9253-7d2a995435f1.wav`,
  "einen-moment": `${CDN}/hf_20261021_044622_0e666c74-c5a4-40e0-96f7-f0aefd5a5d58.wav`, // „Einen Moment, Sir.“
  fehler: `${CDN}/hf_20261021_044622_1d7329f5-4c31-4c11-9c95-b538b2818724.wav`, // „Verzeihung, Sir. Da ist leider etwas schiefgelaufen.“
};

export function clipUrl(name: string): string {
  return CLIP_URLS[name] ?? `/arion/voice/${name}.mp3`;
}
