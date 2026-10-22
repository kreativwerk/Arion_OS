/**
 * Firestore-REST-Werte → schlichtes JSON, mit rekursiver Schwärzung
 * (Port der Regeln aus Codriver tools/codriver-mcp/redact.js).
 * Rein funktional, ohne Imports – direkt mit Node testbar (tests/codriver.test.mjs).
 *
 * Geschwärzt wird an jeder Tiefe: Bank-/Steuer-/Sozialversicherungsdaten,
 * Ausweis-/Pass-Nummern, Diagnosen, Unterschriften, Passwörter/PINs/Tokens,
 * IBAN-förmige Werte sowie Datei-Links und Base64-Blobs. Namen, Telefon und
 * Adressen bleiben (für die Disposition nötig) – wie im Codriver-MCP.
 */

export const REDACTED = "[redacted]";
export const FILE = "[file]";

const KEY_SUBSTRINGS = [
  "iban", "accountnumber", "bank",
  "taxid", "steuer",
  "socialsecurity", "sozialversicherung", "svnummer", "rentenversicherung",
  "healthinsurancenumber", "krankenversicherungsnummer",
  "passportnumber", "idnumber", "ausweisnummer",
  "diagnos", "signature", "unterschrift",
  "password", "passwort", "token", "secret", "apikey",
];
const KEY_WORDS = ["bic", "swift", "pin", "salt", "svnr"];

function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isSensitiveKey(key: string): boolean {
  const norm = key.toLowerCase().replace(/[\s_\-.]/g, "");
  if (KEY_SUBSTRINGS.some((s) => norm.includes(s))) return true;
  return keyWords(key).some((w) => KEY_WORDS.includes(w));
}

const IBAN_LEN: Record<string, number> = {
  AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27,
  GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IT: 27, LT: 20, LU: 20, LV: 21, MK: 19, MT: 31, NL: 18,
  NO: 15, PL: 28, PT: 25, RO: 24, RS: 22, SE: 24, SI: 19, SK: 24, TR: 26, UA: 29, XK: 20, AL: 28,
  BA: 20, ME: 22, MD: 24, LI: 21, IS: 26,
};

function mod97(iban: string): number {
  const re = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of re) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest;
}

export function looksLikeIban(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  const len = IBAN_LEN[s.slice(0, 2)];
  return Boolean(len) && s.length === len && /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s) && mod97(s) === 1;
}

const FILE_URL = /(firebasestorage\.googleapis\.com|storage\.googleapis\.com|firebasestorage\.app\/|^gs:\/\/)/i;

function redactString(s: string): string {
  if (FILE_URL.test(s)) return FILE;
  if (/^data:[^;]+;base64,/i.test(s)) return FILE;
  if (s.length > 2000 && /^[A-Za-z0-9+/=\s]+$/.test(s)) return FILE;
  if (s.length <= 40 && looksLikeIban(s)) return REDACTED;
  // IBANs in Freitext
  return s.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g, (m) => (looksLikeIban(m) ? REDACTED : m));
}

type FsValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  mapValue?: { fields?: Record<string, FsValue> };
  arrayValue?: { values?: FsValue[] };
  referenceValue?: string;
  geoPointValue?: { latitude: number; longitude: number };
  bytesValue?: string;
};

/** Firestore-REST-Wert → JSON (Schwärzung nach Schlüssel erfolgt in decodeFields). */
export function decodeValue(v: FsValue): unknown {
  if (v == null) return null;
  if ("stringValue" in v) return redactString(v.stringValue ?? "");
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue?.fields ?? {});
  if ("arrayValue" in v) return (v.arrayValue?.values ?? []).map(decodeValue);
  if ("referenceValue" in v) return (v.referenceValue ?? "").replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, "");
  if ("geoPointValue" in v) return { lat: v.geoPointValue?.latitude, lng: v.geoPointValue?.longitude };
  if ("bytesValue" in v) return FILE;
  return null;
}

export function decodeFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = isSensitiveKey(k) ? REDACTED : decodeValue(v);
  }
  return out;
}
