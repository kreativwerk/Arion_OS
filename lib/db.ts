import path from "path";
import fs from "fs";
import { seed, seedConfigDefaults, seedBuchhaltungMailRules } from "./seed";

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
    // Ein fehlgeschlagener Verbindungsaufbau darf die Instanz nicht dauerhaft
    // vergiften – beim nächsten Request wird neu verbunden.
    _db.catch(() => {
      _db = null;
    });
  }
  return _db;
}

/** Heutiges Datum (ISO) in der App-Zeitzone – nicht UTC, sonst kippen
 *  Fälligkeiten und Habit-Tage zwischen Mitternacht und 1/2 Uhr. */
export function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: process.env.APP_TIMEZONE || "Europe/Berlin",
  });
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
  // int8 (bigint, u.a. alle IDs) als Number parsen statt als String – sonst
  // scheitern ===-Vergleiche im Client (z.B. habits.id "6" vs habit_logs.habit_id 6).
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    types: {
      int8: { to: 20, from: [20], serialize: (v: unknown) => String(v), parse: (v: string) => Number(v) },
    },
  });
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
    // Wasser-Tracker (Altbestand, wird nach nutrition_log migriert)
    `CREATE TABLE IF NOT EXISTS water_log (
      date TEXT PRIMARY KEY,
      ml INTEGER NOT NULL DEFAULT 0
    )`,
    // Ernährungs-Tracker auf dem Dashboard: ein Zähler pro Tag und Art
    // (water = ml, protein = g, vitamin = 0/1), Reset über das Datum
    `CREATE TABLE IF NOT EXISTS nutrition_log (
      date TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, kind)
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
      category TEXT DEFAULT '',
      action TEXT DEFAULT '',
      due_date TEXT DEFAULT '',
      reference TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      mime TEXT DEFAULT '',
      extracted TEXT DEFAULT '',
      created_at TEXT DEFAULT ${NOW}
    )`,
    // Original-Scans der Briefpost (PDF/Foto) – getrennt von den Metadaten,
    // damit Listenabfragen keine Blobs mitschleppen.
    dialect === "sqlite"
      ? `CREATE TABLE IF NOT EXISTS letter_blobs (
          letter_id INTEGER PRIMARY KEY,
          data BLOB NOT NULL
        )`
      : `CREATE TABLE IF NOT EXISTS letter_blobs (
          letter_id bigint PRIMARY KEY,
          data bytea NOT NULL
        )`,
    `CREATE TABLE IF NOT EXISTS mail_accounts (
      ${ID}, ${WS},
      label TEXT NOT NULL,
      address TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      host TEXT DEFAULT '',
      port INTEGER DEFAULT 993,
      username TEXT DEFAULT '',
      password_enc TEXT DEFAULT ''
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
    // Dedupe für den IMAP-Abruf: welche Message-IDs wurden schon verarbeitet
    `CREATE TABLE IF NOT EXISTS mail_seen (
      account TEXT NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (account, message_id)
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
    // conversation_id: '' = Chat „Arion Bot“; ARION-Sprachgespräche bekommen eigene IDs
    `CREATE TABLE IF NOT EXISTS assistant_messages (
      ${ID}, ${WS},
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      conversation_id TEXT DEFAULT '',
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
    ...buchhaltungStatements(dialect, ID, NOW, WS),
    ...postfachStatements(dialect, ID, NOW, WS),
    ...codriverStatements(),
  ];
}

/**
 * Codriver-Spiegel (siehe docs/CODRIVER.md, Abschnitt Sync): Arion-Daten aus
 * Codriver (Fahrer, Fahrzeuge, Scorecards, Abwesenheiten, Vorfälle …) als
 * redigierte JSON-Kopie – Quelle bleibt Codriver, Arion OS liest nur.
 */
function codriverStatements(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS codriver_docs (
      collection TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      update_time TEXT DEFAULT '',
      synced_at TEXT DEFAULT '',
      removed_at TEXT DEFAULT NULL,
      PRIMARY KEY (collection, doc_id)
    )`,
  ];
}

