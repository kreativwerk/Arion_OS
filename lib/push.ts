import webpush from "web-push";
import { getDb } from "@/lib/db";

/**
 * Web-Push-Benachrichtigungen an alle registrierten Geräte (PWA auf dem
 * Homescreen). Braucht VAPID-Schlüssel in der Umgebung:
 *
 *   npx web-push generate-vapid-keys
 *   VAPID_PUBLIC_KEY=…  VAPID_PRIVATE_KEY=…  VAPID_SUBJECT=mailto:info@arion-logistics.de
 *
 * Ohne Schlüssel sind die Push-Funktionen einfach inaktiv – die App läuft normal.
 */

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function initVapid() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:info@arion-logistics.de",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
}

export type PushPayload = {
  title: string;
  body: string;
  /** Pfad in der App, der beim Antippen geöffnet wird, z.B. "/aufgaben" */
  url?: string;
};

/** Sendet eine Benachrichtigung an alle Abos; tote Abos werden entfernt. */
export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; removed: number }> {
  if (!pushConfigured()) return { sent: 0, removed: 0 };
  initVapid();
  const d = await getDb();
  const subs = await d.all<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions"
  );
  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload)
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await d.run("DELETE FROM push_subscriptions WHERE id = ?", [s.id]);
          removed++;
        }
      }
    })
  );
  return { sent, removed };
}
