import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Postfach-Archiv durchsuchen (ohne Mailtexte – die liefert /api/mail/message).
 * ?q=      Suchwörter (alle müssen vorkommen: Betreff, Absender, Empfänger, Text)
 * ?account= Konto-Label   ?folder= inbox | sent | <Pfad>   ?before= ISO-Datum (Blättern)
 */
export const GET = withApi(async (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const q = (p.get("q") || "").trim().toLowerCase();
  const account = p.get("account") || "";
  const folder = p.get("folder") || "";
  const before = p.get("before") || "";
  const limit = Math.min(Math.max(Number(p.get("limit")) || 50, 1), 200);

  const where: string[] = [];
  const params: unknown[] = [];
  for (const token of q.split(/\s+/).filter(Boolean).slice(0, 8)) {
    const like = `%${token.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    where.push(
      "(lower(subject) LIKE ? ESCAPE '\\' OR lower(from_addr) LIKE ? ESCAPE '\\' OR lower(to_addr) LIKE ? ESCAPE '\\' OR lower(cc_addr) LIKE ? ESCAPE '\\' OR lower(body_text) LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like, like);
  }
  if (account) {
    where.push("account = ?");
    params.push(account);
  }
  if (folder === "inbox") where.push("upper(folder) = 'INBOX'");
  else if (folder === "sent") where.push("(lower(folder) LIKE '%gesendet%' OR lower(folder) LIKE '%sent%')");
  else if (folder) {
    where.push("folder = ?");
    params.push(folder);
  }
  if (before) {
    where.push("date < ?");
    params.push(before);
  }

  const d = await getDb();
  const rows = await d.all<Record<string, unknown>>(
    `SELECT id, account, folder, from_addr, to_addr, subject, date, flags, attachments,
            substr(body_text, 1, 220) AS preview
       FROM mails ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY date DESC, id DESC
      LIMIT ${limit}`,
    params
  );
  const stats = await d.all<{ account: string; n: number }>("SELECT account, COUNT(*) AS n FROM mails GROUP BY account ORDER BY account");
  const sync = await d.get<{ last: string | null }>("SELECT MAX(updated_at) AS last FROM mail_sync");
  return NextResponse.json({
    zuletzt: sync?.last ?? null,
    mails: rows.map((r) => ({
      ...r,
      attachments: (() => {
        try {
          return (JSON.parse(String(r.attachments || "[]")) as { filename: string }[]).length;
        } catch {
          return 0;
        }
      })(),
      preview: String(r.preview || "").replace(/\s+/g, " ").trim(),
    })),
    konten: stats.map((s) => ({ account: s.account, n: Number(s.n) })),
  });
});
