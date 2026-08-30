import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, authEnabled, isValidSession } from "@/lib/auth";

/**
 * Zugangsschutz: Ist `APP_PASSWORD` gesetzt, verlangt jede Seite und jede
 * interne API ein gültiges Session-Cookie (siehe lib/auth.ts).
 *
 * Ausgenommen bleiben Routen mit eigener Authentifizierung:
 * - /api/external/*  → Bearer-Token (Codriver)
 * - /api/cron/*      → CRON_SECRET (Vercel Cron)
 * sowie Login und statische PWA-Dateien (Manifest, Service Worker, Icons).
 */
export async function middleware(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const ok = await isValidSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Nicht angemeldet – bitte einloggen." }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Alles außer: Login, Auth-API, extern authentifizierte APIs, Next-Interna,
    // PWA-/Static-Dateien (Manifest, Service Worker, Icons, Logo, Favicon).
    "/((?!login|api/auth/|api/external/|api/cron/|_next/|manifest\\.webmanifest|sw\\.js|icons/|logo\\.svg|icon\\.png|favicon\\.ico).*)",
  ],
};
