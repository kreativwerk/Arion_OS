import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Status + öffentlicher VAPID-Schlüssel für die Client-Registrierung. */
export const GET = withApi(async () => {
  const d = await getDb();
  const row = await d.get<{ n: number }>("SELECT COUNT(*) AS n FROM push_subscriptions");
  return NextResponse.json({
    configured: pushConfigured(),
    publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    subscriptions: Number(row?.n ?? 0),
  });
});

/** PushSubscription des Browsers speichern. */
export const POST = withApi(async (req: NextRequest) => {
  const body = (await req.json()) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    userAgent?: string;
  };
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "Ungültige Subscription" }, { status: 400 });
  }
  const d = await getDb();
  await d.run(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent) VALUES (?,?,?,?)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    [body.endpoint, body.keys.p256dh, body.keys.auth, (body.userAgent ?? "").slice(0, 300)]
  );
  return NextResponse.json({ ok: true }, { status: 201 });
});

/** Abo dieses Geräts entfernen. */
export const DELETE = withApi(async (req: NextRequest) => {
  const { endpoint } = (await req.json()) as { endpoint?: string };
  if (!endpoint) return NextResponse.json({ error: "endpoint fehlt" }, { status: 400 });
  const d = await getDb();
  await d.run("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint]);
  return NextResponse.json({ ok: true });
});
