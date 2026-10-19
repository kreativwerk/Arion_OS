import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { resetDriveAuthCache } from "@/lib/google-drive";
import { exchangeCode } from "@/lib/google-oauth";
import { encryptSecret } from "@/lib/secret-store";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "arion_google_state";

/** GET /api/google/callback – Google leitet hierher zurück; Refresh-Token verschlüsselt speichern. */
export async function GET(req: NextRequest) {
  const back = (q: Record<string, string>) => {
    const url = req.nextUrl.clone();
    url.pathname = "/buchhaltung";
    url.search = new URLSearchParams(q).toString();
    const res = NextResponse.redirect(url);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/google", maxAge: 0 });
    return res;
  };

  const p = req.nextUrl.searchParams;
  if (p.get("error")) return back({ drive_fehler: `Google: ${p.get("error")}` });
  const state = p.get("state") || "";
  const cookie = req.cookies.get(STATE_COOKIE)?.value || "";
  if (!state || !cookie || !timingSafeEqual(state, cookie)) {
    return back({ drive_fehler: "Sitzung abgelaufen – bitte noch einmal „Mit Google verbinden“." });
  }
  const code = p.get("code");
  if (!code) return back({ drive_fehler: "Kein Code von Google erhalten." });

  try {
    const { refreshToken, email } = await exchangeCode(code, req.nextUrl.origin);
    const d = await getDb();
    const upsert = "INSERT INTO app_config (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value";
    await d.run(upsert, ["google_drive_refresh", encryptSecret(refreshToken)]);
    await d.run(upsert, ["google_drive_konto", email]);
    resetDriveAuthCache();
    return back({ drive: "verbunden" });
  } catch (e) {
    return back({ drive_fehler: e instanceof Error ? e.message : String(e) });
  }
}
