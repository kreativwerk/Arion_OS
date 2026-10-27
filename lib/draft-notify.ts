import type { DB } from "@/lib/db";
import { pushConfigured, sendPushToAll, type PushPayload } from "@/lib/push";

/**
 * Push aufs Handy, sobald Claude einen Mail-Entwurf anlegt.
 *
 * Claude legt Entwürfe an, verschickt sie aber nie selbst. Gesendet wird nur
 * per Knopfdruck in der App (Startseite „Wartet auf dich“ oder Postfach →
 * Entwürfe). Diese Benachrichtigung bringt den Entwurf schnell vor Albert.
 *
 * Läuft im Mail-Cron (pg_cron alle 10 Minuten) und lässt sich zusätzlich über
 * /api/mail/drafts/notify sofort anstoßen. Jeder Entwurf wird nur einmal
 * gemeldet (Spalte notified_at).
 */

export type DraftForPush = { id: number; to_addr: string; subject: string; dateien: number };

export function draftPushPayload(d: DraftForPush): PushPayload {
  const an = d.to_addr.split(",")[0]?.trim() || "ohne Empfänger";
  const anhang = d.dateien > 0 ? ` · ${d.dateien} ${d.dateien === 1 ? "Anhang" : "Anhänge"}` : "";
  return {
    title: `Entwurf wartet: an ${an}`,
    body: `${d.subject || "(ohne Betreff)"}${anhang} – antippen zum Prüfen und Senden`,
    url: `/?entwurf=${d.id}`,
  };
}

export async function notifyNewDrafts(d: DB): Promise<{ gemeldet: number }> {
  if (!pushConfigured()) return { gemeldet: 0 };
  const rows = await d.all<{ id: number; to_addr: string; subject: string }>(
    `SELECT id, to_addr, subject FROM mail_drafts
     WHERE status = 'entwurf' AND source = 'claude' AND (notified_at IS NULL OR notified_at = '')
       AND NOT (sign_spec IS NOT NULL AND sign_spec <> '' AND (sign_status IS NULL OR sign_status = ''))
     ORDER BY id LIMIT 10`
  );
  let gemeldet = 0;
  for (const r of rows) {
    const n = await d.get<{ n: number }>("SELECT COUNT(*) AS n FROM mail_draft_files WHERE draft_id = ?", [r.id]);
    // Erst markieren, dann senden: lieber eine Meldung verpassen als doppelt melden
    await d.run("UPDATE mail_drafts SET notified_at = ? WHERE id = ?", [new Date().toISOString(), r.id]);
    await sendPushToAll(draftPushPayload({ id: Number(r.id), to_addr: r.to_addr, subject: r.subject, dateien: Number(n?.n ?? 0) })).catch(
      () => {}
    );
    gemeldet++;
  }
  return { gemeldet };
}
