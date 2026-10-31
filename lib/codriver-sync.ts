import { getDb, nowExpr, type DB } from "@/lib/db";
import { decodeFields } from "@/lib/codriver-redact";

/**
 * Codriver → Arion OS: Arion-Daten aus Codriver (Firestore) als redigierte
 * Kopie in `codriver_docs` spiegeln – ohne den Mac und ohne Admin-Schlüssel.
 *
 * Anmeldung wie in der Codriver-Web-App mit einem eigenen **Disponenten-Konto**
 * („Arion OS“), das der DSP-Admin in Codriver anlegt. Die Firestore-Regeln
 * erlauben einem Disponenten nur den Namensraum seines Admins
 * (`users/{parentAdminUid}/…`) – fremde DSPs sind technisch unerreichbar.
 *
 *   CODRIVER_EMAIL / CODRIVER_PASSWORD   Disponenten-Konto
 *   CODRIVER_FIREBASE_API_KEY            optional (Standard: öffentlicher Web-Key von codriver-eu)
 *   CODRIVER_PROJECT_ID                  optional (Standard: codriver-eu)
 *
 * Arion OS liest nur. Es wird nichts in Codriver geschrieben oder gelöscht.
 */

// Öffentliche Firebase-Web-Konfiguration der Codriver-App (steht in jeder ausgelieferten Web-App).
const DEFAULT_API_KEY = "AIzaSyBDlPo5SIBYhTVjC85drdJ8b2ocN6KxXoA";
const DEFAULT_PROJECT = "codriver-eu";

export const DEFAULT_COLLECTIONS = [
  "drivers",
  "vehicles",
  // Unterordner vehicles/{id}/documents (TÜV/HU usw.) – braucht „vehicles“ davor
  "vehicle_documents",
  "fleet_vehicle_extras",
  "fleet_events",
  "calendar_events",
  "absence_requests",
  "incident_reports",
  "shift_plans",
  "reports",
  "scores",
];

const PAGE_SIZE = 300;

export function codriverConfigured(): boolean {
  return Boolean(process.env.CODRIVER_EMAIL && process.env.CODRIVER_PASSWORD);
}

const apiKey = () => process.env.CODRIVER_FIREBASE_API_KEY || DEFAULT_API_KEY;
const project = () => process.env.CODRIVER_PROJECT_ID || DEFAULT_PROJECT;
const docsBase = () => `https://firestore.googleapis.com/v1/projects/${project()}/databases/(default)/documents`;

let session: { idToken: string; uid: string; exp: number } | null = null;

async function jsonFetch<T>(url: string, init: RequestInit, deadline: number): Promise<T> {
  const left = Math.max(1_000, Math.min(20_000, deadline - Date.now()));
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(left) });
  } catch (e) {
    throw new Error(`${new URL(url).host} nicht erreichbar: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Codriver ${res.status}: ${body?.error?.message ?? "Fehler"}`);
  return body;
}

async function signIn(deadline: number) {
  if (session && session.exp > Date.now() + 120_000) return session;
  const r = await jsonFetch<{ idToken: string; localId: string; expiresIn: string }>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey()}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: process.env.CODRIVER_EMAIL, password: process.env.CODRIVER_PASSWORD, returnSecureToken: true }),
    },
    deadline
  ).catch((e: Error) => {
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(e.message)) {
      throw new Error("Codriver-Anmeldung abgelehnt – CODRIVER_EMAIL/CODRIVER_PASSWORD prüfen.");
    }
    throw e;
  });
  session = { idToken: r.idToken, uid: r.localId, exp: Date.now() + Number(r.expiresIn || 3600) * 1000 };
  return session;
}

type FsDoc = { name: string; fields?: Record<string, never>; updateTime?: string };

async function getDoc(path: string, deadline: number): Promise<FsDoc> {
  const s = await signIn(deadline);
  return jsonFetch<FsDoc>(`${docsBase()}/${path}`, { headers: { authorization: `Bearer ${s.idToken}` } }, deadline);
}

