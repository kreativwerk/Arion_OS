import { createSign } from "crypto";

/**
 * JWT (RS256) für den OAuth-2.0-Flow eines Google-Service-Accounts – ohne
 * zusätzliche Abhängigkeit, nur node:crypto. Rein funktional, damit das
 * Test-Skript die Datei direkt laden kann (tests/buchhaltung.test.mjs).
 */

export type ServiceAccountKey = { client_email: string; private_key: string; token_uri?: string };

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Signierte Assertion für den Token-Tausch (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`).
 *  `subject` = optionale Nutzer-Adresse für domänenweite Delegation. */
export function buildServiceAccountJwt(
  key: ServiceAccountKey,
  scope: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  subject?: string
): string {
  if (!key.client_email || !key.private_key) throw new Error("Service-Account-Schlüssel unvollständig (client_email/private_key).");
  const header = { alg: "RS256", typ: "JWT" };
  const claims: Record<string, string | number> = {
    iss: key.client_email,
    scope,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  if (subject) claims.sub = subject;
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(key.private_key.replace(/\\n/g, "\n"));
  return `${unsigned}.${b64url(signature)}`;
}
