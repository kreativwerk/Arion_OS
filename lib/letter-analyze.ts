import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "@/lib/db";

/**
 * Briefpost-Analyse: Claude liest den Scan (PDF oder Foto) und liefert
 * Absender, Betreff, Kurzbeschreibung des Anliegens, nötige Aktion, Frist,
 * Aktenzeichen und den Volltext. Der Volltext bleibt gespeichert, damit Briefe
 * später mit Firmendaten automatisch beantwortet/ausgefüllt werden können.
 *
 * Ohne ANTHROPIC_API_KEY liefert die Analyse null – der Brief wird trotzdem
 * abgelegt und kann von Hand ergänzt werden.
 */

export const LETTER_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type LetterMime = (typeof LETTER_MIME_TYPES)[number];

export const LETTER_CATEGORIES = [
  "Rechnung",
  "Mahnung",
  "Behörde",
  "Steuer",
  "Versicherung",
  "Bank",
  "Vertrag",
  "Bußgeld",
  "Werbung",
  "Sonstiges",
] as const;

export type LetterAnalysis = {
  sender: string;
  subject: string;
  summary: string;
  action: string;
  category: string;
  due_date: string;
  reference: string;
  letter_date: string;
  text: string;
};

const DEFAULT_MODEL = "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sender", "subject", "summary", "action", "category", "due_date", "reference", "letter_date", "text"],
  properties: {
    sender: { type: "string", description: "Absender (Firma/Behörde, ggf. Person) – kurz, ohne Adresse" },
    subject: { type: "string", description: "Betreff, max. 80 Zeichen" },
    summary: { type: "string", description: "Anliegen in 1–2 Sätzen: Was will der Absender?" },
    action: { type: "string", description: "Was ist zu tun? Leer, wenn nichts zu tun ist" },
    category: { type: "string", enum: [...LETTER_CATEGORIES] },
    due_date: { type: "string", description: "Frist/Fälligkeit als YYYY-MM-DD, sonst leer" },
    reference: { type: "string", description: "Aktenzeichen, Rechnungs-, Kunden- oder Vertragsnummer; mehrere mit ' · ' trennen; sonst leer" },
    letter_date: { type: "string", description: "Datum des Schreibens als YYYY-MM-DD, sonst leer" },
    text: { type: "string", description: "Vollständiger Text des Briefs (Transkription)" },
  },
};

export function isLetterMime(mime: string): mime is LetterMime {
  return (LETTER_MIME_TYPES as readonly string[]).includes(mime);
}

export function letterAnalysisEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const SPLIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["letters"],
  properties: {
    letters: {
      type: "array",
      description: "Ein Eintrag pro Brief, in Seitenreihenfolge",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["first_page", "sender"],
        properties: {
          first_page: { type: "integer", description: "Erste Seite des Briefs (1-basiert)" },
          sender: { type: "string", description: "Absender, kurz" },
        },
      },
    },
  },
};

function fileBlock(data: Buffer, mime: LetterMime): Anthropic.Beta.BetaContentBlockParam {
  const b64 = data.toString("base64");
  return mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mime, data: b64 } }
    : { type: "image", source: { type: "base64", media_type: mime, data: b64 } };
}

function modelParams() {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  return {
    model,
    // Lehnt das Modell ab, springt serverseitig ein passendes Ersatzmodell ein.
    ...(model === DEFAULT_MODEL ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
}

/**
 * Stapelscan in einzelne Briefe zerlegen: Liefert die Seitenbereiche
 * (1-basiert, inklusive) – lückenlos von Seite 1 bis `pageCount`. Ohne
 * API-Key oder bei nur einer Seite ist alles ein Brief.
 */
export async function splitLetterPages(data: Buffer, pageCount: number): Promise<[number, number][]> {
  if (pageCount <= 1 || !letterAnalysisEnabled()) return [[1, pageCount]];

  const response = await new Anthropic().beta.messages.create({
    ...modelParams(),
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SPLIT_SCHEMA } },
    system:
      "Du bekommst einen Stapel eingescannter Geschäftspost als eine PDF. Bestimme, wo jeder einzelne Brief beginnt. " +
      "Ein neuer Brief beginnt typischerweise mit Briefkopf, Anschriftenfeld und Datum. Folgeseiten, Rückseiten, " +
      "Anlagen, Formulare und beigelegte Urkunden gehören zum Brief davor.",
    messages: [
      {
        role: "user",
        content: [fileBlock(data, "application/pdf"), { type: "text", text: `Die PDF hat ${pageCount} Seiten. Welche Briefe enthält sie?` }],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Aufteilung vom Modell abgelehnt");
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = JSON.parse(text) as { letters: { first_page: number }[] };

  // Nur die Anfangsseiten zählen – daraus lückenlose Bereiche bauen, damit
  // keine Seite verloren geht, selbst wenn das Modell sich verzählt.
  const starts = [...new Set(parsed.letters.map((l) => Math.trunc(l.first_page)))]
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b);
  if (starts[0] !== 1) starts.unshift(1);
  return starts.map((start, i) => [start, (starts[i + 1] ?? pageCount + 1) - 1]);
}

export async function analyzeLetter(data: Buffer, mime: LetterMime): Promise<LetterAnalysis | null> {
  if (!letterAnalysisEnabled()) return null;

  const cfg = await getConfig();
  const recipient = [cfg.user_name, cfg.company].filter(Boolean).join(", ");
  const response = await new Anthropic().beta.messages.create({
    ...modelParams(),
    max_tokens: 16000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system:
      "Du sortierst eingescannte Geschäftspost. Lies den Brief vollständig und fülle die Felder auf Deutsch aus. " +
      "Erfinde nichts: Was nicht im Brief steht, bleibt leer." +
      (recipient ? ` Empfänger der Post ist ${recipient} – das ist NICHT der Absender.` : ""),
    messages: [{ role: "user", content: [fileBlock(data, mime), { type: "text", text: "Analysiere diesen Brief." }] }],
  });

  if (response.stop_reason === "refusal") throw new Error("Analyse vom Modell abgelehnt");
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = JSON.parse(text) as LetterAnalysis;
  return {
    ...parsed,
    due_date: ISO_DATE.test(parsed.due_date) ? parsed.due_date : "",
    letter_date: ISO_DATE.test(parsed.letter_date) ? parsed.letter_date : "",
  };
}
