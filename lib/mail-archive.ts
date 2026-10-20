import { ImapFlow, type FetchMessageObject, type FetchQueryObject } from "imapflow";
import type { DB } from "@/lib/db";
import type { MailAccountEnv } from "@/lib/mail-fetch";
import {
  BODY_PART_MAX_BYTES,
  archiveFolders,
  attachmentList,
  bodyParts,
  cleanText,
  htmlToText,
  type FolderInfo,
} from "@/lib/mail-parts";

/**
 * Postfach-Archiv: legt komplette Mails aller verbundenen Konten in der
 * Datenbank ab (Kopie, nur lesend – im Postfach wird nichts verändert).
 *
 * Pro Konto + Ordner merkt sich `mail_sync`, bis zu welcher UID schon
 * archiviert ist. Jeder Lauf
 * 1. holt alle NEUEN Mails (UID > max_uid), älteste zuerst, und
 * 2. lädt mit dem restlichen Zeitbudget ÄLTERE Mails nach (UID < min_uid,
 *    höchstens ARCHIVE_DAYS zurück), neueste zuerst.
 * Bricht das Budget ab, geht es beim nächsten Lauf an derselben Stelle weiter.
 */

export const ARCHIVE_DAYS = Number(process.env.MAIL_ARCHIVE_DAYS || 400);
const BATCH = 40;
const BODY_TEXT_MAX = 200_000;
const HTML_MAX = 600_000;

export function openImap(acc: MailAccountEnv): ImapFlow {
  return new ImapFlow({
    host: acc.host,
    port: acc.port,
    secure: true,
    auth: { user: acc.user, pass: acc.pass },
    logger: false,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
  });
}

type SyncRow = { uidvalidity: string; max_uid: number; min_uid: number; backfill_done: number };

function addrList(list: { name?: string; address?: string }[] | undefined): string {
  return (list || [])
    .map((a) => (a.name && a.address ? `${a.name} <${a.address}>` : a.address || a.name || ""))
    .filter(Boolean)
    .join(", ");
}

function headerValue(headers: Buffer | undefined, name: string): string {
  if (!headers) return "";
  const text = headers.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
  const m = text.match(new RegExp(`^${name}:\\s*(.*)$`, "im"));
  return m ? m[1].trim() : "";
}

async function saveSync(d: DB, account: string, folder: string, s: SyncRow) {
  await d.run(
    `INSERT INTO mail_sync (account, folder, uidvalidity, max_uid, min_uid, backfill_done, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (account, folder) DO UPDATE SET uidvalidity = excluded.uidvalidity, max_uid = excluded.max_uid,
       min_uid = excluded.min_uid, backfill_done = excluded.backfill_done, updated_at = excluded.updated_at`,
    [account, folder, s.uidvalidity, s.max_uid, s.min_uid, s.backfill_done, new Date().toISOString()]
  );
}

