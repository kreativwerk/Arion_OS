import { db } from "@/lib/db";

/**
 * Jarvis-Engine.
 *
 * Stufe 1 (immer verfügbar): beantwortet Fragen lokal aus der Datenbank
 * (Aufgaben, Verträge, Wissen, Post, Mail, Termine …) über einfache
 * Intent-Erkennung und Volltextsuche.
 *
 * Stufe 2 (optional): Ist ANTHROPIC_API_KEY gesetzt, wird die Frage mit dem
 * relevanten Kontext an die Claude API geschickt – dann antwortet Jarvis
 * frei formuliert und kann komplexe Fragen beantworten.
 */

type Row = Record<string, unknown>;

function fmtDate(s: unknown): string {
  if (!s || typeof s !== "string") return "–";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function buildContext(question: string): string {
  const d = db();
  const q = question.toLowerCase();
  const parts: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const wants = (words: string[]) => words.some((w) => q.includes(w));
  const all = !wants([
    "aufgabe", "todo", "vertrag", "versicherung", "kündig", "wissen", "amazon", "arval", "leaseplan",
    "post", "brief", "mail", "termin", "kalender", "habit", "gewohnheit", "slack", "portal", "watcher",
  ]);

  if (all || wants(["aufgabe", "todo", "heute", "woche"])) {
    const rows = d
      .prepare("SELECT title, due_date, horizon, recurrence, project, priority FROM tasks WHERE done = 0 ORDER BY due_date ASC LIMIT 15")
      .all() as Row[];
    parts.push(
      "OFFENE AUFGABEN:\n" +
        rows.map((r) => `- ${r.title} (fällig ${fmtDate(r.due_date)}, ${r.horizon === "long" ? "langfristig" : "kurzfristig"}${r.recurrence ? ", wiederkehrend " + r.recurrence : ""}${r.project ? ", Projekt: " + r.project : ""})`).join("\n")
    );
  }
  if (all || wants(["vertrag", "versicherung", "kündig", "leasing"])) {
    const rows = d
      .prepare("SELECT name, provider, category, end_date, cancel_period_days, annual_cost, notes FROM contracts ORDER BY end_date ASC LIMIT 15")
      .all() as Row[];
    parts.push(
      "VERTRÄGE:\n" +
        rows.map((r) => `- ${r.name} (${r.provider}, ${r.category}), läuft bis ${fmtDate(r.end_date)}, Kündigungsfrist ${r.cancel_period_days} Tage, Kosten ${r.annual_cost} €/Jahr${r.notes ? ", Hinweis: " + r.notes : ""}`).join("\n")
    );
  }
  if (all || wants(["wissen", "amazon", "arval", "leaseplan", "partner", "unternehmen", "firma"])) {
    const like = `%${q.split(/\s+/).find((w) => w.length > 3) ?? ""}%`;
    const rows = d
      .prepare("SELECT title, body, scope, partner FROM knowledge_notes WHERE title LIKE ? OR body LIKE ? OR partner LIKE ? OR tags LIKE ? LIMIT 8")
      .all(like, like, like, like) as Row[];
    const fallback = rows.length ? rows : (d.prepare("SELECT title, body, scope, partner FROM knowledge_notes LIMIT 8").all() as Row[]);
    parts.push("WISSEN:\n" + fallback.map((r) => `- [${r.scope}${r.partner ? "/" + r.partner : ""}] ${r.title}: ${r.body}`).join("\n"));
  }
  if (all || wants(["post", "brief", "scan"])) {
    const rows = d
      .prepare("SELECT subject, sender, received_date, status, summary FROM letters ORDER BY received_date DESC LIMIT 8")
      .all() as Row[];
    parts.push("BRIEFPOST:\n" + rows.map((r) => `- ${fmtDate(r.received_date)} von ${r.sender}: ${r.subject} [${r.status}] – ${r.summary}`).join("\n"));
  }
  if (all || wants(["mail", "e-mail", "email", "postfach"])) {
    const rows = d
      .prepare("SELECT account, from_addr, subject, summary, matched_rule FROM mail_digest WHERE read = 0 ORDER BY received_at DESC LIMIT 8")
      .all() as Row[];
    parts.push("WICHTIGE UNGELESENE MAILS:\n" + rows.map((r) => `- [${r.account}] ${r.from_addr}: ${r.subject} – ${r.summary} (${r.matched_rule})`).join("\n"));
  }
  if (all || wants(["termin", "kalender", "meeting", "call"])) {
    const rows = d
      .prepare("SELECT title, date, start_time, end_time, location FROM calendar_events WHERE date >= ? ORDER BY date ASC LIMIT 8")
      .all(today) as Row[];
    parts.push("NÄCHSTE TERMINE:\n" + rows.map((r) => `- ${fmtDate(r.date)} ${r.start_time}–${r.end_time}: ${r.title}${r.location ? " (" + r.location + ")" : ""}`).join("\n"));
  }
  if (all || wants(["slack"])) {
    const rows = d
      .prepare("SELECT from_person, channel, text FROM slack_notifications WHERE read = 0 ORDER BY created_at DESC LIMIT 5")
      .all() as Row[];
    if (rows.length) parts.push("SLACK (ungelesen, wichtig):\n" + rows.map((r) => `- ${r.from_person} in ${r.channel}: ${r.text}`).join("\n"));
  }
  if (all || wants(["portal", "watcher", "webseite"])) {
    const rows = d
      .prepare("SELECT we.title, we.detail, w.name FROM watcher_events we JOIN watchers w ON w.id = we.watcher_id WHERE we.seen = 0 LIMIT 5")
      .all() as Row[];
    if (rows.length) parts.push("PORTAL-MELDUNGEN:\n" + rows.map((r) => `- [${r.name}] ${r.title}: ${r.detail}`).join("\n"));
  }

  return parts.join("\n\n");
}

/** Lokale Antwort ohne externe KI: gibt den relevanten Kontext strukturiert zurück. */
function localAnswer(question: string): string {
  const ctx = buildContext(question);
  if (!ctx.trim()) return "Dazu habe ich aktuell nichts in deinen Daten gefunden.";
  return (
    "Hier ist, was ich in deinen Daten dazu finde:\n\n" +
    ctx +
    "\n\n_Hinweis: Für frei formulierte Antworten hinterlege einen `ANTHROPIC_API_KEY` in `.env.local` – dann antwortet Jarvis wie ein echter Assistent._"
  );
}

async function claudeAnswer(question: string, history: { role: string; content: string }[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return localAnswer(question);

  const context = buildContext(question);
  const system = `Du bist Jarvis, der persönliche Assistent des Nutzers in seiner App "Arion OS".
Du kennst seine Aufgaben, Gewohnheiten, Verträge, Briefpost, wichtigen E-Mails, Termine, sein Wissen und das seiner Firma (Arion Logistics) und ihrer Partner (u.a. Amazon, Arval, LeasePlan).
Antworte kurz, präzise, auf Deutsch, wie ein exzellenter Chief of Staff. Nutze ausschließlich den folgenden Datenkontext als Faktenbasis:

${context}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens: 1024,
      system,
      messages: [...history.slice(-10), { role: "user", content: question }],
    }),
  });
  if (!res.ok) {
    return localAnswer(question) + `\n\n_(Claude API nicht erreichbar: ${res.status})_`;
  }
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n") || localAnswer(question);
}

export async function answer(question: string): Promise<string> {
  const d = db();
  const history = d
    .prepare("SELECT role, content FROM assistant_messages ORDER BY id DESC LIMIT 10")
    .all()
    .reverse() as { role: string; content: string }[];

  const reply = await claudeAnswer(question, history);

  const ins = d.prepare("INSERT INTO assistant_messages (role, content) VALUES (?,?)");
  ins.run("user", question);
  ins.run("assistant", reply);
  return reply;
}
