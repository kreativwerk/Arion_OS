import { createHash } from "crypto";
import { getDb, nowExpr } from "@/lib/db";

export type TokenInfo = { id: number; label: string };

/** Prüft den Bearer-Token eines externen Zulieferers gegen die api_tokens-Tabelle. */
export async function verifyExternalToken(authHeader: string | null): Promise<TokenInfo | null> {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;
  const d = await getDb();
  const hash = createHash("sha256").update(token).digest("hex");
  const row = await d.get<TokenInfo>("SELECT id, label FROM api_tokens WHERE token_hash = ?", [hash]);
  if (!row) return null;
  await d.run(`UPDATE api_tokens SET last_used = ${nowExpr(d)} WHERE id = ?`, [row.id]);
  return row;
}
