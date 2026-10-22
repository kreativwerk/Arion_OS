import { getConfig, getDb, todayIso } from "@/lib/db";
import { downloadFile, driveConfigured, ensureChildFolder, findFolderByName, listInboxFiles, moveFile, type DriveInboxFile } from "@/lib/google-drive";
import { isLetterMime } from "@/lib/letter-analyze";
import { analyzeStoredLetter, LETTER_MAX_SIZE } from "@/lib/letter-store";
import { sendPushToAll } from "@/lib/push";
import { withLock } from "@/lib/run-lock";

/**
 * Briefkasten: Der Drucker (Brother Web Connect → Google Drive) legt die
 * gescannte Tagespost in den Drive-Ordner „Letterbox“. Dieser Lauf holt jede
 * neue Datei, legt sie im Post-Modul an, verschiebt sie in Drive nach
 * „Letterbox/_verarbeitet“ (nichts wird gelöscht) und lässt Claude den Stapel
 * in einzelne Briefe zerlegen und lesen – inkl. Firma (Arion, Fleet Fix,
 * Kreativwerk, Wohnwerk, Privat).
 *
 * Läuft ohne Büro-Mac: pg_cron ruft /api/cron/letterbox alle 5 Minuten auf,
 * zusätzlich Knopf „Briefkasten abrufen“ auf /post.
 *
 * Ordner: DRIVE_LETTERBOX_ID (Env) oder app_config.letterbox_folder_id,
 * sonst der Drive-Ordner mit dem Namen „Letterbox“.
 */

export const LETTERBOX_FOLDER_NAME = "Letterbox";
export const LETTERBOX_DONE_NAME = "_verarbeitet";
/** Erst übernehmen, wenn der Drucker fertig hochgeladen hat. */
const MIN_AGE_MS = 60_000;

const MIME_BY_EXT: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

/** Welche Dateien im Ordner übernommen werden. */
export function pickLetterboxFiles(files: DriveInboxFile[], known: Set<string>, now = Date.now()): DriveInboxFile[] {
  return files.filter((f) => {
    if (known.has(f.id)) return false;
    if (now - Date.parse(f.modifiedTime) < MIN_AGE_MS) return false;
    if (f.size > LETTER_MAX_SIZE) return false;
    return isLetterMime(letterboxMime(f));
  });
}

export function letterboxMime(f: Pick<DriveInboxFile, "name" | "mimeType">): string {
  if (isLetterMime(f.mimeType)) return f.mimeType;
  return MIME_BY_EXT[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? f.mimeType;
}

export function letterboxPushText(briefe: { sender: string | null; action: string | null; firma?: string | null }[]) {
  const n = briefe.length;
  const todo = briefe.filter((b) => (b.action ?? "").trim() && !/^(keine|nichts)\b/i.test((b.action ?? "").trim())).length;
  const firmen = [...new Set(briefe.map((b) => (b.firma ?? "").trim()).filter((f) => f && f !== "Unklar"))];
  const alle = [...new Set(briefe.map((b) => (b.sender ?? "").trim()).filter(Boolean))];
  const absender = alle.slice(0, 3);
  const von = absender.length ? `Von ${absender.join(", ")}${alle.length > absender.length ? " …" : ""}` : "Jetzt in Arion OS ansehen";
  return {
    title: `Briefkasten: ${n} ${n === 1 ? "neuer Brief" : "neue Briefe"}${todo ? ` · ${todo} mit To-do` : ""}`,
    body: firmen.length ? `${firmen.join(" · ")} – ${von}` : von,
    url: "/post",
  };
}

async function folderId(deadline: number): Promise<string | null> {
  const fromEnv = process.env.DRIVE_LETTERBOX_ID?.trim();
  if (fromEnv) return fromEnv;
  const cfg = await getConfig();
  if (cfg.letterbox_folder_id?.trim()) return cfg.letterbox_folder_id.trim();
  const found = await findFolderByName(LETTERBOX_FOLDER_NAME, { deadline });
  if (found) {
    const d = await getDb();
    await d.run(
      "INSERT INTO app_config (key, value) VALUES ('letterbox_folder_id', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [found]
    );
  }
  return found;
}

export type LetterboxResult = { ok: boolean; neu: number; briefe: number; offen: number; hinweis?: string };

/** Ein Lauf zur Zeit – Cron und Knopf können sich überschneiden. */
export async function runLetterbox(deadline = Date.now() + 240_000): Promise<LetterboxResult> {
  const res = await withLock(await getDb(), "letterbox", () => runLetterboxUnlocked(deadline), 6 * 60_000);
  return res ?? { ok: true, neu: 0, briefe: 0, offen: 0, hinweis: "Läuft gerade schon." };
}

async function runLetterboxUnlocked(deadline: number): Promise<LetterboxResult> {
  if (!(await driveConfigured())) return { ok: false, neu: 0, briefe: 0, offen: 0, hinweis: "Google Drive ist nicht verbunden." };
  const folder = await folderId(deadline);
  if (!folder) return { ok: false, neu: 0, briefe: 0, offen: 0, hinweis: `Drive-Ordner „${LETTERBOX_FOLDER_NAME}“ nicht gefunden.` };
  const done = await ensureChildFolder(folder, LETTERBOX_DONE_NAME, { deadline });
  const d = await getDb();
  const known = new Set(
    (await d.all<{ drive_file_id: string }>("SELECT drive_file_id FROM letters WHERE drive_file_id <> ''")).map((r) => r.drive_file_id)
  );

  // 1. Neue Dateien übernehmen und in Drive wegsortieren
  let neu = 0;
  for (const f of pickLetterboxFiles(await listInboxFiles(folder, { deadline }), known)) {
    if (deadline - Date.now() < 60_000) break;
    const data = await downloadFile(f.id, { deadline });
    const mime = letterboxMime(f);
    await d.insert(
      "INSERT INTO letters (subject, received_date, scanned_by, status, file_ref, mime, drive_file_id) VALUES (?,?,?,?,?,?,?)",
      [f.name.replace(/\.[^.]+$/, "").slice(0, 200) || "Briefkasten", todayIso(), "Briefkasten", "neu", f.name.slice(0, 300), mime, f.id]
    ).then((id) => d.run("INSERT INTO letter_blobs (letter_id, data) VALUES (?,?)", [id, data]));
    await moveFile(f.id, folder, done, { deadline }).catch((e) => console.error("[letterbox] Verschieben:", e));
    neu++;
  }

  // 2. Offene Briefkasten-Scans analysieren (auch Reste aus früheren Läufen)
  const pending = await d.all<{ id: number }>(
    "SELECT id FROM letters WHERE drive_file_id <> '' AND (summary IS NULL OR summary = '') AND (analysis_error IS NULL OR analysis_error = '') AND status = 'neu' ORDER BY id"
  );
  const ids: number[] = [];
  let offen = pending.length;
  for (const p of pending) {
    if (deadline - Date.now() < 120_000) break;
    const r = await analyzeStoredLetter(Number(p.id));
    if (r.error) await d.run("UPDATE letters SET analysis_error = ? WHERE id = ?", [r.error.slice(0, 500), p.id]);
    ids.push(...r.ids);
    offen--;
  }

  if (ids.length) {
    const rows = await d.all<{ sender: string | null; action: string | null; firma: string | null }>(
      `SELECT sender, action, firma FROM letters WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    await sendPushToAll(letterboxPushText(rows)).catch(() => {});
  }
  return { ok: true, neu, briefe: ids.length, offen };
}
