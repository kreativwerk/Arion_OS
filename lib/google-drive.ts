import { buildServiceAccountJwt, GOOGLE_TOKEN_URL, type ServiceAccountKey } from "@/lib/google-jwt";
import { firstFreeName } from "@/lib/buch-pages";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/secret-store";
import { oauthClientConfigured, refreshAccessToken } from "@/lib/google-oauth";

/**
 * Google-Drive-Ablage (ohne SDK, nur fetch). Zwei Anmeldewege:
 *
 * 1. „Mit Google verbinden“ (empfohlen für normale Google-Konten): OAuth-Client
 *    GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET, Refresh-Token
 *    verschlüsselt in app_config.google_drive_refresh (lib/google-oauth.ts).
 * 2. Service-Account (Workspace mit Admin-Konsole):
 *   GOOGLE_SERVICE_ACCOUNT_JSON   kompletter JSON-Schlüssel des Service-Accounts
 *   DRIVE_BUCHHALTUNG_ROOT_ID     ID des Ordners „Buchhaltung“ (geteilte Ablage oder freigegebener Ordner)
 *   GOOGLE_IMPERSONATE_USER       optional: Nutzer für domänenweite Delegation
 *                                 (nötig, wenn der Root-Ordner in „Meine Ablage“ liegt –
 *                                 Service-Accounts haben dort kein Speicherkontingent)
 *
 * Grundsätze: Es wird NIE etwas gelöscht oder überschrieben. Gleichnamige
 * Dateien bekommen " (2)", " (3)" … vor der Endung.
 */

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Bis 5 MB reicht ein Multipart-Upload, darüber verlangt Drive den Resumable-Upload. */
const MULTIPART_LIMIT = 5 * 1024 * 1024;

/** Gespeicherte OAuth-Verbindung („Mit Google verbinden“) – siehe lib/google-oauth.ts. */
type DriveAuth = { refreshEnc: string; rootId: string };
let authCache: { v: DriveAuth; at: number } | null = null;

async function driveAuth(): Promise<DriveAuth> {
  if (authCache && Date.now() - authCache.at < 60_000) return authCache.v;
  const d = await getDb();
  const rows = await d.all<{ key: string; value: string }>(
    "SELECT key, value FROM app_config WHERE key IN ('google_drive_refresh','drive_root_id')"
  );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const v = { refreshEnc: m.google_drive_refresh || "", rootId: (m.drive_root_id || "").trim() };
  authCache = { v, at: Date.now() };
  return v;
}

/** Nach Verbinden/Trennen sofort neu laden. */
export function resetDriveAuthCache() {
  authCache = null;
  tokenCache = null;
}

/** Welche Anmeldung genutzt wird: OAuth (Nutzerkonto) hat Vorrang vor dem Service-Account. */
async function authMode(): Promise<"oauth" | "service" | null> {
  const a = await driveAuth();
  if (a.refreshEnc && oauthClientConfigured()) return "oauth";
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return "service";
  return null;
}

export async function driveConfigured(): Promise<boolean> {
  try {
    return Boolean((await authMode()) && (await rootId()));
  } catch {
    return false;
  }
}

function serviceAccount(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON fehlt.");
  try {
    return JSON.parse(raw) as ServiceAccountKey;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON ist kein gültiges JSON.");
  }
}

async function rootId(): Promise<string> {
  const id = (process.env.DRIVE_BUCHHALTUNG_ROOT_ID?.trim() || (await driveAuth()).rootId).trim();
  if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error("DRIVE_BUCHHALTUNG_ROOT_ID fehlt oder ist ungültig.");
  return id;
}

let tokenCache: { token: string; exp: number } | null = null;

/** fetch mit lesbarer Fehlermeldung bei Netzwerkproblemen ("fetch failed" → Ursache). */
async function netFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const cause = (e as { cause?: { message?: string; code?: string } }).cause;
    const host = new URL(url).host;
    throw new Error(`${host} nicht erreichbar: ${cause?.code || cause?.message || (e instanceof Error ? e.message : String(e))}`);
  }
}

/** Optionaler Zeitpunkt (ms), bis zu dem alle Drive-Aufrufe fertig sein müssen. */
export type DriveOpts = { deadline?: number };

/** Timeout-Signal: höchstens `capMs`, nie über die Deadline hinaus (min. 1 s). */
function timeout(capMs: number, deadline?: number): AbortSignal {
  const left = deadline ? deadline - Date.now() : capMs;
  return AbortSignal.timeout(Math.max(1_000, Math.min(capMs, left)));
}