/**
 * Postfach-Archiv + Versand (siehe docs/INTEGRATIONEN.md, Abschnitt Postfach):
 * komplette Mails aller verbundenen Konten (alle Ordner außer Papierkorb/Spam/
 * Entwürfe) als durchsuchbare Kopie; Anhänge bleiben auf dem IMAP-Server und
 * werden bei Bedarf geladen. Entwürfe werden erst nach Freigabe in der App
 * per SMTP versendet.
 */
function postfachStatements(dialect: "sqlite" | "postgres", ID: string, NOW: string, WS: string): string[] {
  const BLOB = dialect === "sqlite" ? "BLOB" : "bytea";
  const REF = dialect === "sqlite" ? "INTEGER" : "bigint";
  return [
    `CREATE TABLE IF NOT EXISTS mails (
      ${ID}, ${WS},
      account TEXT NOT NULL,
      folder TEXT NOT NULL,
      uidvalidity TEXT NOT NULL DEFAULT '',
      uid INTEGER NOT NULL,
      message_id TEXT DEFAULT '',
      from_addr TEXT DEFAULT '',
      to_addr TEXT DEFAULT '',
      cc_addr TEXT DEFAULT '',
      reply_to TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      date TEXT,
      body_text TEXT DEFAULT '',
      has_html INTEGER DEFAULT 0,
      attachments TEXT DEFAULT '[]',
      flags TEXT DEFAULT '',
      in_reply_to TEXT DEFAULT '',
      references_hdr TEXT DEFAULT '',
      size INTEGER DEFAULT 0,
      created_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS mails_uid_uq ON mails (account, folder, uidvalidity, uid)`,
    `CREATE INDEX IF NOT EXISTS mails_date_idx ON mails (date)`,
    `CREATE INDEX IF NOT EXISTS mails_msgid_idx ON mails (message_id)`,
    `CREATE TABLE IF NOT EXISTS mail_html (
      mail_id ${REF} PRIMARY KEY,
      html TEXT NOT NULL
    )`,
    // Fortschritt pro Konto + Ordner: neue Mails ab max_uid, Nachladen älterer bis min_uid
    `CREATE TABLE IF NOT EXISTS mail_sync (
      account TEXT NOT NULL,
      folder TEXT NOT NULL,
      uidvalidity TEXT NOT NULL DEFAULT '',
      max_uid INTEGER NOT NULL DEFAULT 0,
      min_uid INTEGER NOT NULL DEFAULT 0,
      backfill_done INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT ${NOW},
      PRIMARY KEY (account, folder)
    )`,
    // status: entwurf → sendet → gesendet | fehler; verworfen statt Löschen
    `CREATE TABLE IF NOT EXISTS mail_drafts (
      ${ID}, ${WS},
      account_id INTEGER NOT NULL,
      to_addr TEXT NOT NULL DEFAULT '',
      cc_addr TEXT DEFAULT '',
      bcc_addr TEXT DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      reply_mail_id INTEGER,
      in_reply_to TEXT DEFAULT '',
      references_hdr TEXT DEFAULT '',
      source TEXT DEFAULT 'app',
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'entwurf',
      error TEXT DEFAULT '',
      smtp_message_id TEXT DEFAULT '',
      created_at TEXT DEFAULT ${NOW},
      updated_at TEXT DEFAULT ${NOW},
      sent_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS mail_drafts_status_idx ON mail_drafts (status, id)`,
    `CREATE TABLE IF NOT EXISTS mail_draft_files (
      ${ID},
      draft_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT DEFAULT 'application/octet-stream',
      data ${BLOB} NOT NULL
    )`,
    // Kopie der Mail-Anhänge (PDF/Bilder), vom Mail-Cron nachgeladen – so sind
    // Anhänge ohne Live-IMAP-Abruf verfügbar (lib/mail-attachment-store.ts).
    `CREATE TABLE IF NOT EXISTS mail_attachment_blobs (
      mail_id INTEGER NOT NULL,
      part TEXT NOT NULL,
      filename TEXT NOT NULL DEFAULT '',
      mime TEXT DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      data ${BLOB} NOT NULL,
      created_at TEXT DEFAULT ${NOW},
      PRIMARY KEY (mail_id, part)
    )`,
    // Unterschrift/Stempel für serverseitiges Unterschreiben (lib/draft-sign.ts)
    `CREATE TABLE IF NOT EXISTS sign_assets (
      key TEXT PRIMARY KEY,
      mime TEXT NOT NULL DEFAULT 'image/png',
      data ${BLOB} NOT NULL,
      updated_at TEXT DEFAULT ${NOW}
    )`,
  ];
}

