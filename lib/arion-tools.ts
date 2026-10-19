import type Anthropic from "@anthropic-ai/sdk";
import { getDb, todayIso, type DB } from "@/lib/db";
import { MONTH_RE, latestMonth, monthSummary } from "@/lib/buch-overview";
import { buildContext } from "@/lib/assistant/engine";

/**
 * ARION – Werkzeuge (Tool Use) für das Sprachmodell.
 *
 * Jede Funktion liest live aus dem Datenkern und liefert kompakte, JSON-fähige
 * Objekte. Dieselben Funktionen nutzt der lokale Fallback (ohne API-Key) und
 * die Statuskarten auf /arion – es gibt nur eine Wahrheit.
 */

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/* ── Buchhaltung ─────────────────────────────────────────── */

export type BuchFrist = { titel: string; faellig: string | null; betrag: number | null; art: string; tage_bis: number | null };

export async function buchhaltungDaten(d: DB, monatParam?: string | null) {
  const today = todayIso();
  let monat = monatParam && MONTH_RE.test(monatParam) ? monatParam : today.slice(0, 7);
  let summary = await monthSummary(d, monat);
  // Laufender Monat noch ohne Bankdaten → letzten Monat mit Daten nehmen
  if (!monatParam && summary.anzahl === 0) {
    const latest = await latestMonth(d);
    if (latest !== monat) {
      monat = latest;
      summary = await monthSummary(d, monat);
    }
  }

  const [gesamt, eingang, eingangNeu, fristen, kennzahlen] = await Promise.all([
    d.get<{ n: number; s: number }>("SELECT COUNT(*) AS n, SUM(betrag) AS s FROM buch_ausgaben WHERE kategorie = 'FEHLT'"),
    d.all<Record<string, unknown>>(
      "SELECT from_addr, subject, filename, received_at, firma FROM buch_eingang WHERE status = 'neu' ORDER BY id DESC LIMIT 5"
    ),
    d.get<{ n: number }>("SELECT COUNT(*) AS n FROM buch_eingang WHERE status = 'neu'"),
    d.all<Record<string, unknown>>(
      "SELECT titel, faellig, betrag, art FROM buch_fristen WHERE status = 'offen' ORDER BY faellig IS NULL, faellig ASC, id ASC LIMIT 10"
    ),
    d.all<{ key: string; value: string; updated_at: string }>(
      "SELECT key, value, updated_at FROM buch_kennzahlen WHERE key IN ('qonto_saldo','qonto_stand')"
    ),
  ]);

  const kz = Object.fromEntries(kennzahlen.map((k) => [k.key, k]));
  const saldoRaw = kz.qonto_saldo?.value;
  const saldo = saldoRaw !== undefined && saldoRaw !== "" && Number.isFinite(Number(saldoRaw)) ? num(saldoRaw) : null;

  const fristenOut: BuchFrist[] = fristen.map((f) => {
    const faellig = typeof f.faellig === "string" && ISO_DATE.test(f.faellig) ? f.faellig : null;
    return {
      titel: String(f.titel ?? ""),
      faellig,
      betrag: f.betrag === null || f.betrag === undefined ? null : num(f.betrag),
      art: String(f.art ?? "sonstiges"),
      tage_bis: faellig ? daysBetween(today, faellig) : null,
    };
  });

  return {
    heute: today,
    monat,
    ausgaben_anzahl: summary.anzahl,
    ausgaben_summe: summary.summe,
    belegt_prozent: summary.belegt_prozent,
    fehlt_anzahl: summary.fehlt_anzahl,
    fehlt_summe: summary.fehlt_summe,
    fehlt_alle_monate_anzahl: Number(gesamt?.n ?? 0),
    fehlt_alle_monate_summe: num(gesamt?.s),
    fehlende_belege: summary.fehlt.slice(0, 15).map((r) => {
      const row = r as Record<string, unknown>;
      return { datum: row.datum, empfaenger: row.empfaenger, zweck: row.zweck, betrag: r.betrag };
    }),
    eingang_neu: Number(eingangNeu?.n ?? 0),
    eingang_neu_liste: eingang.map((e) => ({
      von: e.from_addr,
      betreff: e.subject,
      datei: e.filename,
      firma: e.firma,
      eingegangen: e.received_at,
    })),
    fristen_offen: fristenOut,
    naechste_frist: fristenOut.find((f) => f.faellig) ?? null,
    naechste_ust: fristenOut.find((f) => f.art === "ust") ?? null,
    qonto_saldo: saldo,
    qonto_stand: kz.qonto_stand?.value || kz.qonto_saldo?.updated_at || null,
  };
}

/* ── Mails ───────────────────────────────────────────────── */

