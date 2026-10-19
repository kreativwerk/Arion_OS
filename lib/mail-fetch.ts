import { ImapFlow, type MessageStructureObject } from "imapflow";
import { simpleParser } from "mailparser";
import { getDb, type DB } from "@/lib/db";
import { decryptSecret } from "@/lib/secret-store";
import { sendPushToAll } from "@/lib/push";
import { runMailArchive } from "@/lib/mail-archive";
import {
  BELEG_MAX_BYTES,
  IMAGE_MIN_BYTES,
  INLINE_IMAGE_MIN_BYTES,
  belegMime,
  isScanSource,
  storeEingang,
} from "@/lib/buch-eingang";

/**
 * IMAP-Mailabruf (IONOS, GMX, beliebige weitere Postfächer).
 *
 * Konten kommen aus zwei Quellen (beide gleichzeitig möglich):
 * 1. In der App angelegt (Mail-Modul → Postfächer) – Zugangsdaten liegen
 *    verschlüsselt in der Tabelle mail_accounts.
 * 2. Umgebungsvariablen MAIL_1_… bis MAIL_8_…:
 *    MAIL_1_LABEL  Anzeigename, z.B. "IONOS Geschäftlich"
 *    MAIL_1_HOST   z.B. imap.ionos.de  |  imap.gmx.net
 *    MAIL_1_USER   vollständige E-Mail-Adresse
 *    MAIL_1_PASS   Postfach-Passwort
 *    MAIL_1_PORT   optional, Standard 993 (TLS)
 *
 * Jeder Lauf:
 * 1. holt neue Mails der letzten Tage (Dedupe über mail_seen),
 * 2. schreibt Treffer der Wichtig-Regeln in den Mail-Digest,
 * 3. extrahiert – wenn ANTHROPIC_API_KEY gesetzt ist – aus ALLEN neuen Mails
 *    dauerhaft nützliches Wissen und legt es als knowledge_notes ab,
 * 4. legt PDF-/Bild-Anhänge neuer Mails als Belege im Buchhaltungs-Eingang ab
 *    (buch_eingang, Dedupe über SHA-256, siehe docs/BUCHHALTUNG.md).
 *
 * Konten laufen nacheinander; ein Zeitbudget (deadline) beendet den Lauf
 * sauber, bevor Vercel die Funktion abbricht. Nicht verarbeitete Mails werden
 * nicht als gesehen markiert und beim nächsten Lauf nachgeholt.
 */

const MAX_PER_ACCOUNT = 25; // hält den Lauf innerhalb des Vercel-Zeitlimits
const LOOKBACK_DAYS = 4;
const BODY_EXCERPT = 1400; // Zeichen pro Mail für die Wissens-Extraktion
const MAX_ENV_ACCOUNTS = 8;
const DEFAULT_BUDGET_MS = 40_000;
/** Ein Konto wird nur noch begonnen, wenn mindestens so viel Budget übrig ist. */
const ACCOUNT_MIN_MS = 20_000;

export type MailAccountEnv = { label: string; host: string; user: string; pass: string; port: number };

export function accountsFromEnv(): MailAccountEnv[] {
  const out: MailAccountEnv[] = [];
  for (let i = 1; i <= MAX_ENV_ACCOUNTS; i++) {
    const host = process.env[`MAIL_${i}_HOST`];
    const user = process.env[`MAIL_${i}_USER`];
    const pass = process.env[`MAIL_${i}_PASS`];
    if (host && user && pass) {
      out.push({
        label: process.env[`MAIL_${i}_LABEL`] || user,
        host,
        user,
        pass,
        port: Number(process.env[`MAIL_${i}_PORT`] || 993),
      });
    }
  }
  return out;
}

/** In der App angelegte Postfächer (aktiv + vollständige Zugangsdaten). */
export async function accountsFromDb(d: DB, hints: string[]): Promise<MailAccountEnv[]> {
  const rows = await d.all<{ label: string; host: string; port: number; username: string; password_enc: string }>(
    "SELECT label, host, port, username, password_enc FROM mail_accounts WHERE active = 1 AND host <> '' AND username <> '' AND password_enc <> ''"
  );
  const out: MailAccountEnv[] = [];
  for (const r of rows) {
    try {
      out.push({
        label: r.label,
        host: r.host,
        user: r.username,
        pass: decryptSecret(r.password_enc),
        port: Number(r.port) || 993,
      });
    } catch {
      hints.push(
        `${r.label}: gespeichertes Passwort ist nicht mehr entschlüsselbar (wurde APP_PASSWORD/AUTH_SECRET geändert?). Bitte das Passwort im Mail-Modul neu eingeben.`
      );
    }
  }
  return out;
}

