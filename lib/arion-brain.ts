import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { getDb, getConfig, todayIso, type DB } from "@/lib/db";
import {
  ARION_TOOLS,
  runTool,
  buchhaltungDaten,
  wichtigeMails,
  offeneAufgaben,
  aufgabeAnlegen,
  type ArionAction,
} from "@/lib/arion-tools";
import { formatDateDe, formatEuro, limitSentences, senderName, spokenMonth, taskTitleFromSpeech, toSpokenText } from "@/lib/arion-speech";

/**
 * ARION – das „Gehirn“ des Sprachassistenten.
 *
 * - Mit ANTHROPIC_API_KEY: Claude mit Tool Use. Das Modell holt sich gezielt
 *   Live-Daten (Buchhaltung, Mails, Aufgaben, übrige Module) und kann Aufgaben
 *   anlegen – statt dass wir alles in den Prompt stopfen.
 * - Ohne Schlüssel oder bei API-Fehlern: lokaler Fallback mit einfacher
 *   Intent-Erkennung auf denselben Datenfunktionen. Nie ein Absturz.
 *
 * Gesprächsverlauf: Tabelle assistant_messages, getrennt per conversation_id
 * (der Chat „Arion Bot“ nutzt die leere ID).
 */

export type ArionMode = "voice" | "text";

export type ArionReply = {
  answer: string;
  spokenAnswer: string;
  actions: ArionAction[];
  conversationId: string;
  source: "claude" | "lokal";
};

const CONV_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_ROUNDS = 5;
const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export function normalizeConversationId(raw: unknown): string {
  return typeof raw === "string" && CONV_RE.test(raw) ? raw : `arion-${randomUUID()}`;
}

/** Verlauf für die Messages-API: beginnt mit user, Rollen wechseln sich ab. */
export function normalizeHistory(rows: { role: string; content: string }[]): Anthropic.Messages.MessageParam[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows) {
    const role = r.role === "assistant" ? "assistant" : "user";
    const content = String(r.content ?? "").trim();
    if (!content) continue;
    if (!out.length && role === "assistant") continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n" + content;
    else out.push({ role, content });
  }
  // Muss mit assistant enden, damit die neue Frage als user folgen kann
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
}

/* ── Lokaler Fallback ────────────────────────────────────── */

const TASK_INTENT =
  /^(?:bitte\s+)?(?:neue aufgabe|aufgabe anlegen|leg(?:e)?\s+(?:eine\s+)?aufgabe an|notier(?:e)?(?: dir)?|erinner(?:e|ung)?(?: mich)?(?: daran)?)[\s:,]+(.{3,})$/i;

function plural(n: number, one: string, many: string) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

async function buchSaetze(d: DB, today: string, kurz = false): Promise<string> {
  const b = await buchhaltungDaten(d);
  const s: string[] = [];
  const monat = spokenMonth(b.monat, today);
  s.push(
    b.fehlt_anzahl === 0
      ? `Im ${monat} fehlen keine Belege.`
      : `Im ${monat} ${b.fehlt_anzahl === 1 ? "fehlt" : "fehlen"} ${plural(b.fehlt_anzahl, "Beleg", "Belege")} über ${formatEuro(b.fehlt_summe)}.`
  );
  if (!kurz && b.eingang_neu > 0) s.push(`Im Eingang ${b.eingang_neu === 1 ? "liegt" : "liegen"} ${plural(b.eingang_neu, "neuer Beleg", "neue Belege")}.`);
  if (b.naechste_frist?.faellig) {
    s.push(
      `Nächste Frist: ${b.naechste_frist.titel} am ${formatDateDe(b.naechste_frist.faellig)}${
        !kurz && b.naechste_frist.betrag ? ` über ${formatEuro(b.naechste_frist.betrag)}` : ""
      }.`
    );
  }
  if (b.qonto_saldo !== null) {
    s.push(`Der Qonto-Saldo liegt bei ${formatEuro(b.qonto_saldo)}${!kurz && b.qonto_stand ? `, Stand ${formatDateDe(String(b.qonto_stand))}` : ""}.`);
  }
  return s.join(" ");
}

