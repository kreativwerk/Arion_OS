import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getConfig, getDb } from "@/lib/db";
import { driveConfigured, getAccessToken, resetDriveAuthCache } from "@/lib/google-drive";
import { oauthClientConfigured } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

/** GET /api/google/status – Stand der Drive-Verbindung für die Buchhaltungs-Seite. */
export const GET = withApi(async () => {
  const cfg = await getConfig();
  const verbunden = await driveConfigured();
  // Gespeicherte Verbindung kann abgelaufen oder widerrufen sein – dann „Neu verbinden“ anbieten
  let abgelaufen = false;
  let fehler = "";
  if (verbunden) {
    try {
      resetDriveAuthCache();
      await getAccessToken({ deadline: Date.now() + 8_000 });
    } catch (e) {
      abgelaufen = true;
      fehler = e instanceof Error ? e.message : String(e);
    }
  }
  return NextResponse.json({
    oauth_client: oauthClientConfigured(),
    service_account: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    konto: cfg.google_drive_konto || "",
    verbunden,
    abgelaufen,
    fehler,
  });
});

/** DELETE /api/google/status – Verbindung trennen (Token verwerfen, Drive-Dateien bleiben unberührt). */
export const DELETE = withApi(async () => {
  const d = await getDb();
  await d.run("UPDATE app_config SET value = '' WHERE key IN ('google_drive_refresh','google_drive_konto')");
  resetDriveAuthCache();
  return NextResponse.json({ ok: true });
});
