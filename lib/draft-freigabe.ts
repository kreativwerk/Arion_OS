import type { DB } from "@/lib/db";
import { sendDraft, type SendResult } from "@/lib/mail-send";
import { pushConfigured, sendPushToAll, type PushPayload } from "@/lib/push";

/**
 * Versand von Entwürfen, die Albert im Claude-Chat mit „senden“ freigegeben hat.
 *
 * Ablauf: Claude zeigt die fertige Mail im Chat. Sagt Albert „passt“, bleibt es
 * beim Entwurf (Albert sendet selbst). Sagt er „senden“, setzt Claude den
 * Entwurf per SQL auf `status = 'freigegeben'`. Dieser Lauf schickt ihn dann
 * über denselben Weg wie der Senden-Knopf (lib/mail-send.ts) raus.
 *
 * Läuft im Mail-Cron (pg_cron) und lässt sich über `/api/cron/mail?nur=senden`
 * sofort anstoßen (Claude ruft das per `net.http_post` aus der Datenbank auf).
 * Bis zum Versand kann Albert den Entwurf in der App noch ändern oder verwerfen –
 * jede Änderung setzt ihn zurück auf „entwurf“.
 */

export const FREIGEGEBEN = "freigegeben";

/** Nur Claude-Entwürfe werden ohne Knopfdruck verschickt. */
export const FREIGABE_SQL = `SELECT id, to_addr, subject FROM mail_drafts
  WHERE status = 'freigegeben' AND source = 'claude' ORDER BY id LIMIT 10`;

export type FreigabeErgebnis = { gesendet: number; fehler: string[] };

export function freigabePushPayload(d: { id: number; to_addr: string; subject: string }, res: SendResult): PushPayload {
  const an = d.to_addr.split(",")[0]?.trim() || "ohne Empfänger";
  if (res.ok) {
    return {
      title: `Gesendet: an ${an}`,
      body: `${d.subject || "(ohne Betreff)"}${res.hinweis ? ` – Hinweis: ${res.hinweis}` : ""}`,
      url: `/postfach?entwurf=${d.id}`,
    };
  }
  return {
    title: `Nicht gesendet: an ${an}`,
    body: `${d.subject || "(ohne Betreff)"} – ${res.error ?? "Fehler beim Versand"}`,
    url: `/?entwurf=${d.id}`,
  };
}

export async function sendFreigegebene(d: DB, deadline: number): Promise<FreigabeErgebnis> {
  const rows = await d.all<{ id: number; to_addr: string; subject: string }>(FREIGABE_SQL);
  let gesendet = 0;
  const fehler: string[] = [];
  for (const r of rows) {
    if (Date.now() > deadline) break; // Rest beim nächsten Lauf
    const res = await sendDraft(d, Number(r.id));
    if (res.ok) gesendet++;
    else fehler.push(`#${r.id}: ${res.error ?? res.status}`);
    if (pushConfigured()) {
      await sendPushToAll(freigabePushPayload({ id: Number(r.id), to_addr: r.to_addr, subject: r.subject }, res)).catch(() => {});
    }
  }
  return { gesendet, fehler };
}
