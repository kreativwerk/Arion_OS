import path from "path";
import fs from "fs";
import { seed, seedConfigDefaults } from "./seed";

/**
 * Datenkern von Arion OS – eine Schnittstelle, zwei Treiber:
 *
 * - `DATABASE_URL` gesetzt  → Postgres (Supabase, Produktion/Cloud)
 * - `DATABASE_URL` leer     → SQLite unter data/arion.db (Entwicklung, Offline,
 *                             Self-Hosted ohne Cloud)
 *
 * Alle Queries verwenden `?`-Platzhalter; der Postgres-Treiber übersetzt sie
 * nach $1…$n. Datums-/Zeitwerte werden als ISO-Text gespeichert, Booleans als
 * 0/1 – dadurch verhalten sich beide Treiber identisch.
 */

export type Row = Record<string, unknown>;

export interface DB {
  dialect: "sqlite" | "postgres";
  all<T = Row>(query: string, params?: unknown[]): Promise<T[]>;
  get<T = Row>(query: string, params?: unknown[]): Promise<T | undefined>;
  run(query: string, params?: unknown[]): Promise<void>;
  /** INSERT ohne RETURNING übergeben – liefert die neue id. */
  insert(query: string, params?: unknown[]): Promise<number>;
}

/** SQL-Ausdruck für "jetzt" im aktiven Dialekt. */
export function nowExpr(d: DB): string {
  return d.dialect === "sqlite" ? "datetime('now')" : "now()::text";
}

let _db: Promise<DB> | null = null;

export function getDb(): Promise<DB> {
  if (!_db) {
    if (!process.env.DATABASE_URL && process.env.VERCEL) {
      throw new Error(
        "DATABASE_URL fehlt: Auf Vercel gibt es kein beschreibbares Dateisystem für SQLite. " +
          "Bitte in den Vercel-Projekteinstellungen die DATABASE_URL des Supabase-Projekts 'Arion OS' setzen (siehe docs/DEPLOY.md)."
      );
    }
    _db = (process.env.DATABASE_URL ? initPostgres(process.env.DATABASE_URL) : initSqlite()).then(
      async (d) => {
        await ensureSchema(d);
        return d;
      }
    );
  }
  return _db;
}

/* ── SQLite ─────────────────────────────────────────────── */

async function initSqlite(): Promise<DB> {
  const { default: Database } = await import("better-sqlite3");
  const DATA_DIR = path.join(process.cwd(), "data");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const raw = new Database(path.join(DATA_DIR, "arion.db"));
  raw.pragma("journal_mode = WAL");
  return {
    dialect: "sqlite",
    async all<T>(query: string, params: unknown[] = []) {
      return raw.prepare(query).all(...params) as T[];
    },
    async get<T>(query: string, params: unknown[] = []) {
      return raw.prepare(query).get(...params) as T | undefined;
    },
    async run(query: string, params: unknown[] = []) {
      raw.prepare(query).run(...params);
    },
    async insert(query: string, params: unknown[] = []) {
      const info = raw.prepare(query).run(...params);
      return Number(info.lastInsertRowid);
    },
  };
}

/* ── Postgres (Supabase) ────────────────────────────────── */

function toDollar(query: string): string {
  let i = 0;
  return query.replace(/\?/g, () => `$${++i}`);
}

async function initPostgres(url: string): Promise<DB> {
  const { default: postgres } = await import("postgres");
  // Serverless-freundlich: 1 Verbindung pro Funktionsinstanz, Leerlauf schnell
  // schließen. prepare:false ist Pflicht für den Supabase Transaction-Pooler.
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 15 });
  return {
    dialect: "postgres",
    async all<T>(query: string, params: unknown[] = []) {
      return (await sql.unsafe(toDollar(query), params as never[])) as unknown as T[];
    },
    async get<T>(query: string, params: unknown[] = []) {
      const rows = (await sql.unsafe(toDollar(query), params as never[])) as unknown as T[];
      return rows[0];
    },
    async run(query: string, params: unknown[] = []) {
      await sql.unsafe(toDollar(query), params as never[]);
    },
    async insert(query: string, params: unknown[] = []) {
      const rows = (await sql.unsafe(toDollar(query) + " RETURNING id", params as never[])) as unknown as {
        id: number;
      }[];
      return Number(rows[0].id);
    },
  };
}

/* ── Schema ─────────────────────────────────────────────── */

/** Tabellen-DDL. `ID` wird pro Dialekt ersetzt. */
const ID_SQLITE = "id INTEGER PRIMARY KEY AUTOINCREMENT";
const ID_PG = "id bigint generated always as identity primary key";