/** Postfach-Tabellen – Mailinhalte sind sensibel, öffentliche Supabase-API sperren. */
const POSTFACH_TABLES = ["mails", "mail_html", "mail_sync", "mail_drafts", "mail_draft_files", "mail_attachment_blobs", "sign_assets"];

/**
 * Buchhaltungs-Modul (siehe docs/BUCHHALTUNG.md):
 * Eingang (Mail-/Scan-Anhänge) → Ablage-Aufträge (von der Claude-Routine per SQL
 * angelegt) → Upload nach Google Drive. Dazu Monatsabgleich, Fristen, Kennzahlen.
 * Beträge: NUMERIC auf Postgres (exakt), REAL auf SQLite.
 */
function buchhaltungStatements(dialect: "sqlite" | "postgres", ID: string, NOW: string, WS: string): string[] {
  const MONEY = dialect === "sqlite" ? "REAL" : "NUMERIC(14,2)";
  return [
    `CREATE TABLE IF NOT EXISTS buch_eingang (
      ${ID}, ${WS},
      quelle TEXT NOT NULL DEFAULT 'mail',
      account TEXT DEFAULT '',
      message_id TEXT DEFAULT '',
      from_addr TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      received_at TEXT,
      filename TEXT NOT NULL DEFAULT '',
      mime TEXT DEFAULT '',
      size INTEGER DEFAULT 0,
      sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'neu',
      firma TEXT,
      notiz TEXT DEFAULT '',
      created_at TEXT DEFAULT ${NOW},
      updated_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS buch_eingang_sha256_uq ON buch_eingang (workspace_id, sha256)`,
    `CREATE INDEX IF NOT EXISTS buch_eingang_status_idx ON buch_eingang (status, created_at)`,
    dialect === "sqlite"
      ? `CREATE TABLE IF NOT EXISTS buch_eingang_blobs (
          eingang_id INTEGER PRIMARY KEY,
          data BLOB NOT NULL
        )`
      : `CREATE TABLE IF NOT EXISTS buch_eingang_blobs (
          eingang_id bigint PRIMARY KEY,
          data bytea NOT NULL
        )`,
    `CREATE TABLE IF NOT EXISTS buch_ablage (
      ${ID}, ${WS},
      eingang_id INTEGER NOT NULL,
      seiten TEXT DEFAULT '',
      ziel_pfad TEXT NOT NULL,
      dateiname TEXT NOT NULL,
      lieferant TEXT DEFAULT '',
      betrag ${MONEY},
      belegdatum TEXT,
      monat TEXT,
      status TEXT NOT NULL DEFAULT 'offen',
      drive_file_id TEXT DEFAULT '',
      drive_url TEXT DEFAULT '',
      fehler TEXT DEFAULT '',
      gestartet_at TEXT,
      created_at TEXT DEFAULT ${NOW},
      done_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS buch_ablage_status_idx ON buch_ablage (status, id)`,
    `CREATE INDEX IF NOT EXISTS buch_ablage_eingang_idx ON buch_ablage (eingang_id)`,
    `CREATE TABLE IF NOT EXISTS buch_ausgaben (
      ${ID}, ${WS},
      monat TEXT NOT NULL,
      datum TEXT,
      empfaenger TEXT DEFAULT '',
      zweck TEXT DEFAULT '',
      betrag ${MONEY} NOT NULL DEFAULT 0,
      kategorie TEXT DEFAULT '',
      beleg TEXT DEFAULT '',
      hinweis TEXT DEFAULT '',
      qonto_id TEXT
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS buch_ausgaben_qonto_uq ON buch_ausgaben (workspace_id, qonto_id)`,
    `CREATE INDEX IF NOT EXISTS buch_ausgaben_monat_idx ON buch_ausgaben (monat)`,
    `CREATE TABLE IF NOT EXISTS buch_fristen (
      ${ID}, ${WS},
      titel TEXT NOT NULL,
      faellig TEXT,
      betrag ${MONEY},
      art TEXT DEFAULT 'sonstiges',
      status TEXT NOT NULL DEFAULT 'offen',
      quelle TEXT DEFAULT '',
      notiz TEXT DEFAULT ''
    )`,
    // Konto 1590 (Durchlaufende Posten): Daniels Liste „Beleg fehlt“, je Zeile Status + gefundener Beleg
    `CREATE TABLE IF NOT EXISTS buch_1590 (
      ${ID}, ${WS},
      jahr TEXT NOT NULL,
      liste TEXT NOT NULL DEFAULT '',
      schluessel TEXT NOT NULL DEFAULT '',
      datum TEXT,
      text TEXT NOT NULL DEFAULT '',
      betrag ${MONEY} NOT NULL DEFAULT 0,
      belegnr TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'offen',
      datei TEXT DEFAULT '',
      datei_url TEXT DEFAULT '',
      notiz TEXT DEFAULT '',
      created_at TEXT DEFAULT ${NOW},
      updated_at TEXT DEFAULT ${NOW}
    )`,
    `CREATE INDEX IF NOT EXISTS buch_1590_jahr_idx ON buch_1590 (jahr, status)`,
    `CREATE TABLE IF NOT EXISTS buch_kennzahlen (
      ${WS},
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT ${NOW},
      PRIMARY KEY (workspace_id, key)
    )`,
  ];
}