/** Speichert eine Mail (Kopf + Text + HTML + Anhangsliste). Doppelte werden ignoriert. */
async function storeMessage(
  client: ImapFlow,
  d: DB,
  account: string,
  folder: string,
  uidvalidity: string,
  msg: FetchMessageObject
): Promise<boolean> {
  const exists = await d.get("SELECT 1 AS x FROM mails WHERE account = ? AND folder = ? AND uidvalidity = ? AND uid = ?", [
    account,
    folder,
    uidvalidity,
    msg.uid,
  ]);
  if (exists) return false;

  const parts = bodyParts(msg.bodyStructure).filter((p) => p.size <= BODY_PART_MAX_BYTES);
  let plain = "";
  let html = "";
  if (parts.length) {
    const got = await client.downloadMany(
      String(msg.uid),
      parts.map((p) => p.part),
      { uid: true }
    );
    for (const p of parts) {
      const content = got[p.part]?.content;
      if (!content) continue;
      const s = content.toString("utf8");
      if (p.kind === "plain") plain = s;
      else html = s;
    }
  }
  const text = plain.trim() ? plain : html ? htmlToText(html) : "";
  const env = msg.envelope;
  const date = new Date(env?.date ?? msg.internalDate ?? Date.now()).toISOString();

  const row = [
    account,
    folder,
    uidvalidity,
    msg.uid,
    cleanText(env?.messageId || "", 500),
    cleanText(addrList(env?.from), 1000),
    cleanText(addrList(env?.to), 4000),
    cleanText(addrList(env?.cc), 4000),
    cleanText(addrList(env?.replyTo), 1000),
    cleanText(env?.subject || "(ohne Betreff)", 1000),
    date,
    cleanText(text, BODY_TEXT_MAX),
    html ? 1 : 0,
    JSON.stringify(attachmentList(msg.bodyStructure)),
    [...(msg.flags || [])].join(" "),
    cleanText(env?.inReplyTo || "", 1000),
    cleanText(headerValue(msg.headers, "references"), 4000),
    Number(msg.size || 0),
  ];
  const cols =
    "account, folder, uidvalidity, uid, message_id, from_addr, to_addr, cc_addr, reply_to, subject, date, body_text, has_html, attachments, flags, in_reply_to, references_hdr, size";
  const placeholders = row.map(() => "?").join(",");
  let id: number;
  if (d.dialect === "postgres") {
    const r = await d.all<{ id: number }>(
      `INSERT INTO mails (${cols}) VALUES (${placeholders}) ON CONFLICT (account, folder, uidvalidity, uid) DO NOTHING RETURNING id`,
      row
    );
    if (!r[0]) return false;
    id = Number(r[0].id);
  } else {
    id = await d.insert(`INSERT OR IGNORE INTO mails (${cols}) VALUES (${placeholders})`, row);
    if (!id) return false;
  }
  if (html) {
    await d.run("INSERT INTO mail_html (mail_id, html) VALUES (?,?) ON CONFLICT (mail_id) DO NOTHING", [
      id,
      cleanText(html, HTML_MAX),
    ]);
  }
  return true;
}

/** Eine kaputte Mail darf den Ordner nicht blockieren: dann nur Kopfdaten ablegen. */
async function storeSafe(
  client: ImapFlow,
  d: DB,
  account: string,
  folder: string,
  uidvalidity: string,
  msg: FetchMessageObject
): Promise<boolean> {
  try {
    return await storeMessage(client, d, account, folder, uidvalidity, msg);
  } catch (e) {
    if (!client.usable) throw e; // Verbindung weg → Lauf für dieses Konto beenden
    const env = msg.envelope;
    await d.run(
      `INSERT INTO mails (account, folder, uidvalidity, uid, message_id, from_addr, to_addr, subject, date, body_text, attachments, flags, size)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (account, folder, uidvalidity, uid) DO NOTHING`,
      [
        account,
        folder,
        uidvalidity,
        msg.uid,
        cleanText(env?.messageId || "", 500),
        cleanText(addrList(env?.from), 1000),
        cleanText(addrList(env?.to), 4000),
        cleanText(env?.subject || "(ohne Betreff)", 1000),
        new Date(env?.date ?? msg.internalDate ?? Date.now()).toISOString(),
        `[Inhalt konnte nicht geladen werden: ${e instanceof Error ? e.message : String(e)}]`,
        JSON.stringify(attachmentList(msg.bodyStructure)),
        [...(msg.flags || [])].join(" "),
        Number(msg.size || 0),
      ]
    );
    return true;
  }
}

const FETCH_QUERY: FetchQueryObject = {
  uid: true,
  envelope: true,
  internalDate: true,
  bodyStructure: true,
  flags: true,
  size: true,
  headers: ["references"],
};

