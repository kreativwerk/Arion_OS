import { getDb } from "@/lib/db";
import { sendPushToAll } from "@/lib/push";

/**
 * Push nach einem Briefkasten-Scan: wie viele Briefe angekommen sind und wie
 * viele davon etwas zu tun haben. Tippen öffnet das Post-Modul.
 */
export function letterboxPushText(briefe: { sender: string | null; action: string | null }[]) {
  const n = briefe.length;
  const todo = briefe.filter((b) => (b.action ?? "").trim() && !/^(keine|nichts)\b/i.test((b.action ?? "").trim())).length;
  const alle = [...new Set(briefe.map((b) => (b.sender ?? "").trim()).filter(Boolean))];
  const absender = alle.slice(0, 3);
  return {
    title: `Briefkasten: ${n} ${n === 1 ? "neuer Brief" : "neue Briefe"}${todo ? ` · ${todo} mit To-do` : ""}`,
    body: absender.length ? `Von ${absender.join(", ")}${alle.length > absender.length ? " …" : ""}` : "Jetzt in Arion OS ansehen",
    url: "/post",
  };
}

export async function notifyLetterbox(ids: number[]) {
  if (!ids.length) return;
  const d = await getDb();
  const rows = await d.all<{ sender: string | null; action: string | null }>(
    `SELECT sender, action FROM letters WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  await sendPushToAll(letterboxPushText(rows));
}