async function mailSaetze(d: DB, kurz = false): Promise<string> {
  const m = await wichtigeMails(d, { limit: 3 });
  if (m.ungelesen_wichtig === 0) return "Keine neuen wichtigen Mails.";
  const head = `Du hast ${plural(m.ungelesen_wichtig, "neue wichtige Mail", "neue wichtige Mails")}`;
  if (kurz) return `${head}.`;
  const top = m.mails
    .slice(0, 3)
    .map((x) => `${senderName(String(x.von ?? ""))} zu „${String(x.betreff ?? "").trim()}“`)
    .join(", ");
  return `${head}: ${top}.`;
}

async function aufgabenSaetze(d: DB, kurz = false): Promise<string> {
  const t = await offeneAufgaben(d, { nur_faellig: true, limit: 3 });
  if (t.faellig_heute + t.ueberfaellig === 0) {
    return `Heute ist nichts fällig, insgesamt ${t.offen_gesamt === 1 ? "ist 1 Aufgabe" : `sind ${t.offen_gesamt} Aufgaben`} offen.`;
  }
  const head = `Heute ${t.faellig_heute === 1 ? "ist 1 Aufgabe" : `sind ${t.faellig_heute} Aufgaben`} fällig${
    t.ueberfaellig ? `, ${t.ueberfaellig} überfällig` : ""
  }`;
  if (kurz) return `${head}.`;
  return `${head}, zuerst: ${t.aufgaben.map((a) => a.titel).join(", ")}.`;
}

export async function localAnswer(
  text: string,
  opts: { reason?: string; allowCreate?: boolean; mode?: ArionMode } = {}
): Promise<{ answer: string; actions: ArionAction[]; hint: boolean }> {
  const d = await getDb();
  const today = todayIso();
  const q = text.toLowerCase();
  const actions: ArionAction[] = [];

  const task = TASK_INTENT.exec(text.trim());
  if (task && opts.allowCreate !== false) {
    const t = await aufgabeAnlegen(d, { titel: taskTitleFromSpeech(task[1]) });
    actions.push({ type: "task_created", id: t.id, title: t.title, due_date: t.due_date });
    return { answer: `Erledigt. Ich habe die Aufgabe „${t.title}“ angelegt.`, actions, hint: false };
  }
  if (/beleg|buchhalt|frist|\bust\b|umsatzsteuer|qonto|saldo|konto|steuer|geld|ausgabe/.test(q)) {
    actions.push({ type: "open", href: "/buchhaltung", label: "Buchhaltung" });
    return { answer: await buchSaetze(d, today), actions, hint: false };
  }
  if (/mail|posteingang|nachricht/.test(q)) {
    actions.push({ type: "open", href: "/mail", label: "Mail-Digest" });
    return { answer: await mailSaetze(d), actions, hint: false };
  }
  if (/aufgabe|todo|to-do|erledigen|fällig|steht .*an\b|heute an/.test(q)) {
    actions.push({ type: "open", href: "/aufgaben", label: "Aufgaben" });
    return { answer: await aufgabenSaetze(d), actions, hint: false };
  }
  const kurz = opts.mode !== "text";
  const brief = [await aufgabenSaetze(d, kurz), await mailSaetze(d, kurz), await buchSaetze(d, today, kurz)].join(" ");
  const why = opts.reason ?? "Für frei formulierte Antworten fehlt noch der KI-Schlüssel (ANTHROPIC_API_KEY).";
  return { answer: `Kurzer Überblick: ${brief} ${why}`, actions, hint: true };
}

/* ── Claude mit Tool Use ─────────────────────────────────── */

