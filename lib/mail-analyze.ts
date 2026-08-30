import { ImapFlow } from "imapflow";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/secret-store";
import { accountsFromEnv, type MailAccountEnv } from "@/lib/mail-fetch";

/**
 * Postfach-Analyse für Regel-Vorschläge:
 * Liest die Envelopes des Gesendet-Ordners (an wen hat Albert oft geschrieben
 * bzw. geantwortet) und schlägt daraus VIP-Absender und Stichwörter für die
 * Wichtig-Regeln vor. Es werden nur Kopfdaten gelesen, keine Mail-Inhalte.
 */

const LOOKBACK_DAYS = 120;
const MAX_MESSAGES = 400; // Envelopes pro Konto – Kopfzeilen sind billig
const SENT_CANDIDATES = ["Gesendet", "Sent", "Sent Items", "Gesendete Objekte", "INBOX.Sent", "INBOX/Gesendet"];

// Häufige deutsche/englische Füllwörter, die als Stichwort nichts taugen
const STOPWORDS = new Set([
  "aw", "re", "fwd", "wg", "fw", "und", "oder", "der", "die", "das", "den", "dem", "des", "ein", "eine",
  "einen", "einem", "einer", "für", "von", "mit", "aus", "bei", "nach", "über", "unter", "zum", "zur",
  "ihre", "ihr", "ihren", "ihrem", "sie", "wir", "uns", "unsere", "unser", "the", "for", "and", "your",
  "you", "our", "new", "neue", "neuer", "neues", "info", "mail", "e-mail", "email", "betreff", "anfrage",
  "termin", "kein", "keine", "nicht", "bitte", "danke", "hallo", "guten", "morgen", "heute", "diese",
  "dieser", "dieses", "sind", "ist", "war", "wird", "werden", "haben", "hat", "noch", "schon", "auch",
  "alle", "vom", "per", "als", "auf", "an", "im", "in", "am", "um", "zu", "bis", "ab",
]);

export type SenderSuggestion = { value: string; name: string; count: number; accounts: string[] };
export type KeywordSuggestion = { value: string; count: number };
export type SuggestResult = {
  configured: boolean;
  analysierte_mails: number;
  senders: SenderSuggestion[];
  keywords: KeywordSuggestion[];
  hinweise: string[];
};

type Envelope = {
  to?: { address?: string; name?: string }[];
  cc?: { address?: string; name?: string }[];
  subject?: string;
};

async function loadAccounts(hints: string[]): Promise<MailAccountEnv[]> {
  const d = await getDb();
  const rows = await d.all<{ label: string; host: string; port: number; username: string; password_enc: string }>(
    "SELECT label, host, port, username, password_enc FROM mail_accounts WHERE active = 1 AND host <> '' AND username <> '' AND password_enc <> ''"
  );
  const out: MailAccountEnv[] = [];
  for (const r of rows) {
    try {
      out.push({ label: r.label, host: r.host, user: r.username, pass: decryptSecret(r.password_enc), port: Number(r.port) || 993 });
    } catch {
      hints.push(`${r.label}: gespeichertes Passwort nicht entschlüsselbar – bitte im Mail-Modul neu eingeben.`);
    }
  }
  return [...out, ...accountsFromEnv()];
}

/** Gesendet-Ordner finden: erst SPECIAL-USE-Flag, dann bekannte Namen. */
async function findSentMailbox(client: ImapFlow): Promise<string | null> {
  const boxes = await client.list();
  const bySpecial = boxes.find((b) => b.specialUse === "\\Sent");
  if (bySpecial) return bySpecial.path;
  for (const cand of SENT_CANDIDATES) {
    const hit = boxes.find((b) => b.path.toLowerCase() === cand.toLowerCase() || b.name.toLowerCase() === cand.toLowerCase());
    if (hit) return hit.path;
  }
  return null;
}