/** Archiviert einen Ordner so weit, wie das Budget reicht. */
async function archiveFolder(
  client: ImapFlow,
  d: DB,
  account: string,
  folder: string,
  deadline: number
): Promise<{ neu: number; fertig: boolean }> {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  let neu = 0;
  try {
    const mb = client.mailbox;
    if (!mb || typeof mb === "boolean") return { neu, fertig: true };
    const uidvalidity = String(mb.uidValidity ?? "");
    const prev = await d.get<SyncRow>(
      "SELECT uidvalidity, max_uid, min_uid, backfill_done FROM mail_sync WHERE account = ? AND folder = ?",
      [account, folder]
    );
    // Neue UIDVALIDITY = Ordner wurde serverseitig neu aufgebaut → von vorne
    const s: SyncRow =
      prev && prev.uidvalidity === uidvalidity
        ? { ...prev, max_uid: Number(prev.max_uid), min_uid: Number(prev.min_uid), backfill_done: Number(prev.backfill_done) }
        : { uidvalidity, max_uid: 0, min_uid: 0, backfill_done: 0 };
    if (!mb.exists) {
      await saveSync(d, account, folder, { ...s, backfill_done: 1 });
      return { neu, fertig: true };
    }

    const since = new Date(Date.now() - ARCHIVE_DAYS * 86_400_000);
    const inWindow = (((await client.search({ since }, { uid: true })) || []) as number[]).sort((a, b) => a - b);

    // 1. Neue Mails (beim allerersten Lauf: die neuesten zuerst, damit Aktuelles sofort da ist)
    let todo: number[];
    if (s.max_uid === 0) {
      todo = inWindow.slice(-BATCH).reverse();
    } else {
      const newer = (((await client.search({ uid: `${s.max_uid + 1}:*` }, { uid: true })) || []) as number[])
        .filter((u) => u > s.max_uid)
        .sort((a, b) => a - b);
      todo = newer.slice(0, BATCH);
    }
    while (todo.length && Date.now() < deadline) {
      const msgs = await client.fetchAll(todo.join(","), FETCH_QUERY, { uid: true });
      msgs.sort((a, b) => (s.max_uid === 0 ? b.uid - a.uid : a.uid - b.uid));
      for (const m of msgs) {
        if (Date.now() > deadline) break;
        if (await storeSafe(client, d, account, folder, uidvalidity, m)) neu++;
        s.max_uid = Math.max(s.max_uid, m.uid);
        s.min_uid = s.min_uid === 0 ? m.uid : Math.min(s.min_uid, m.uid);
      }
      await saveSync(d, account, folder, s);
      if (Date.now() > deadline) return { neu, fertig: false };
      const rest = (((await client.search({ uid: `${s.max_uid + 1}:*` }, { uid: true })) || []) as number[]).filter(
        (u) => u > s.max_uid
      );
      todo = rest.sort((a, b) => a - b).slice(0, BATCH);
    }

    // 2. Ältere Mails nachladen (neueste zuerst)
    while (!s.backfill_done && Date.now() < deadline) {
      const older = inWindow.filter((u) => s.min_uid === 0 || u < s.min_uid).slice(-BATCH).reverse();
      if (!older.length) {
        s.backfill_done = 1;
        break;
      }
      const msgs = await client.fetchAll(older.join(","), FETCH_QUERY, { uid: true });
      msgs.sort((a, b) => b.uid - a.uid);
      for (const m of msgs) {
        if (Date.now() > deadline) break;
        if (await storeSafe(client, d, account, folder, uidvalidity, m)) neu++;
        s.min_uid = s.min_uid === 0 ? m.uid : Math.min(s.min_uid, m.uid);
        s.max_uid = Math.max(s.max_uid, m.uid);
      }
      // Mails, die der Server nicht mehr liefert, nicht endlos neu anfragen
      const lowest = Math.min(...older);
      if (msgs.length === 0 || Date.now() <= deadline) s.min_uid = Math.min(s.min_uid || lowest, lowest);
      await saveSync(d, account, folder, s);
    }
    await saveSync(d, account, folder, s);
    return { neu, fertig: Boolean(s.backfill_done) && Date.now() < deadline };
  } finally {
    lock.release();
  }
}

/**
 * Nachbesserung für schon archivierte Mails: Bis Okt. 2026 wurden eingebettete
 * Fotos/PDFs (z. B. Verträge per Handy-Mail) nicht als Anhang erkannt. Mails ohne
 * Anhangsliste, aber mit nennenswerter Größe, werden einmal neu eingelesen
 * (nur BODYSTRUCTURE, nur lesend). Der Fortschritt steht in app_config.
 */
const REPAIR_MIN_SIZE = 50_000;
const REPAIR_BATCH = 60;