/** Namensraum der DSP: beim Disponenten der Admin (parentAdminUid), sonst das Konto selbst. */
async function dspUid(deadline: number): Promise<string> {
  const s = await signIn(deadline);
  const me = await getDoc(`users/${s.uid}`, deadline);
  const f = decodeFields(me.fields ?? {}) as { role?: string; parentAdminUid?: string };
  if (f.role === "dispatcher") {
    if (!f.parentAdminUid) throw new Error("Codriver-Disponentenkonto ohne zugeordneten Admin.");
    return f.parentAdminUid;
  }
  if (f.role === "admin") return s.uid;
  throw new Error(`Codriver-Konto hat die Rolle „${f.role || "?"}“ – bitte ein Disponenten-Konto verwenden.`);
}

type State = { i: number; pageToken: string; passStart: string };

async function loadState(d: DB): Promise<State> {
  const row = await d.get<{ value: string }>("SELECT value FROM app_config WHERE key = 'codriver_sync'");
  try {
    const s = JSON.parse(row?.value || "{}") as Partial<State>;
    return { i: Number(s.i) || 0, pageToken: s.pageToken || "", passStart: s.passStart || "" };
  } catch {
    return { i: 0, pageToken: "", passStart: "" };
  }
}

async function setConfig(d: DB, key: string, value: string) {
  await d.run("INSERT INTO app_config (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, value]);
}

async function collections(d: DB): Promise<string[]> {
  const row = await d.get<{ value: string }>("SELECT value FROM app_config WHERE key = 'codriver_collections'");
  const list = (row?.value || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_]{1,60}$/.test(s));
  return list.length ? list : DEFAULT_COLLECTIONS;
}

/** Seite von Firestore-Dokumenten upserten; gibt die Zahl geänderter Dokumente zurück. */
async function speichern(d: DB, col: string, docs: FsDoc[], idOf: (doc: FsDoc) => string, now: string): Promise<number> {
  if (!docs.length) return 0;
  const ids = docs.map(idOf);
  const known = new Map(
    (
      await d.all<{ doc_id: string; update_time: string }>(
        `SELECT doc_id, update_time FROM codriver_docs WHERE collection = ? AND doc_id IN (${ids.map(() => "?").join(",")})`,
        [col, ...ids]
      )
    ).map((r) => [r.doc_id, r.update_time])
  );
  let n = 0;
  for (let k = 0; k < docs.length; k++) {
    const doc = docs[k];
    if (known.get(ids[k]) === (doc.updateTime || "")) continue;
    await d.run(
      `INSERT INTO codriver_docs (collection, doc_id, data, update_time, synced_at, removed_at) VALUES (?,?,?,?,?,NULL)
       ON CONFLICT (collection, doc_id) DO UPDATE SET data = excluded.data, update_time = excluded.update_time,
         synced_at = excluded.synced_at, removed_at = NULL`,
      [col, ids[k], JSON.stringify(decodeFields(doc.fields ?? {})), doc.updateTime || "", now]
    );
    n++;
  }
  await d.run(
    `UPDATE codriver_docs SET synced_at = ?, removed_at = NULL WHERE collection = ? AND doc_id IN (${ids.map(() => "?").join(",")})`,
    [now, col, ...ids]
  );
  return n;
}

export const VEHICLE_DOCUMENTS = "vehicle_documents";

/**
 * Fahrzeugdokumente (vehicles/{id}/documents) Fahrzeug für Fahrzeug spiegeln.
 * Der Fortschritt steht in `st.pageToken` (Index in der Fahrzeugliste), damit ein
 * Lauf nach Zeitablauf beim nächsten Cron weitermacht. Gibt true zurück, wenn
 * alle Fahrzeuge durch sind.
 */
