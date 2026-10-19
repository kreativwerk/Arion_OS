import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { authUrl, oauthClientConfigured } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "arion_google_state";

/** GET /api/google/connect – leitet zur Google-Zustimmung weiter (Login über Middleware). */
export const GET = withApi(async (req: NextRequest) => {
  if (!oauthClientConfigured()) {
    return NextResponse.json(
      { error: "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET fehlen in Vercel – siehe docs/BUCHHALTUNG.md." },
      { status: 400 }
    );
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(req.nextUrl.origin, state, req.nextUrl.searchParams.get("konto") || undefined));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return res;
});