async function repairAttachments(client: ImapFlow, d: DB, account: string, deadline: number): Promise<number> {
  const key = `mail_anhang_repair:${account}`;
  const state = await d.get<{ value: string }>("SELECT value FROM app_config WHERE key = ?", [key]);
  if (state?.value === "fertig") return 0;
  const lastId = Number(state?.value || 0);
  const rows = await d.all<{ id: number; folder: string; uid: number; uidvalidity: string }>(
    `SELECT id, folder, uid, uidvalidity FROM mails
     WHERE account = ? AND id > ? AND attachments = '[]' AND size >= ? ORDER BY id LIMIT ?`,
    [account, lastId, REPAIR_MIN_SIZE, REPAIR_BATCH]
  );
  const saveState = (v: string) =>
    d.run("INSERT INTO app_config (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, v]);
  if (!rows.length) {
    await saveState("fertig");
    return 0;
  }
  let fixed = 0;
  let done = lastId;
  const byFolder = new Map<string, typeof rows>();
  for (const r of rows) byFolder.set(r.folder, [...(byFolder.get(r.folder) || []), r]);
  for (const [folder, list] of byFolder) {
    if (deadline - Date.now() < 3_000) break;
    let lock;
    try {
      lock = await client.getMailboxLock(folder, { readOnly: true });
    } catch {
      continue; // Ordner gibt es nicht mehr
    }
    try {
      const mb = client.mailbox;
      const uv = mb && typeof mb !== "boolean" ? String(mb.uidValidity ?? "") : "";
      const valid = list.filter((r) => r.uidvalidity === uv);
      if (valid.length) {
        const msgs = await client.fetchAll(valid.map((r) => r.uid).join(","), { uid: true, bodyStructure: true }, { uid: true });
        for (const m of msgs) {
          const list2 = attachmentList(m.bodyStructure);
          const row = valid.find((r) => Number(r.uid) === m.uid);
          if (row && list2.length) {
            await d.run("UPDATE mails SET attachments = ? WHERE id = ?", [JSON.stringify(list2), row.id]);
            fixed++;
          }
        }
      }
    } finally {
      lock.release();
    }
  }
  if (deadline - Date.now() >= 3_000) done = Math.max(done, ...rows.map((r) => Number(r.id)));
  if (done > lastId) await saveState(String(done));
  return fixed;
}

export type ArchiveResult = { accounts: { label: string; neu: number }[]; neu: number; hinweise: string[] };

/** Archiviert alle Konten nacheinander, solange das Zeitbudget reicht. */
export async function runMailArchive(d: DB, accounts: MailAccountEnv[], deadline: number): Promise<ArchiveResult> {
  const hints: string[] = [];
  const perAccount: { label: string; neu: number }[] = [];
  let total = 0;
  if (!accounts.length) return { accounts: [], neu: 0, hinweise: [] };

  // Rotation, damit bei knappem Budget jedes Konto drankommt
  const rot = await d.all<{ value: string }>(
    "INSERT INTO app_config (key, value) VALUES ('mail_archive_rotation','1') ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(app_config.value AS INTEGER) + 1 AS TEXT) RETURNING value"
  );
  const offset = (Number(rot[0]?.value) || 0) % accounts.length;
  const ordered = [...accounts.slice(offset), ...accounts.slice(0, offset)];

  for (const acc of ordered) {
    if (deadline - Date.now() < 8_000) break;
    const client = openImap(acc);
    let neu = 0;
    try {
      await client.connect();
      const list = (await client.list()) as FolderInfo[];
      for (const f of archiveFolders(list)) {
        if (deadline - Date.now() < 4_000) break;
        try {
          const r = await archiveFolder(client, d, acc.label, f.path, deadline);
          neu += r.neu;
        } catch (e) {
          hints.push(`${acc.label} / ${f.path}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (deadline - Date.now() > 6_000) {
        try {
          const fixed = await repairAttachments(client, d, acc.label, deadline);
          if (fixed) hints.push(`${acc.label}: ${fixed} eingebettete Anhänge nachgetragen`);
        } catch (e) {
          hints.push(`${acc.label} / Anhänge nachtragen: ${e instanceof Error ? e.message : String(e)}`);
        }
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
    perAccount.push({ label: acc.label, neu });
    total += neu;
  }
  return { accounts: perAccount, neu: total, hinweise: hints };
}