export async function wichtigeMails(d: DB, opts: { nur_ungelesen?: boolean; limit?: number } = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 8, 1), 20);
  const onlyUnread = opts.nur_ungelesen !== false;
  const [rows, count] = await Promise.all([
    d.all<Record<string, unknown>>(
      `SELECT account, from_addr, subject, summary, received_at, read FROM mail_digest
       WHERE important = 1 ${onlyUnread ? "AND read = 0" : ""} ORDER BY received_at DESC LIMIT ?`,
      [limit]
    ),
    d.get<{ n: number }>("SELECT COUNT(*) AS n FROM mail_digest WHERE important = 1 AND read = 0"),
  ]);
  return {
    ungelesen_wichtig: Number(count?.n ?? 0),
    mails: rows.map((r) => ({
      postfach: r.account,
      von: r.from_addr,
      betreff: r.subject,
      zusammenfassung: r.summary,
      eingegangen: r.received_at,
      gelesen: Number(r.read) === 1,
    })),
  };
}

/* ── Aufgaben ────────────────────────────────────────────── */

export async function offeneAufgaben(d: DB, opts: { nur_faellig?: boolean; limit?: number } = {}) {
  const today = todayIso();
  const limit = Math.min(Math.max(Number(opts.limit) || 10, 1), 30);
  const [rows, counts] = await Promise.all([
    d.all<Record<string, unknown>>(
      `SELECT id, title, due_date, priority, project, recurrence FROM tasks
       WHERE done = 0 AND accepted = 1 ${opts.nur_faellig ? "AND due_date IS NOT NULL AND due_date <= ?" : ""}
       ORDER BY due_date IS NULL, due_date ASC, priority ASC LIMIT ?`,
      opts.nur_faellig ? [today, limit] : [limit]
    ),
    d.get<{ offen: number; heute: number; ueberfaellig: number }>(
      `SELECT (SELECT COUNT(*) FROM tasks WHERE done = 0 AND accepted = 1) AS offen,
              (SELECT COUNT(*) FROM tasks WHERE done = 0 AND accepted = 1 AND due_date = ?) AS heute,
              (SELECT COUNT(*) FROM tasks WHERE done = 0 AND accepted = 1 AND due_date < ?) AS ueberfaellig`,
      [today, today]
    ),
  ]);
  return {
    heute: today,
    offen_gesamt: Number(counts?.offen ?? 0),
    faellig_heute: Number(counts?.heute ?? 0),
    ueberfaellig: Number(counts?.ueberfaellig ?? 0),
    aufgaben: rows.map((r) => ({
      id: Number(r.id),
      titel: r.title,
      faellig: r.due_date,
      prioritaet: Number(r.priority ?? 2) === 1 ? "hoch" : Number(r.priority ?? 2) === 3 ? "niedrig" : "normal",
      projekt: r.project || undefined,
      wiederkehrend: r.recurrence || undefined,
    })),
  };
}

export type CreatedTask = { id: number; title: string; due_date: string | null; priority: number };

export async function aufgabeAnlegen(
  d: DB,
  input: { titel?: unknown; faellig?: unknown; notiz?: unknown; prioritaet?: unknown }
): Promise<CreatedTask> {
  const title = String(input.titel ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) throw new Error("Titel fehlt");
  const due = typeof input.faellig === "string" && ISO_DATE.test(input.faellig) ? input.faellig : null;
  const notes = String(input.notiz ?? "").trim().slice(0, 2000);
  const prio = input.prioritaet === "hoch" ? 1 : input.prioritaet === "niedrig" ? 3 : 2;
  const id = await d.insert(
    "INSERT INTO tasks (title, notes, horizon, due_date, priority, source, submitted_by, accepted) VALUES (?,?,?,?,?,?,?,1)",
    [title, notes, "short", due, prio, "ARION", "Sprachassistent"]
  );
  return { id, title, due_date: due, priority: prio };
}

/* ── Kompakte Kennzahlen (Statuskarten auf /arion) ───────── */

export async function arionKennzahlen() {
  const d = await getDb();
  const [buch, mails, tasks] = await Promise.all([
    buchhaltungDaten(d),
    d.get<{ n: number }>("SELECT COUNT(*) AS n FROM mail_digest WHERE important = 1 AND read = 0"),
    d.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM tasks WHERE done = 0 AND accepted = 1 AND due_date IS NOT NULL AND due_date <= ?",
      [todayIso()]
    ),
  ]);
  return {
    monat: buch.monat,
    fehlt_anzahl: buch.fehlt_anzahl,
    fehlt_summe: buch.fehlt_summe,
    eingang_neu: buch.eingang_neu,
    naechste_frist: buch.naechste_frist,
    qonto_saldo: buch.qonto_saldo,
    qonto_stand: buch.qonto_stand,
    mails_neu: Number(mails?.n ?? 0),
    aufgaben_faellig: Number(tasks?.n ?? 0),
  };
}