type NewMail = {
  account: string;
  messageId: string;
  from: string;
  subject: string;
  date: string;
  text: string;
  belege: number;
  /** false, wenn Anhänge nicht vollständig gespeichert wurden (Zeitbudget/Fehler)
   *  → Mail wird NICHT als gesehen markiert und beim nächsten Lauf erneut verarbeitet. */
  complete: boolean;
};

type Rule = { kind: string; value: string };

function matchRule(mail: NewMail, rules: Rule[]): string | null {
  for (const r of rules) {
    const v = r.value.toLowerCase();
    if (!v) continue;
    if (r.kind === "absender" && mail.from.toLowerCase().includes(v)) return r.value;
    if (r.kind === "stichwort" && (mail.subject + " " + mail.text).toLowerCase().includes(v)) return r.value;
    if (r.kind === "betreff" && mail.subject.toLowerCase().includes(v)) return r.value;
  }
  return null;
}

type Candidate = { part: string; filename: string; mime: string; size: number };

/** Mögliche Belege (PDF/Bilder) aus der MIME-Struktur einer Mail. `size` ist die
 *  kodierte Größe (Base64 ≈ 4/3) – daraus wird die echte Größe geschätzt. */
export function belegCandidates(node: MessageStructureObject | undefined, out: Candidate[] = []): Candidate[] {
  if (!node) return out;
  if (node.childNodes?.length) {
    for (const c of node.childNodes) belegCandidates(c, out);
    return out;
  }
  if (node.type?.toLowerCase() === "message/rfc822") return out; // weitergeleitete Mails nicht aufbohren
  const filename = node.dispositionParameters?.filename || node.parameters?.name || "";
  const mime = belegMime(node.type, filename);
  if (!mime) return out;
  const encoded = Number(node.size || 0);
  const size = node.encoding?.toLowerCase() === "base64" ? Math.floor(encoded * 0.75) : encoded;
  if (size > BELEG_MAX_BYTES) return out;
  if (mime.startsWith("image/")) {
    const inline = node.disposition?.toLowerCase() !== "attachment" || Boolean(node.id);
    if (size < IMAGE_MIN_BYTES || (inline && size < INLINE_IMAGE_MIN_BYTES)) return out;
  }
  out.push({ part: node.part || "1", filename: filename || `Anhang.${mime.split("/")[1]}`, mime, size });
  return out;
}