async function fahrzeugDokumente(d: DB, dsp: string, st: State, deadline: number, res: CodriverResult): Promise<boolean> {
  const fahrzeuge = await d.all<{ doc_id: string }>(
    "SELECT doc_id FROM codriver_docs WHERE collection = 'vehicles' AND removed_at IS NULL ORDER BY doc_id"
  );
  let i = Number(st.pageToken) || 0;
  while (i < fahrzeuge.length && Date.now() < deadline - 8_000) {
    const id = fahrzeuge[i].doc_id;
    const now = new Date().toISOString();
    const s = await signIn(deadline);
    try {
      const page = await jsonFetch<{ documents?: FsDoc[] }>(
        `${docsBase()}/users/${dsp}/vehicles/${encodeURIComponent(id)}/documents?pageSize=${PAGE_SIZE}`,
        { headers: { authorization: `Bearer ${s.idToken}` } },
        deadline
      );
      const docs = page.documents ?? [];
      res.geladen += docs.length;
      res.geaendert += await speichern(d, VEHICLE_DOCUMENTS, docs, (x) => `${id}/${x.name.split("/").pop() || ""}`, now);
    } catch (e) {
      // ein Fahrzeug ohne Leserecht bremst den Rest nicht aus
      if (res.hinweise.length < 5) res.hinweise.push(`${VEHICLE_DOCUMENTS} ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    i++;
    st.pageToken = String(i);
  }
  if (i < fahrzeuge.length) return false;
  const r = await d.all<{ doc_id: string }>(
    `UPDATE codriver_docs SET removed_at = ${nowExpr(d)} WHERE collection = ? AND removed_at IS NULL AND synced_at < ? RETURNING doc_id`,
    [VEHICLE_DOCUMENTS, st.passStart]
  );
  res.entfernt += r.length;
  res.fertig.push(VEHICLE_DOCUMENTS);
  return true;
}

export type CodriverResult = {
  configured: boolean;
  dsp?: string;
  geladen: number;
  geaendert: number;
  entfernt: number;
  fertig: string[];
  hinweise: string[];
};

export async function runCodriverSync(opts: { deadline?: number } = {}): Promise<CodriverResult> {
  const deadline = opts.deadline ?? Date.now() + 50_000;
  const res: CodriverResult = { configured: codriverConfigured(), geladen: 0, geaendert: 0, entfernt: 0, fertig: [], hinweise: [] };
  if (!res.configured) {
    res.hinweise.push("Codriver nicht verbunden – CODRIVER_EMAIL / CODRIVER_PASSWORD (Disponenten-Konto) in Vercel setzen.");
    return res;
  }
  const d = await getDb();
  const dsp = await dspUid(deadline);
  res.dsp = dsp;
  await setConfig(d, "codriver_dsp_uid", dsp);
  const cols = await collections(d);
  const st = await loadState(d);
  if (st.i >= cols.length) st.i = 0;

  // höchstens eine volle Runde pro Aufruf
  for (let guard = 0; guard < cols.length * 50 && Date.now() < deadline - 8_000; guard++) {
    const col = cols[st.i];
    const now = new Date().toISOString();
    if (!st.pageToken) st.passStart = now;
    if (col === VEHICLE_DOCUMENTS) {
      const fertig = await fahrzeugDokumente(d, dsp, st, deadline, res);
      if (fertig) {
        st.pageToken = "";
        st.i = (st.i + 1) % cols.length;
      }
      await setConfig(d, "codriver_sync", JSON.stringify(st));
      if (!fertig || res.fertig.length >= cols.length) break;
      continue;
    }
    const q = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (st.pageToken) q.set("pageToken", st.pageToken);
    const s = await signIn(deadline);
    let page: { documents?: FsDoc[]; nextPageToken?: string };
    try {
      page = await jsonFetch(`${docsBase()}/users/${dsp}/${col}?${q}`, { headers: { authorization: `Bearer ${s.idToken}` } }, deadline);
    } catch (e) {
      res.hinweise.push(`${col}: ${e instanceof Error ? e.message : String(e)}`);
      st.i = (st.i + 1) % cols.length;
      st.pageToken = "";
      await setConfig(d, "codriver_sync", JSON.stringify(st));
      continue;
    }
    const docs = page.documents ?? [];
    res.geladen += docs.length;
    res.geaendert += await speichern(d, col, docs, (x) => x.name.split("/").pop() || "", now);
    if (page.nextPageToken) {
      st.pageToken = page.nextPageToken;
    } else {
      // Sammlung komplett gelesen: was in dieser Runde nicht mehr vorkam, gilt als entfernt (bleibt aber gespeichert)
      const r = await d.all<{ doc_id: string }>(
        `UPDATE codriver_docs SET removed_at = ${nowExpr(d)} WHERE collection = ? AND removed_at IS NULL AND synced_at < ? RETURNING doc_id`,
        [col, st.passStart]
      );
      res.entfernt += r.length;
      res.fertig.push(col);
      st.pageToken = "";
      st.i = (st.i + 1) % cols.length;
      if (res.fertig.length >= cols.length) {
        await setConfig(d, "codriver_sync", JSON.stringify(st));
        break;
      }
    }
    await setConfig(d, "codriver_sync", JSON.stringify(st));
  }
  await setConfig(d, "codriver_last_sync", new Date().toISOString());
  return res;
}
