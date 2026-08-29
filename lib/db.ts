import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { seed } from "./seed";

const DATA_DIR = path.join(process.cwd(), "data");

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(path.join(DATA_DIR, "arion.db"));
  _db.pragma("journal_mode = WAL");
  migrate(_db);
  return _db;
}

function migrate(d: Database.Database) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    notes TEXT DEFAULT '',
    horizon TEXT NOT NULL DEFAULT 'short',        -- 'short' | 'long'
    due_date TEXT,                                 -- ISO date
    recurrence TEXT,                               -- null | 'daily' | 'weekly' | 'monthly'
    project TEXT DEFAULT '',
    priority INTEGER DEFAULT 2,                    -- 1 hoch, 2 normal, 3 niedrig
    done INTEGER DEFAULT 0,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    emoji TEXT DEFAULT 'check_circle',              -- Material-Symbol-Name
    target_per_week INTEGER DEFAULT 7,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS habit_logs (
    habit_id INTEGER NOT NULL,
    date TEXT NOT NULL,                            -- ISO date
    PRIMARY KEY (habit_id, date)
  );

  CREATE TABLE IF NOT EXISTS clipboard_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    label TEXT DEFAULT '',
    pinned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,                            -- ISO date
    start_time TEXT DEFAULT '',
    end_time TEXT DEFAULT '',
    location TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    source TEXT DEFAULT 'lokal',                   -- 'lokal' | 'ics'
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS knowledge_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'persoenlich',     -- 'persoenlich' | 'unternehmen' | 'partner'
    partner TEXT DEFAULT '',                       -- z.B. Amazon, Arval, LeasePlan
    tags TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    provider TEXT DEFAULT '',
    category TEXT DEFAULT 'Versicherung',
    policy_number TEXT DEFAULT '',
    annual_cost REAL DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    cancel_period_days INTEGER DEFAULT 90,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS letters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    sender TEXT DEFAULT '',
    received_date TEXT DEFAULT (date('now')),
    scanned_by TEXT DEFAULT '',
    status TEXT DEFAULT 'neu',                     -- 'neu' | 'gelesen' | 'aktion' | 'archiv'
    summary TEXT DEFAULT '',
    file_ref TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mail_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    address TEXT NOT NULL,
    active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS mail_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,                            -- 'absender' | 'stichwort'
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mail_digest (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT DEFAULT '',
    from_addr TEXT DEFAULT '',
    subject TEXT NOT NULL,
    summary TEXT DEFAULT '',
    matched_rule TEXT DEFAULT '',
    important INTEGER DEFAULT 0,
    received_at TEXT DEFAULT (datetime('now')),
    read INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS watchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    hint TEXT DEFAULT '',                          -- wonach gesucht wird
    interval_minutes INTEGER DEFAULT 60,
    last_checked TEXT,
    active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS watcher_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watcher_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    detail TEXT DEFAULT '',
    seen INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS slack_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person TEXT NOT NULL,
    note TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS slack_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_person TEXT NOT NULL,
    channel TEXT DEFAULT '',
    text TEXT NOT NULL,
    important INTEGER DEFAULT 0,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS assistant_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,                            -- 'user' | 'assistant'
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Kundenspezifische Konfiguration (White-Label: pro Installation/Kunde)
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  -- API-Tokens für externe Zulieferer (z.B. Codriver, Scanner, Watcher-Jobs)
  CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,                           -- z.B. 'Codriver'
    token_hash TEXT NOT NULL UNIQUE,               -- sha256 des Tokens
    created_at TEXT DEFAULT (datetime('now')),
    last_used TEXT
  );
  `);

  // Spalten-Migrationen für bestehende Datenbanken
  addColumn(d, "tasks", "source", "TEXT DEFAULT 'eigen'");        // 'eigen' | 'codriver' | ...
  addColumn(d, "tasks", "submitted_by", "TEXT DEFAULT ''");       // Name des Mitarbeiters
  addColumn(d, "tasks", "accepted", "INTEGER DEFAULT 1");         // 0 = wartet im Eingang

  const row = d.prepare("SELECT COUNT(*) AS n FROM knowledge_notes").get() as { n: number };
  if (row.n === 0) seed(d);
  seedConfigDefaults(d);
}

function addColumn(d: Database.Database, table: string, column: string, def: string) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

/** Fehlende Konfigurationsschlüssel mit Standardwerten anlegen (idempotent). */
function seedConfigDefaults(d: Database.Database) {
  const defaults: Record<string, string> = {
    app_name: "Arion OS",
    user_name: "",
    company: "Arion Logistics",
    partners: "Amazon, Arval, LeasePlan",
    employee_app: "Codriver",
    about_me:
      "Ich führe Arion Logistics, ein Logistikunternehmen. Wichtige Partner: Amazon (Vendor Central), " +
      "Arval und LeasePlan (Fahrzeugleasing). Meine Briefpost wird von Mitarbeitern gescannt und digital " +
      "zugestellt. Mitarbeiter tragen mir Aufgaben über unsere eigene App Codriver ein.",
  };
  const ins = d.prepare("INSERT OR IGNORE INTO app_config (key, value) VALUES (?,?)");
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
}

export function getConfig(): Record<string, string> {
  const rows = db().prepare("SELECT key, value FROM app_config").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