/* ── Tool-Definitionen für Claude ────────────────────────── */

export const ARION_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "buchhaltung_ueberblick",
    description:
      "Live-Stand der Buchhaltung: fehlende Belege (Anzahl, Summe, Liste) im Monat und über alle Monate, neue Belege im Eingang, " +
      "offene Fristen (inkl. Umsatzsteuer-Voranmeldung, Tage bis Fälligkeit) und den Qonto-Kontostand. " +
      "Nutzen bei Fragen zu Belegen, Buchhaltung, Steuern, Fristen, Kontostand oder Geld.",
    input_schema: {
      type: "object",
      properties: {
        monat: { type: "string", description: "Optional: Monat als YYYY-MM. Standard: laufender Monat." },
      },
    },
  },
  {
    name: "wichtige_mails",
    description: "Wichtige E-Mails aus dem Mail-Digest (Absender, Betreff, Kurzfassung). Nutzen bei Fragen zu Mails oder Posteingang.",
    input_schema: {
      type: "object",
      properties: {
        nur_ungelesen: { type: "boolean", description: "Nur ungelesene (Standard: true)." },
        limit: { type: "integer", description: "Maximale Anzahl (1–20, Standard 8)." },
      },
    },
  },
  {
    name: "offene_aufgaben",
    description: "Offene Aufgaben mit Fälligkeit und Priorität, dazu Zähler (heute fällig, überfällig).",
    input_schema: {
      type: "object",
      properties: {
        nur_faellig: { type: "boolean", description: "Nur heute fällige und überfällige Aufgaben." },
        limit: { type: "integer", description: "Maximale Anzahl (1–30, Standard 10)." },
      },
    },
  },
  {
    name: "aufgabe_anlegen",
    description:
      "Legt eine neue Aufgabe an. Nur verwenden, wenn der Nutzer ausdrücklich etwas notieren, sich erinnern lassen oder eine Aufgabe anlegen will.",
    input_schema: {
      type: "object",
      properties: {
        titel: { type: "string", description: "Kurzer, klarer Aufgabentitel im Imperativ." },
        faellig: { type: "string", description: "Optional: Fälligkeitsdatum YYYY-MM-DD (relativ zu heute auflösen)." },
        notiz: { type: "string", description: "Optionale Details." },
        prioritaet: { type: "string", enum: ["hoch", "normal", "niedrig"] },
      },
      required: ["titel"],
    },
  },
  {
    name: "daten_suchen",
    description:
      "Durchsucht die übrigen Module (Verträge, Briefpost, Wissen, Termine, Dokumente, Slack, Portale) passend zu einer Frage und liefert Textkontext.",
    input_schema: {
      type: "object",
      properties: { frage: { type: "string", description: "Die Frage oder Stichworte." } },
      required: ["frage"],
    },
  },
];

export type ArionAction =
  | { type: "task_created"; id: number; title: string; due_date: string | null }
  | { type: "open"; href: string; label: string };

const OPEN_LINKS: Record<string, { href: string; label: string }> = {
  buchhaltung_ueberblick: { href: "/buchhaltung", label: "Buchhaltung" },
  wichtige_mails: { href: "/mail", label: "Mail-Digest" },
  offene_aufgaben: { href: "/aufgaben", label: "Aufgaben" },
};

/** Führt ein Werkzeug aus. Fehler werden als Ergebnis zurückgegeben, nicht geworfen. */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  actions: ArionAction[]
): Promise<{ result: unknown; isError?: boolean }> {
  const d = await getDb();
  try {
    const link = OPEN_LINKS[name];
    if (link && !actions.some((a) => a.type === "open" && a.href === link.href)) actions.push({ type: "open", ...link });
    switch (name) {
      case "buchhaltung_ueberblick":
        return { result: await buchhaltungDaten(d, typeof input.monat === "string" ? input.monat : null) };
      case "wichtige_mails":
        return { result: await wichtigeMails(d, input as { nur_ungelesen?: boolean; limit?: number }) };
      case "offene_aufgaben":
        return { result: await offeneAufgaben(d, input as { nur_faellig?: boolean; limit?: number }) };
      case "aufgabe_anlegen": {
        const t = await aufgabeAnlegen(d, input);
        actions.push({ type: "task_created", id: t.id, title: t.title, due_date: t.due_date });
        return { result: { ok: true, ...t } };
      }
      case "daten_suchen":
        return { result: (await buildContext(String(input.frage ?? ""))) || "Keine passenden Daten gefunden." };
      default:
        return { result: `Unbekanntes Werkzeug: ${name}`, isError: true };
    }
  } catch (e) {
    return { result: `Fehler: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}
