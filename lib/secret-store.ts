import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Verschlüsselte Ablage für Zugangsdaten (z.B. IMAP-Passwörter) in der Datenbank.
 *
 * AES-256-GCM; der Schlüssel wird aus `AUTH_SECRET` bzw. `APP_PASSWORD` abgeleitet.
 * Ist beides leer (lokale Entwicklung ohne Login), wird ein fester App-Schlüssel
 * verwendet – das schützt dann nur vor zufälligem Mitlesen, nicht vor Angreifern
 * mit Server-Zugriff. In Produktion also immer APP_PASSWORD/AUTH_SECRET setzen.
 *
 * Format: "enc1:" + base64(iv | authTag | ciphertext)
 */

const PREFIX = "enc1:";

function key(): Buffer {
  const secret =
    process.env.AUTH_SECRET || process.env.APP_PASSWORD || "arion-os-local-development-key";
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

/** Wirft bei falschem Schlüssel (z.B. APP_PASSWORD geändert) oder kaputten Daten. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) throw new Error("Unbekanntes Secret-Format");
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
