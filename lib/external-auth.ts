import { createHash } from "crypto";
import { db } from "@/lib/db";

export type TokenInfo = { id: number; label: string };

/** Prüft den Bearer-Token eines externen Zulieferers gegen die api_tokens-Tabelle. */
export function verifyExternalToken(authHeader: string | null): TokenInfo | null {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const row = db().prepare("SELECT id, label FROM api_tokens WHERE token_hash = ?").get(hash) as
    | TokenInfo
    | undefined;
  if (!row) return null;
  db().prepare("UPDATE api_tokens SET last_used = datetime('now') WHERE id = ?").run(row.id);
  return row;
}
