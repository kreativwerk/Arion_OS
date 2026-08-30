import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { SESSION_COOKIE, authEnabled, sessionToken, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Login: Passwort prüfen, Session-Cookie setzen. */
export const POST = withApi(async (req: NextRequest) => {
  if (!authEnabled()) {
    return NextResponse.json({ error: "Login ist nicht aktiviert (APP_PASSWORD fehlt)." }, { status: 400 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !(await verifyPassword(password))) {
    // Brute-Force bremsen
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Falsches Passwort." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, (await sessionToken())!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 60, // 60 Tage
  });
  return res;
});
