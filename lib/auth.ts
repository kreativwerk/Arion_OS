/**
 * Login-Schutz für Arion OS (Einzelnutzer).
 *
 * - `APP_PASSWORD` gesetzt → App verlangt Login; Middleware prüft ein
 *   HttpOnly-Session-Cookie (HMAC-signiert, kein Klartext).
 * - `APP_PASSWORD` leer   → kein Login (lokale Entwicklung).
 *
 * Läuft in Edge- UND Node-Runtime, deshalb Web Crypto statt node:crypto.
 */

export const SESSION_COOKIE = "arion_session";
const SESSION_PAYLOAD = "arion-os-session-v1";

function secret(): string | null {
  return process.env.AUTH_SECRET || process.env.APP_PASSWORD || null;
}

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Der gültige Cookie-Wert (deterministisch aus dem Secret abgeleitet). */
export async function sessionToken(): Promise<string | null> {
  const s = secret();
  return s ? hmacHex(s, SESSION_PAYLOAD) : null;
}

/** Konstantzeit-Vergleich – kein Timing-Leak beim Passwort-/Cookie-Check. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Passwort prüfen – beide Seiten werden erst gehasht (gleiche Länge). */
export async function verifyPassword(candidate: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const s = secret()!;
  const [a, b] = await Promise.all([hmacHex(s, candidate), hmacHex(s, expected)]);
  return timingSafeEqual(a, b);
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!authEnabled()) return true;
  if (!cookieValue) return false;
  const expected = await sessionToken();
  return expected !== null && timingSafeEqual(cookieValue, expected);
}
