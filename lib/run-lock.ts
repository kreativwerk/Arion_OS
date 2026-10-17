import type { DB } from "@/lib/db";

/**
 * Einfache Lauf-Sperre in app_config (atomares Compare-and-Set per Upsert):
 * Wert = Startzeit in ms (nullgefüllt, damit Textvergleich = Zahlvergleich).
 * Eine Sperre gilt nach `staleMs` als verwaist und darf übernommen werden.
 */

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(15, "0");

export async function acquireLock(d: DB, name: string, staleMs = 3 * 60_000): Promise<string | null> {
  const key = `lock:${name}`;
  const token = pad(Date.now());
  const staleBefore = pad(Date.now() - staleMs);
  const rows = await d.all<{ value: string }>(
    `INSERT INTO app_config (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE app_config.value < ?
     RETURNING value`,
    [key, token, staleBefore]
  );
  return rows[0]?.value === token ? token : null;
}

export async function releaseLock(d: DB, name: string, token: string): Promise<void> {
  await d.run("UPDATE app_config SET value = ? WHERE key = ? AND value = ?", [pad(0), `lock:${name}`, token]);
}

/** Führt `fn` unter der Sperre aus; läuft schon ein Lauf, kommt `null` zurück. */
export async function withLock<T>(d: DB, name: string, fn: () => Promise<T>, staleMs?: number): Promise<T | null> {
  const token = await acquireLock(d, name, staleMs);
  if (!token) return null;
  try {
    return await fn();
  } finally {
    await releaseLock(d, name, token).catch(() => {});
  }
}