export async function getAccessToken(opts: DriveOpts = {}): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  if ((await authMode()) === "oauth") {
    const t = await refreshAccessToken(decryptSecret((await driveAuth()).refreshEnc), opts.deadline);
    tokenCache = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 };
    return t.access_token;
  }
  const key = serviceAccount();
  const assertion = buildServiceAccountJwt(key, SCOPE, undefined, process.env.GOOGLE_IMPERSONATE_USER || undefined);
  const res = await netFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: timeout(15_000, opts.deadline),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Google-Anmeldung fehlgeschlagen: ${data.error_description || data.error || res.status}`);
  }
  tokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

async function driveFetch<T>(
  url: string,
  init: RequestInit = {},
  opts: DriveOpts = {},
  capMs = 30_000
): Promise<{ data: T; res: Response }> {
  const token = await getAccessToken(opts);
  const res = await netFetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
    signal: timeout(capMs, opts.deadline),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 200);
    throw new Error(`Google Drive ${res.status}: ${msg}`);
  }
  return { data: data as T, res };
}

/** Escaping für Werte in Drive-Suchabfragen (q=…). */
function q(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const ALL_DRIVES = "supportsAllDrives=true&includeItemsFromAllDrives=true";

type DriveFile = { id: string; name: string; webViewLink?: string };

async function listChildren(parentId: string, query: string, opts: DriveOpts = {}): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${q(parentId)}' in parents and trashed = false and ${query}`,
      fields: "nextPageToken, files(id, name, webViewLink)",
      pageSize: "200",
      corpora: "allDrives",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const { data } = await driveFetch<{ files: DriveFile[]; nextPageToken?: string }>(
      `${DRIVE}/files?${params}&${ALL_DRIVES}`,
      {},
      opts
    );
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken && out.length < 2000);
  return out;
}

/** Ordnerpfad relativ zum Buchhaltungs-Root zerlegen und prüfen. */
export function splitDrivePath(path: string): string[] {
  const parts = path
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 12) throw new Error("Zielpfad hat zu viele Ebenen.");
  for (const p of parts) {
    if (p === "." || p === "..") throw new Error("Zielpfad darf kein . oder .. enthalten.");
    if (p.length > 200) throw new Error("Ordnername zu lang.");
  }
  return parts;
}

const folderCache = new Map<string, string>();

/** Läuft den Pfad vom Root aus ab (exakter Name) und legt fehlende Ordner an. */
export async function resolveFolderPath(path: string, create = true, opts: DriveOpts = {}): Promise<string | null> {
  const root = await rootId();
  let parent = root;
  let walked = "";
  for (const name of splitDrivePath(path)) {
    walked += `/${name}`;
    const cached = folderCache.get(root + walked);
    if (cached) {
      parent = cached;
      continue;
    }
    const found = await listChildren(parent, `mimeType = '${FOLDER_MIME}' and name = '${q(name)}'`, opts);
    let id = found.find((f) => f.name === name)?.id;
    if (!id) {
      if (!create) return null;
      const { data } = await driveFetch<DriveFile>(`${DRIVE}/files?${ALL_DRIVES}&fields=id,name`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
      }, opts);
      id = data.id;
    }
    folderCache.set(root + walked, id);
    parent = id;
  }
  return parent;
}

export type UploadResult = { id: string; name: string; url: string };

/** Lädt eine Datei hoch – überschreibt nie; bei Namensgleichheit " (2)", " (3)" … */
/** Sucht im Ordner eine Datei mit appProperties ablageId = id (Idempotenz:
 *  ein früherer, abgebrochener Lauf hat sie evtl. schon hochgeladen). */
export async function findByAblageId(folderId: string, ablageId: number, opts: DriveOpts = {}): Promise<UploadResult | null> {
  const hit = (
    await listChildren(folderId, `appProperties has { key='ablageId' and value='${String(Math.floor(ablageId))}' }`, opts)
  )[0];
  return hit ? { id: hit.id, name: hit.name, url: hit.webViewLink ?? `https://drive.google.com/file/d/${hit.id}/view` } : null;
}

export async function uploadFile(
  folderId: string,
  name: string,
  bytes: Uint8Array,
  mime: string,
  opts: DriveOpts & { appProperties?: Record<string, string> } = {}
): Promise<UploadResult> {
  const cleanName = name.replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, 240) || "Beleg.pdf";
  const dot = cleanName.lastIndexOf(".");
  const stem = dot > 0 ? cleanName.slice(0, dot) : cleanName;
  const similar = await listChildren(folderId, `name contains '${q(stem)}'`, opts);
  const finalName = firstFreeName(cleanName, similar.map((f) => f.name));
  const metadata = { name: finalName, parents: [folderId], mimeType: mime, ...(opts.appProperties ? { appProperties: opts.appProperties } : {}) };
  const fields = "fields=id,name,webViewLink";

  let file: DriveFile;
  if (bytes.length <= MULTIPART_LIMIT) {
    const boundary = `arion${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--`);
    const body = Buffer.concat([head, Buffer.from(bytes), tail]);
    ({ data: file } = await driveFetch<DriveFile>(`${UPLOAD}/files?uploadType=multipart&${ALL_DRIVES}&${fields}`, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    }, opts, 60_000));
  } else {
    const { res } = await driveFetch<unknown>(`${UPLOAD}/files?uploadType=resumable&${ALL_DRIVES}&${fields}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": mime,
        "x-upload-content-length": String(bytes.length),
      },
      body: JSON.stringify(metadata),
    }, opts);
    const session = res.headers.get("location");
    if (!session || !session.startsWith("https://www.googleapis.com/")) throw new Error("Drive lieferte keine Upload-Sitzung.");
    ({ data: file } = await driveFetch<DriveFile>(session, {
      method: "PUT",
      headers: { "content-type": mime },
      body: new Uint8Array(bytes),
    }, opts, 90_000));
  }
  return {
    id: file.id,
    name: file.name ?? finalName,
    url: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
  };
}
