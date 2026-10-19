import { ImapFlow } from "imapflow";
import { getDb, type DB } from "@/lib/db";
import { accountsFromDb, accountsFromEnv, belegCandidates, ingestAttachments, type MailAccountEnv } from "@/lib/mail-fetch";
import { withLock } from "@/lib/run-lock";

/**
 * Einmaliges Nachholen: durchsucht die letzten N Tage ALLER Postfächer nach
 * Beleg-Anhängen – unabhängig von mail_seen, nur für den Buchhaltungs-Eingang
 * (kein Digest, keine Wissens-Notizen). Dedupe über SHA-256 macht Wiederholungen
 * unschädlich.
 *
 * Läuft in Etappen innerhalb des Zeitbudgets; der Fortschritt (letzte UID je
 * Konto) liegt in app_config.buch_nachholen. Die Seite ruft den Endpunkt so
 * lange erneut auf, bis `fertig` true ist.
 */

export const MAX_TAGE = 60;
const STATE_KEY = "buch_nachholen";
const BATCH = 40;
const ACCOUNT_MIN_MS = 15_000;

type KontoState = { label: string; uidValidity: string; lastUid: number; done: boolean; verarbeitet: number; gesamt: number };
type State = { tage: number; since: string; konten: Record<string, KontoState>; belege: number };

export type NachholenResult = {
  fertig: boolean;
  tage: number;
  belege_neu: number;
  belege_gesamt: number;
  konten: { label: string; verarbeitet: number; gesamt: number; fertig: boolean }[];
  hinweise: string[];
};

async function loadState(d: DB): Promise<State | null> {
  const row = await d.get<{ value: string }>("SELECT value FROM app_config WHERE key = ?", [STATE_KEY]);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as State;
  } catch {
    return null;
  }
}

async function saveState(d: DB, s: State) {
  await d.run(
    "INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [STATE_KEY, JSON.stringify(s)]
  );
}

const keyOf = (a: MailAccountEnv) => `${a.user.toLowerCase()}@${a.host.toLowerCase()}`;

async function scanAccount(acc: MailAccountEnv, st: KontoState, since: Date, d: DB, hints: string[], deadline: number) {
  let neu = 0;
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
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const validity = client.mailbox ? String(client.mailbox.uidValidity) : "";
      if (st.uidValidity && st.uidValidity !== validity) {
        st.lastUid = 0; // Postfach wurde neu nummeriert → von vorn
      }
      st.uidValidity = validity;
      const uids = (((await client.search({ since }, { uid: true })) || []) as number[]).sort((a, b) => a - b);
      st.gesamt = uids.length;
      const todo = uids.filter((u) => u > st.lastUid);
      outer: for (let i = 0; i < todo.length; i += BATCH) {
        if (Date.now() > deadline) break;
        const batch = todo.slice(i, i + BATCH);
        const msgs = await client.fetchAll(batch, { uid: true, envelope: true, internalDate: true, bodyStructure: true }, { uid: true });
        msgs.sort((a, b) => a.uid - b.uid);
        for (const msg of msgs) {
          if (Date.now() > deadline) break outer;
          if (belegCandidates(msg.bodyStructure).length > 0) {
            const from =
              msg.envelope?.from?.map((a) => `${a.name ? a.name + " " : ""}<${a.address}>`).join(", ") || "unbekannt";
            const ing = await ingestAttachments(
              client,
              msg.uid,
              msg.bodyStructure,
              {
                label: acc.label,
                user: acc.user,
                messageId: msg.envelope?.messageId || `${acc.host}:${msg.uid}`,
                from,
                subject: msg.envelope?.subject || "(ohne Betreff)",
                to: msg.envelope?.to?.map((a) => a.address || "").join(", ") || "",
                date: new Date(msg.internalDate ?? Date.now()).toISOString(),
              },
              d,
              hints,
              deadline + 5_000
            );
            neu += ing.neu;
            if (!ing.complete) break outer; // diese Mail beim nächsten Aufruf erneut
          }
          st.lastUid = msg.uid;
        }
      }
      st.verarbeitet = uids.filter((u) => u <= st.lastUid).length;
      st.done = st.verarbeitet >= uids.length;
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
  return neu;
}

export async function runNachholen(opts: { tage: number; neustart?: boolean; deadline: number }): Promise<NachholenResult | { skipped: string }> {
  const d = await getDb();
  const result = await withLock(d, "buch_nachholen", async () => {
    const hints: string[] = [];
    const tage = Math.min(MAX_TAGE, Math.max(1, Math.floor(opts.tage)));
    let state = await loadState(d);
    if (!state || opts.neustart || state.tage !== tage) {
      const since = new Date(Date.now() - tage * 86_400_000).toISOString().slice(0, 10);
      state = { tage, since, konten: {}, belege: 0 };
    }
    const accounts = [...(await accountsFromDb(d, hints)), ...accountsFromEnv()];
    if (accounts.length === 0) hints.push("Keine Postfächer mit Zugangsdaten konfiguriert.");

    let neu = 0;
    const base = state.belege;
    for (const acc of accounts) {
      const k = keyOf(acc);
      const st = (state.konten[k] ??= { label: acc.label, uidValidity: "", lastUid: 0, done: false, verarbeitet: 0, gesamt: 0 });
      st.label = acc.label;
      if (st.done) continue;
      if (opts.deadline - Date.now() < ACCOUNT_MIN_MS) break;
      neu += await scanAccount(acc, st, new Date(`${state.since}T00:00:00Z`), d, hints, opts.deadline);
      state.belege = base + neu;
      await saveState(d, state); // Fortschritt nach jedem Konto sichern
    }
    state.belege = base + neu;
    await saveState(d, state);

    const konten = accounts.map((a) => {
      const st = state!.konten[keyOf(a)];
      return { label: a.label, verarbeitet: st?.verarbeitet ?? 0, gesamt: st?.gesamt ?? 0, fertig: Boolean(st?.done) };
    });
    return {
      fertig: konten.every((k) => k.fertig), // ohne Konten: nichts zu tun
      tage,
      belege_neu: neu,
      belege_gesamt: state.belege,
      konten,
      hinweise: hints,
    };
  });
  return result ?? { skipped: "läuft bereits" };
}