/** Tabellen des Buchhaltungs-Moduls – auf Supabase per RLS für die öffentliche API gesperrt. */
const BUCH_TABLES = ["buch_eingang", "buch_eingang_blobs", "buch_ablage", "buch_ausgaben", "buch_fristen", "buch_kennzahlen", "buch_1590"];

/** Spalten für das Unterschreiben von Entwurfs-Anhängen auf dem Server (lib/draft-sign.ts). */
const DRAFT_SIGN_COLUMNS = ["sign_spec", "sign_status", "sign_error"];

/** Spalten, die die Briefpost nachträglich bekommen hat (Upload + KI-Analyse). */
const LETTER_COLUMNS = ["category", "action", "due_date", "reference", "notes", "mime", "extracted", "firma", "drive_file_id", "analysis_error"];

async function ensureSchema(d: DB) {
  for (const stmt of schemaStatements(d.dialect)) {
    await d.run(stmt);
  }
  if (d.dialect === "sqlite") {
    // Spalten-Migrationen für ältere lokale Datenbanken
    const addColumn = async (table: string, col: string, def: string) => {
      const cols = (await d.all<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
      if (!cols.includes(col)) await d.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    };
    await addColumn("tasks", "source", "TEXT DEFAULT 'eigen'");
    await addColumn("tasks", "submitted_by", "TEXT DEFAULT ''");
    await addColumn("tasks", "accepted", "INTEGER DEFAULT 1");
    await addColumn("tasks", "workspace_id", "TEXT NOT NULL DEFAULT 'default'");
    await addColumn("mail_accounts", "host", "TEXT DEFAULT ''");
    await addColumn("mail_accounts", "port", "INTEGER DEFAULT 993");
    await addColumn("mail_accounts", "username", "TEXT DEFAULT ''");
    await addColumn("mail_accounts", "password_enc", "TEXT DEFAULT ''");
    await addColumn("mail_accounts", "smtp_host", "TEXT DEFAULT ''");
    await addColumn("mail_accounts", "smtp_port", "INTEGER DEFAULT 465");
    await addColumn("mail_accounts", "display_name", "TEXT DEFAULT ''");
    for (const col of LETTER_COLUMNS) await addColumn("letters", col, "TEXT DEFAULT ''");
    await addColumn("assistant_messages", "conversation_id", "TEXT DEFAULT ''");
    await addColumn("mail_drafts", "notified_at", "TEXT");
    await addColumn("mail_drafts", "forward_mail_id", "INTEGER");
    for (const col of DRAFT_SIGN_COLUMNS) await addColumn("mail_drafts", col, "TEXT DEFAULT ''");
    await addColumn("buch_ausgaben", "beleg_url", "TEXT DEFAULT ''");
  } else {
    // Postgres kennt IF NOT EXISTS direkt
    for (const [col, def] of [
      ["host", "TEXT DEFAULT ''"],
      ["port", "INTEGER DEFAULT 993"],
      ["username", "TEXT DEFAULT ''"],
      ["password_enc", "TEXT DEFAULT ''"],
      ["smtp_host", "TEXT DEFAULT ''"],
      ["smtp_port", "INTEGER DEFAULT 465"],
      ["display_name", "TEXT DEFAULT ''"],
    ]) {
      await d.run(`ALTER TABLE mail_accounts ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    }
    for (const col of LETTER_COLUMNS) {
      await d.run(`ALTER TABLE letters ADD COLUMN IF NOT EXISTS ${col} TEXT DEFAULT ''`);
    }
    await d.run("ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS conversation_id TEXT DEFAULT ''");
    // Push „Entwurf wartet“ nur einmal je Entwurf (lib/draft-notify.ts)
    await d.run("ALTER TABLE mail_drafts ADD COLUMN IF NOT EXISTS notified_at TEXT");
    // Weiterleiten: Verweis auf die Originalmail, Anhänge kommen beim Versand per IMAP (lib/mail-forward.ts)
    await d.run("ALTER TABLE mail_drafts ADD COLUMN IF NOT EXISTS forward_mail_id INTEGER");
    // Unterschreiben auf dem Server: Auftrag (JSON) + Status/Fehler (lib/draft-sign.ts)
    for (const col of DRAFT_SIGN_COLUMNS) await d.run(`ALTER TABLE mail_drafts ADD COLUMN IF NOT EXISTS ${col} TEXT DEFAULT ''`);
    // Belegabgleich: Link zum gefundenen Beleg im Drive (lib/beleg-abgleich.ts)
    await d.run("ALTER TABLE buch_ausgaben ADD COLUMN IF NOT EXISTS beleg_url TEXT DEFAULT ''");
    // Scans sind sensibel: öffentliche Supabase-API sperren (die App selbst
    // verbindet als Tabellen-Owner und ist davon nicht betroffen).
    await d.run("ALTER TABLE letter_blobs ENABLE ROW LEVEL SECURITY");
    // Belege + Bankdaten ebenso (Liste ist fest im Code, keine Eingabe)
    for (const t of BUCH_TABLES) await d.run(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    for (const t of POSTFACH_TABLES) await d.run(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    await d.run("ALTER TABLE codriver_docs ENABLE ROW LEVEL SECURITY");
  }

  await d.run(
    "CREATE INDEX IF NOT EXISTS assistant_messages_conv_idx ON assistant_messages (conversation_id, id)"
  );

  // Altbestand des Wasser-Trackers in die generische Ernährungs-Tabelle übernehmen
  // ("WHERE true" ist für SQLite nötig, damit ON CONFLICT nach SELECT parst)
  await d.run(
    "INSERT INTO nutrition_log (date, kind, amount) SELECT date, 'water', ml FROM water_log WHERE true ON CONFLICT DO NOTHING"
  );

  // Beispieldaten nur EINMAL einspielen. Das Flag wird VOR dem Seeden atomar
  // beansprucht (RETURNING) – parallele Cold-Starts können so nicht doppelt säen.
  const claimed = await d.all<{ key: string }>(
    "INSERT INTO app_config (key, value) VALUES ('seeded','1') ON CONFLICT (key) DO NOTHING RETURNING key"
  );
  if (claimed.length > 0) {
    const row = await d.get<{ n: number }>("SELECT COUNT(*) AS n FROM knowledge_notes");
    if (Number(row?.n ?? 0) === 0) await seed(d);
  }
  await seedConfigDefaults(d);
  await seedBuchhaltungMailRules(d);
}

/** Ohne geheime Schlüssel (verschlüsselte Tokens) – getConfig landet u. a. im Browser und in Prompts. */
export async function getConfig(): Promise<Record<string, string>> {
  const d = await getDb();
  const rows = await d.all<{ key: string; value: string }>(
    "SELECT key, value FROM app_config WHERE key NOT IN ('google_drive_refresh')"
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
