import { GOOGLE_TOKEN_URL } from "@/lib/google-jwt";

/**
 * „Mit Google verbinden“: OAuth 2.0 (Authorization Code) für Google Drive.
 *
 * Für normale Google-Konten ohne Workspace-Admin-Konsole – dort gibt es keine
 * domänenweite Delegation, und Service-Accounts haben in „Meine Ablage“ kein
 * Speicherkontingent. Stattdessen bestätigt der Nutzer einmal den Zugriff;
 * Arion OS speichert nur den Refresh-Token (verschlüsselt, app_config).
 *
 *   GOOGLE_OAUTH_CLIENT_ID       OAuth-Client (Typ „Webanwendung“) aus der Cloud Console
 *   GOOGLE_OAUTH_CLIENT_SECRET   zugehöriges Secret
 *
 * Weitergeleitet wird auf <origin>/api/google/callback – diese Adresse muss im
 * OAuth-Client als „Autorisierte Weiterleitungs-URI“ eingetragen sein.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export function oauthClientConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function redirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/google/callback`;
}

/** Zustimmungs-Seite von Google. `prompt=consent` erzwingt einen Refresh-Token. */
export function authUrl(origin: string, state: string, loginHint?: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: `${DRIVE_SCOPE} openid email`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `${AUTH_URL}?${p}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>, deadline?: number): Promise<TokenResponse> {
  const left = deadline ? Math.max(1_000, Math.min(15_000, deadline - Date.now())) : 15_000;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(left),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    const msg = data.error_description || data.error || String(res.status);
    if (data.error === "invalid_grant") {
      throw new Error(`Google-Verbindung abgelaufen oder widerrufen – bitte in Arion OS neu „Mit Google verbinden“ (${msg}).`);
    }
    throw new Error(`Google-Anmeldung fehlgeschlagen: ${msg}`);
  }
  return data;
}

/** Code aus dem Callback gegen Tokens tauschen. */
export async function exchangeCode(code: string, origin: string) {
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    redirect_uri: redirectUri(origin),
  });
  if (!t.refresh_token) {
    throw new Error("Google hat keinen Refresh-Token geliefert – bitte unter myaccount.google.com/permissions den Zugriff für Arion OS entfernen und neu verbinden.");
  }
  if (!(t.scope || "").split(" ").includes(DRIVE_SCOPE)) {
    throw new Error("Der Drive-Zugriff wurde nicht erlaubt – beim Verbinden bitte den Haken bei Google Drive setzen.");
  }
  return { refreshToken: t.refresh_token, email: emailFromIdToken(t.id_token) };
}

export async function refreshAccessToken(refreshToken: string, deadline?: number) {
  const t = await tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    },
    deadline
  );
  if (!t.access_token) throw new Error("Google-Anmeldung fehlgeschlagen: kein Access-Token.");
  return { access_token: t.access_token, expires_in: t.expires_in ?? 3600 };
}

/** E-Mail aus dem ID-Token (nur zur Anzeige – kommt direkt vom Token-Endpunkt per TLS). */
export function emailFromIdToken(idToken?: string): string {
  if (!idToken) return "";
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string };
    return payload.email || "";
  } catch {
    return "";
  }
}