function schemaStatements(dialect: "sqlite" | "postgres"): string[] {
  const ID = dialect === "sqlite" ? ID_SQLITE : ID_PG;
  const NOW = dialect === "sqlite" ? "(datetime('now'))" : "(now()::text)";
  const TODAY = dialect === "sqlite" ? "(date('now'))" : "(current_date::text)";
  // workspace_id: vorbereitet für Mandantenfähigkeit (siehe docs/SAAS.md);
  // aktuell läuft alles im Workspace 'default'.
  const WS = "workspace_id TEXT NOT NULL DEFAULT 'default'";
  return [
    `CREATE TABLE IF NOT EXISTS tasks (
      ${ID}, ${WS},
      title TEXT NOT NULL,
      notes TEXT DEFAULT '',
      horizon TEXT NOT NULL DEFAULT 'short',
      due_date TEXT,
      recurrence TEXT,
      project TEXT DEFAULT '',
      priority INTEGER DEFAULT 2,
      done INTEGER DEFAULT 0,
      completed_at TEXT,
      source TEXT DEFAULT 'eigen',
      submitted_by TEXT DEFAULT '',
      accepted INTEGER DEFAULT 1,
      created_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE TABLE IF NOT EXISTS habits (
      ${ID}, ${WS},
      name TEXT NOT NULL,
      emoji TEXT DEFAULT 'check_circle',
      target_per_week INTEGER DEFAULT 7,
      created_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE TABLE IF NOT EXISTS habit_logs (
      habit_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      PRIMARY KEY (habit_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS clipboard_items (
      ${ID}, ${WS},
      content TEXT NOT NULL,
      label TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE TABLE IF NOT EXISTS calendar_events (
      ${ID}, ${WS},
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT DEFAULT '',
      end_time TEXT DEFAULT '',
      location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      source TEXT DEFAULT 'lokal',
      created_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge_notes (
      ${ID}, ${WS},
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'persoenlich',
      partner TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      updated_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE TABLE IF NOT EXISTS contracts (
      ${ID}, ${WS},
      name TEXT NOT NULL,
      provider TEXT DEFAULT '',
      category TEXT DEFAULT 'Versicherung',
      policy_number TEXT DEFAULT '',
      annual_cost REAL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      cancel_period_days INTEGER DEFAULT 90,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE TABLE IF NOT EXISTS letters (
      ${ID}, ${WS},
      subject TEXT NOT NULL,
      sender TEXT DEFAULT '',
      received_date TEXT DEFAULT ${TODAY},
      scanned_by TEXT DEFAULT '',
      status TEXT DEFAULT 'neu',
      summary TEXT DEFAULT '',
      file_ref TEXT DEFAULT '',
      created_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE TABLE IF NOT EXISTS mail_accounts (
      ${ID}, ${WS},
      label TEXT NOT NULL,
      address TEXT NOT NULL,
      active INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS mail_rules (
      ${ID}, ${WS},
      kind TEXT NOT NULL,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS mail_digest (
      ${ID}, ${WS},
      account TEXT DEFAULT '',
      from_addr TEXT DEFAULT '',
      subject TEXT NOT NULL,
      summary TEXT DEFAULT '',
      matched_rule TEXT DEFAULT '',
      important INTEGER DEFAULT 0,
      received_at TEXT DEFAULT ${NOW},
      read INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS watchers (
      ${ID}, ${WS},
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      hint TEXT DEFAULT '',
      interval_minutes INTEGER DEFAULT 60,
      last_checked TEXT,
      active INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS watcher_events (
      ${ID}, ${WS},
      watcher_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      detail TEXT DEFAULT '',
      seen INTEGER DEFAULT 0,
      created_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE TABLE IF NOT EXISTS slack_rules (
      ${ID}, ${WS},
      person TEXT NOT NULL,
      note TEXT DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS slack_notifications (
      ${ID}, ${WS},
      from_person TEXT NOT NULL,
      channel TEXT DEFAULT '',
      text TEXT NOT NULL,
      important INTEGER DEFAULT 0,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE TABLE IF NOT EXISTS assistant_messages (
      ${ID}, ${WS},
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS api_tokens (
      ${ID},
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT ${NOW},
      last_used TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS documents (
      ${ID}, ${WS},
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT DEFAULT '',
      size INTEGER DEFAULT 0,
      category TEXT DEFAULT 'Allgemein',
      scope TEXT NOT NULL DEFAULT 'unternehmen',
      partner TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT ${NOW}
    )`,
    dialect === "sqlite"
      ? `CREATE TABLE IF NOT EXISTS document_blobs (
          document_id INTEGER PRIMARY KEY,
          data BLOB NOT NULL
        )`
      : `CREATE TABLE IF NOT EXISTS document_blobs (
          document_id bigint PRIMARY KEY,
          data bytea NOT NULL
        )`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      ${ID},
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT DEFAULT '',
      created_at TEXT DEFAULT ${NOW}
    )`,
  ];
}

async function ensureSchema(d: DB) {
  for (const stmt of schemaStatements(d.dialect)) {
    await d.run(stmt);
  }
  if (d.dialect === "sqlite") {
    // Spalten-Migrationen für ältere lokale Datenbanken
    const cols = (await d.all<{ name: string }>("PRAGMA table_info(tasks)")).map((c) => c.name);
    const add = async (col: string, def: string) => {
      if (!cols.includes(col)) await d.run(`ALTER TABLE tasks ADD COLUMN ${col} ${def}`);
    };
    await add("source", "TEXT DEFAULT 'eigen'");
    await add("submitted_by", "TEXT DEFAULT ''");
    await add("accepted", "INTEGER DEFAULT 1");
    await add("workspace_id", "TEXT NOT NULL DEFAULT 'default'");
  }

  // Beispieldaten nur EINMAL einspielen (Flag in app_config) – danach nie wieder,
  // auch wenn der Nutzer alles löscht.
  const seeded = await d.get<{ value: string }>("SELECT value FROM app_config WHERE key = 'seeded'");
  if (!seeded) {
    const row = await d.get<{ n: number }>("SELECT COUNT(*) AS n FROM knowledge_notes");
    if (Number(row?.n ?? 0) === 0) await seed(d);
    await d.run("INSERT INTO app_config (key, value) VALUES ('seeded','1') ON CONFLICT (key) DO NOTHING");
  }
  await seedConfigDefaults(d);
}

export async function getConfig(): Promise<Record<string, string>> {
  const d = await getDb();
  const rows = await d.all<{ key: string; value: string }>("SELECT key, value FROM app_config");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