async function systemPrompt(mode: ArionMode): Promise<string> {
  const cfg = await getConfig();
  const today = todayIso();
  const weekday = WOCHENTAGE[new Date(today + "T12:00:00Z").getUTCDay()];
  const profile = [
    cfg.user_name ? `Name: ${cfg.user_name}.` : "",
    cfg.company ? `Firma: ${cfg.company}.` : "",
    cfg.partners ? `Wichtige Partner: ${cfg.partners}.` : "",
    cfg.about_me ? `Über den Nutzer: ${cfg.about_me}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const style =
    mode === "voice"
      ? `SPRACHMODUS: Deine Antwort wird vorgelesen.
- Höchstens zwei bis drei kurze Sätze, natürliche gesprochene Sprache.
- Kein Markdown, keine Listen, keine Aufzählungszeichen, keine Emojis, keine Links.
- Beträge so schreiben, wie man sie spricht: "1.745 Euro 86" (nicht "1.745,86 €").
- Daten als "20. Oktober", relative Angaben ("morgen", "in drei Tagen") bevorzugen.
- Bei langen Listen nur die zwei, drei wichtigsten nennen und die Gesamtzahl.`
      : `TEXTMODUS: Antworte knapp und präzise. Leichtes Markdown (Fett, kurze Listen) ist erlaubt.`;

  return `Du bist ARION, der persönliche Sprachassistent in der App "${cfg.app_name || "Arion OS"}" – ruhig, kompetent, wie ein exzellenter Chief of Staff. Du sprichst Deutsch und duzt den Nutzer.
Heute ist ${weekday}, der ${today}.

${profile ? `PROFIL:\n${profile}\n\n` : ""}Nutze die Werkzeuge, um Fragen mit Live-Daten zu beantworten. Erfinde keine Zahlen: Was die Werkzeuge nicht liefern, weißt du nicht – sag das kurz.
Lege Aufgaben nur an, wenn der Nutzer das ausdrücklich möchte, und bestätige sie in einem Satz.

${style}`;
}

async function claudeAnswer(
  client: Anthropic,
  mode: ArionMode,
  history: Anthropic.Messages.MessageParam[],
  text: string,
  actions: ArionAction[]
): Promise<string> {
  const model = process.env.ARION_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const system = await systemPrompt(mode);
  const messages: Anthropic.Messages.MessageParam[] = [...history, { role: "user", content: text }];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.messages.create({
      model,
      max_tokens: mode === "voice" ? 700 : 1400,
      system,
      tools: ARION_TOOLS,
      messages,
    });

    const toolUses = res.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason === "tool_use" && toolUses.length) {
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.Messages.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (b) => {
          const r = await runTool(b.name, (b.input ?? {}) as Record<string, unknown>, actions);
          return {
            type: "tool_result" as const,
            tool_use_id: b.id,
            content: typeof r.result === "string" ? r.result : JSON.stringify(r.result),
            ...(r.isError ? { is_error: true } : {}),
          };
        })
      );
      messages.push({ role: "user", content: results });
      continue;
    }
    const out = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (out) return out;
    break;
  }
  throw new Error("Keine Antwort vom Modell");
}

/* ── Einstieg ────────────────────────────────────────────── */

export async function ask(input: { text: string; mode: ArionMode; conversationId?: unknown }): Promise<ArionReply> {
  const d = await getDb();
  const today = todayIso();
  const conversationId = normalizeConversationId(input.conversationId);
  const text = input.text.trim().slice(0, 2000);
  const mode: ArionMode = input.mode === "text" ? "text" : "voice";

  const rows = (
    await d.all<{ role: string; content: string }>(
      "SELECT role, content FROM assistant_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 12",
      [conversationId]
    )
  ).reverse();

  let answer = "";
  let actions: ArionAction[] = [];
  let source: ArionReply["source"] = "lokal";

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });
      answer = await claudeAnswer(client, mode, normalizeHistory(rows), text, actions);
      source = "claude";
    } catch (e) {
      console.error("[arion] Claude-Fehler:", e instanceof Error ? e.message : e);
      // Bereits angelegte Aufgaben nicht verlieren, Antwort lokal bauen
      const created = actions.filter((a) => a.type === "task_created");
      const local = await localAnswer(text, {
        reason: "Die KI ist gerade nicht erreichbar, das hier kommt direkt aus deinen Daten.",
        allowCreate: created.length === 0,
        mode,
      });
      answer = created.length
        ? `Ich habe die Aufgabe „${(created[0] as { title: string }).title}“ angelegt, die KI ist danach aber ausgefallen.`
        : local.answer;
      actions = [...created, ...local.actions];
    }
  } else {
    const local = await localAnswer(text, { mode });
    answer = local.answer;
    actions = local.actions;
  }

  const spokenAnswer = limitSentences(toSpokenText(answer, today), mode === "voice" ? 5 : 8);

  await d.run("INSERT INTO assistant_messages (role, content, conversation_id) VALUES (?,?,?)", ["user", text, conversationId]);
  await d.run("INSERT INTO assistant_messages (role, content, conversation_id) VALUES (?,?,?)", [
    "assistant",
    answer,
    conversationId,
  ]);

  return { answer, spokenAnswer, actions, conversationId, source };
}