async function streamToBuffer(stream: NodeJS.ReadableStream, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

type FetchCtx = { d: DB; hints: string[]; deadline: number; eingang: { neu: number } };

export type IngestMeta = { label: string; user: string; messageId: string; from: string; subject: string; to: string; date: string };

/** Lädt alle Beleg-Anhänge einer Mail und legt sie im Eingang ab (SHA-256-Dedupe →
 *  wiederholbar). `complete` ist nur true, wenn jeder Kandidat verarbeitet wurde. */
export async function ingestAttachments(
  client: ImapFlow,
  uid: number,
  structure: MessageStructureObject | undefined,
  meta: IngestMeta,
  d: DB,
  hints: string[],
  deadline: number
): Promise<{ neu: number; complete: boolean }> {
  let neu = 0;
  let complete = true;
  const quelle = isScanSource(`${meta.label} ${meta.user}`, meta.to, meta.subject) ? "scan" : "mail";
  for (const c of belegCandidates(structure)) {
    if (Date.now() > deadline) {
      complete = false; // Rest beim nächsten Lauf
      break;
    }
    try {
      const dl = await client.download(String(uid), c.part, { uid: true, maxBytes: BELEG_MAX_BYTES + 1 });
      const data = await streamToBuffer(dl.content, BELEG_MAX_BYTES);
      if (!data) continue; // größer als erlaubt – bewusst übersprungen
      if (c.mime.startsWith("image/") && data.length < IMAGE_MIN_BYTES) continue;
      const id = await storeEingang(d, {
        quelle,
        account: meta.label,
        messageId: meta.messageId,
        from: meta.from,
        subject: meta.subject,
        receivedAt: meta.date,
        filename: dl.meta.filename || c.filename,
        mime: c.mime,
        data,
      });
      if (id) neu++;
    } catch (e) {
      complete = false;
      hints.push(`${meta.label}: Anhang „${c.filename}“ nicht gespeichert – ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { neu, complete };
}

async function fetchAccount(acc: MailAccountEnv, ctx: FetchCtx): Promise<NewMail[]> {
  const { d, hints, deadline } = ctx;
  const client = new ImapFlow({
    host: acc.host,
    port: acc.port,
    secure: true,
    auth: { user: acc.user, pass: acc.pass },
    logger: false,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
  });
  const mails: NewMail[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
      const uids = ((await client.search({ since }, { uid: true })) || []) as number[];
      const recent = uids.slice(-MAX_PER_ACCOUNT * 2); // etwas Puffer für bereits Bekannte
      for (const uid of recent.reverse()) {
        if (mails.length >= MAX_PER_ACCOUNT) break;
        if (Date.now() > deadline) {
          hints.push(`${acc.label}: Zeitbudget erreicht – restliche Mails folgen beim nächsten Abruf.`);
          break;
        }
        const msg = await client.fetchOne(
          String(uid),
          { uid: true, envelope: true, internalDate: true, bodyStructure: true, source: { maxLength: 96_000 } },
          { uid: true }
        );
        if (!msg) continue;
        const messageId = msg.envelope?.messageId || `${acc.host}:${uid}`;
        const known = await d.get("SELECT 1 AS x FROM mail_seen WHERE account = ? AND message_id = ?", [
          acc.label,
          messageId,
        ]);
        if (known) continue;

        let text = "";
        let subject = msg.envelope?.subject || "(ohne Betreff)";
        let from =
          msg.envelope?.from?.map((a) => `${a.name ? a.name + " " : ""}<${a.address}>`).join(", ") || "unbekannt";
        if (msg.source) {
          try {
            const parsed = await simpleParser(msg.source);
            text = (parsed.text || "").replace(/\s+/g, " ").trim();
            if (parsed.subject) subject = parsed.subject;
            if (parsed.from?.text) from = parsed.from.text;
          } catch {
            // abgeschnittene Quelle – Envelope-Daten reichen
          }
        }
        const date = new Date(msg.internalDate ?? Date.now()).toISOString();

        // Belege: PDF-/Bild-Anhänge in den Buchhaltungs-Eingang (angefangene Mail darf 5 s überziehen)
        const to = msg.envelope?.to?.map((a) => a.address || "").join(", ") || "";
        const ing = await ingestAttachments(
          client,
          uid,
          msg.bodyStructure,
          { label: acc.label, user: acc.user, messageId, from, subject, to, date },
          d,
          hints,
          deadline + 5_000
        );
        ctx.eingang.neu += ing.neu;
        const belege = ing.neu;

        mails.push({
          account: acc.label,
          messageId,
          from,
          subject,
          date,
          text: text.slice(0, BODY_EXCERPT * 3),
          belege,
          complete: ing.complete,
        });
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    hints.push(`${acc.label}: ${e instanceof Error ? e.message : String(e)}`);
    try {
      await client.logout();
    } catch {
      /* bereits getrennt */
    }
  }
  return mails;
}

type Extraction = {
  summaries: Record<number, string>;
  notes: { title: string; body: string; scope?: string; partner?: string; tags?: string }[];
};

/** Ein Claude-Aufruf pro Lauf: Kurzfassungen + Wissens-Notizen aus allen neuen Mails. */
async function extractWithClaude(mails: NewMail[], hints: string[], timeoutMs = 25_000): Promise<Extraction> {
  const empty: Extraction = { summaries: {}, notes: [] };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    hints.push("ANTHROPIC_API_KEY fehlt – Mails wurden abgerufen, aber ohne KI-Zusammenfassung und ohne Wissens-Extraktion.");
    return empty;
  }
  if (mails.length === 0) return empty;

  const listing = mails
    .map(
      (m, i) =>
        `[${i}] Konto: ${m.account}\nVon: ${m.from}\nBetreff: ${m.subject}\nDatum: ${m.date}\nText: ${m.text.slice(0, BODY_EXCERPT)}`
    )
    .join("\n\n---\n\n");

  const system = `Du wertest die neuen E-Mails eines Unternehmers (Logistik, Immobilien, Webdesign) aus. Antworte NUR mit gültigem JSON, ohne Markdown:
{"summaries": {"0": "Ein-Satz-Zusammenfassung der Mail 0", ...}, "notes": [{"title": "...", "body": "...", "scope": "persoenlich|unternehmen|partner", "partner": "", "tags": "komma,getrennt"}]}

Regeln für "summaries": für JEDE Mail genau ein prägnanter deutscher Satz.
Regeln für "notes": NUR dauerhaft nützliches Wissen (Vertragsdetails, Fristen, Preise, Ansprechpartner, Zugangsdaten-Hinweise, Entscheidungen, laufende Vorgänge). Newsletter, Werbung und Automatisches ergeben KEINE Notiz. Fasse zusammen statt zu kopieren, nenne die Quelle im body (z.B. "Quelle: Mail von X am Y"). Wenige gute Notizen statt vieler flacher. Leeres Array ist in Ordnung.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 3000,
        system,
        messages: [{ role: "user", content: listing }],
      }),
      signal: AbortSignal.timeout(Math.max(8_000, timeoutMs)),
    });
    if (!res.ok) {
      hints.push(`Claude API antwortete mit ${res.status} – Digest ohne KI-Zusammenfassung.`);
      return empty;
    }
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const raw = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = raw?.replace(/^```(json)?/m, "").replace(/```\s*$/m, "").trim();
    const parsed = JSON.parse(json || "{}") as {
      summaries?: Record<string, string>;
      notes?: Extraction["notes"];
    };
    const summaries: Record<number, string> = {};
    for (const [k, v] of Object.entries(parsed.summaries ?? {})) summaries[Number(k)] = String(v);
    return { summaries, notes: Array.isArray(parsed.notes) ? parsed.notes : [] };
  } catch (e) {
    hints.push(`Wissens-Extraktion fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    return empty;
  }
}

export type MailFetchResult = {
  configured: boolean;
  accounts: { label: string; neu: number }[];
  neu: number;
  wichtig: number;
  notizen: number;
  /** neue Belege im Buchhaltungs-Eingang */
  belege: number;
  /** neu ins Postfach-Archiv übernommene Mails (alle Ordner, inkl. Nachladen älterer) */
  archiviert: number;
  hinweise: string[];
};

export type MailFetchOptions = {
  /** Zeitpunkt (ms), ab dem keine weiteren Mails mehr geholt werden */
  deadline?: number;
  /** Eine Push-Nachricht bei neuen Belegen/wichtigen Mails senden (Cron) */
  push?: boolean;
  /** Restliches Budget fürs Postfach-Archiv nutzen (Standard: ja) */
  archive?: boolean;
};

export async function runMailFetch(opts: MailFetchOptions = {}): Promise<MailFetchResult> {
  const hints: string[] = [];
  const deadline = opts.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  const d = await getDb();

  // App-Konten zuerst, Env-Konten dazu (doppelte Labels werden nicht dedupliziert –
  // dafür sorgt ohnehin mail_seen pro Konto+Message-ID).
  const accounts = [...(await accountsFromDb(d, hints)), ...accountsFromEnv()];
  if (accounts.length === 0) {
    return {
      configured: false,
      accounts: [],
      neu: 0,
      wichtig: 0,
      notizen: 0,
      belege: 0,
      archiviert: 0,
      hinweise: [
        "Keine Postfächer mit Zugangsdaten. Lege sie direkt hier im Mail-Modul unter „Postfächer“ an (IONOS: imap.ionos.de, GMX: imap.gmx.net – IMAP vorher in den GMX-Einstellungen aktivieren). Alternativ gehen weiterhin Umgebungsvariablen MAIL_1_HOST/USER/PASS.",
        ...hints,
      ],
    };
  }

  const rules = await d.all<Rule>("SELECT kind, value FROM mail_rules");

  const perAccount: { label: string; neu: number }[] = [];
  const allNew: NewMail[] = [];
  const ctx: FetchCtx = { d, hints, deadline, eingang: { neu: 0 } };
  // Reihenfolge rotiert pro Lauf, damit bei knappem Budget kein Konto dauerhaft hinten runterfällt
  const rot = await d.all<{ value: string }>(
    "INSERT INTO app_config (key, value) VALUES ('mail_rotation','1') ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(app_config.value AS INTEGER) + 1 AS TEXT) RETURNING value"
  );
  const offset = (Number(rot[0]?.value) || 0) % accounts.length;
  const ordered = [...accounts.slice(offset), ...accounts.slice(0, offset)];
  let started = 0;
  for (const acc of ordered) {
    if (started > 0 && deadline - Date.now() < ACCOUNT_MIN_MS) {
      hints.push(`${acc.label}: übersprungen (Zeitbudget knapp) – beim nächsten Abruf dabei.`);
      perAccount.push({ label: acc.label, neu: 0 });
      continue;
    }
    started++;
    const mails = await fetchAccount(acc, ctx);
    perAccount.push({ label: acc.label, neu: mails.length });
    allNew.push(...mails);
  }

  // Unvollständige Mails (Anhänge abgebrochen) komplett auf den nächsten Lauf verschieben –
  // sonst gingen Belege verloren bzw. der Digest-Eintrag entstünde doppelt.
  const incomplete = allNew.filter((m) => !m.complete).length;
  if (incomplete > 0) {
    hints.push(`${incomplete} ${incomplete === 1 ? "Mail wird" : "Mails werden"} beim nächsten Abruf erneut verarbeitet (Anhänge unvollständig).`);
  }
  const done = allNew.filter((m) => m.complete);
  allNew.length = 0;
  allNew.push(...done);

  const { summaries, notes } = await extractWithClaude(allNew, hints, deadline + 12_000 - Date.now());

  let wichtig = 0;
  for (let i = 0; i < allNew.length; i++) {
    const m = allNew[i];
    const rule = matchRule(m, rules);
    // Fallback ohne KI: Text-Auszug ohne URLs (lange Links sprengen sonst das Layout)
    const summary = summaries[i] || m.text.replace(/https?:\/\/\S+/g, "[Link]").slice(0, 180);
    if (rule) {
      wichtig++;
      await d.run(
        "INSERT INTO mail_digest (account, from_addr, subject, summary, matched_rule, important, received_at, read) VALUES (?,?,?,?,?,1,?,0)",
        [m.account, m.from, m.subject, summary, rule, m.date]
      );
    }
    await d.run("INSERT INTO mail_seen (account, message_id) VALUES (?,?) ON CONFLICT DO NOTHING", [
      m.account,
      m.messageId,
    ]);
  }

  let notizen = 0;
  for (const n of notes) {
    if (!n.title || !n.body) continue;
    const existing = await d.get("SELECT 1 AS x FROM knowledge_notes WHERE title = ?", [n.title]);
    if (existing) continue;
    const scope = ["persoenlich", "unternehmen", "partner"].includes(n.scope ?? "") ? n.scope : "unternehmen";
    const tags = [n.tags, "email-import"].filter(Boolean).join(",");
    await d.run(
      "INSERT INTO knowledge_notes (title, body, scope, partner, tags) VALUES (?,?,?,?,?)",
      [n.title, n.body, scope, n.partner ?? "", tags]
    );
    notizen++;
  }

  const belege = ctx.eingang.neu;
  if (opts.push && (belege > 0 || wichtig > 0)) {
    const parts: string[] = [];
    if (belege > 0) parts.push(`${belege} ${belege === 1 ? "neuer Beleg" : "neue Belege"} eingegangen`);
    if (wichtig > 0) parts.push(`${wichtig} ${wichtig === 1 ? "wichtige Mail" : "wichtige Mails"}`);
    await sendPushToAll({
      title: belege > 0 ? "Buchhaltung" : "Mail-Digest",
      body: parts.join(" · "),
      url: belege > 0 ? "/buchhaltung" : "/mail",
    }).catch(() => {});
  }

  // Postfach-Archiv mit dem restlichen Budget (Digest und Belege haben Vorrang)
  let archiviert = 0;
  if (opts.archive !== false && deadline - Date.now() > 10_000) {
    const ar = await runMailArchive(d, accounts, deadline);
    archiviert = ar.neu;
    hints.push(...ar.hinweise);
  }

  return { configured: true, accounts: perAccount, neu: allNew.length, wichtig, notizen, belege, archiviert, hinweise: hints };
}