async function fetchSentEnvelopes(acc: MailAccountEnv, hints: string[]): Promise<Envelope[]> {
  const client = new ImapFlow({
    host: acc.host,
    port: acc.port,
    secure: true,
    auth: { user: acc.user, pass: acc.pass },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  const envelopes: Envelope[] = [];
  try {
    await client.connect();
    const sentPath = await findSentMailbox(client);
    if (!sentPath) {
      hints.push(`${acc.label}: Gesendet-Ordner nicht gefunden.`);
      await client.logout();
      return envelopes;
    }
    const lock = await client.getMailboxLock(sentPath, { readOnly: true });
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
      const uids = ((await client.search({ since }, { uid: true })) || []) as number[];
      const recent = uids.slice(-MAX_MESSAGES);
      if (recent.length > 0) {
        for await (const msg of client.fetch(
          { uid: `${recent[0]}:${recent[recent.length - 1]}` },
          { uid: true, envelope: true },
          { uid: true }
        )) {
          if (msg.envelope) {
            envelopes.push({
              to: msg.envelope.to as Envelope["to"],
              cc: msg.envelope.cc as Envelope["cc"],
              subject: msg.envelope.subject,
            });
          }
        }
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
  return envelopes;
}

/** Reine Auswertung – getrennt, damit sie testbar bleibt. */
export function analyzeEnvelopes(
  perAccount: { label: string; envelopes: Envelope[] }[],
  ownAddresses: string[],
  existingRules: { kind: string; value: string }[]
): { senders: SenderSuggestion[]; keywords: KeywordSuggestion[]; total: number } {
  const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
  const ruleValues = existingRules.map((r) => r.value.toLowerCase());
  const covered = (value: string) => ruleValues.some((rv) => value.toLowerCase().includes(rv));

  const senderMap = new Map<string, { name: string; count: number; accounts: Set<string> }>();
  const wordMap = new Map<string, number>();
  let total = 0;

  for (const { label, envelopes } of perAccount) {
    for (const env of envelopes) {
      total++;
      for (const rcpt of [...(env.to ?? []), ...(env.cc ?? [])]) {
        const addr = rcpt.address?.toLowerCase().trim();
        if (!addr || own.has(addr)) continue;
        if (/no-?reply|newsletter|notification|donotreply/.test(addr)) continue;
        const cur = senderMap.get(addr) ?? { name: rcpt.name || "", count: 0, accounts: new Set<string>() };
        cur.count++;
        if (rcpt.name && !cur.name) cur.name = rcpt.name;
        cur.accounts.add(label);
        senderMap.set(addr, cur);
      }
      const subject = (env.subject ?? "")
        .replace(/^((aw|re|fwd|fw|wg)\s*:\s*)+/i, "")
        .toLowerCase();
      for (const raw of subject.split(/[^a-zäöüß-]+/i)) {
        const w = raw.trim();
        if (w.length < 4 || STOPWORDS.has(w)) continue;
        wordMap.set(w, (wordMap.get(w) ?? 0) + 1);
      }
    }
  }

  const senders: SenderSuggestion[] = [...senderMap.entries()]
    .filter(([addr, v]) => v.count >= 2 && !covered(addr))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([addr, v]) => ({ value: addr, name: v.name, count: v.count, accounts: [...v.accounts] }));

  const keywords: KeywordSuggestion[] = [...wordMap.entries()]
    .filter(([w, n]) => n >= 3 && !covered(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w, n]) => ({ value: w.charAt(0).toUpperCase() + w.slice(1), count: n }));

  return { senders, keywords, total };
}

export async function runMailSuggest(): Promise<SuggestResult> {
  const hints: string[] = [];
  const accounts = await loadAccounts(hints);
  if (accounts.length === 0) {
    return {
      configured: false,
      analysierte_mails: 0,
      senders: [],
      keywords: [],
      hinweise: ["Kein Postfach mit Zugangsdaten verbunden – zuerst unter „Postfächer“ ein Konto anlegen.", ...hints],
    };
  }

  const d = await getDb();
  const rules = await d.all<{ kind: string; value: string }>("SELECT kind, value FROM mail_rules");

  const perAccount: { label: string; envelopes: Envelope[] }[] = [];
  for (const acc of accounts) {
    perAccount.push({ label: acc.label, envelopes: await fetchSentEnvelopes(acc, hints) });
  }

  const { senders, keywords, total } = analyzeEnvelopes(
    perAccount,
    accounts.map((a) => a.user),
    rules
  );

  if (total === 0 && hints.length === 0) {
    hints.push("Keine gesendeten Mails im Analysezeitraum gefunden.");
  }

  return { configured: true, analysierte_mails: total, senders, keywords, hinweise: hints };
}
