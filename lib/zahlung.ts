/**
 * Zahlungsdaten zu einem Vorgang (Mahnung, Rechnung, Forderung), damit Albert
 * auf „Heute“ das Dokument öffnen und die Überweisung in Qonto anlegen kann.
 *
 * Nur lesend und rein heuristisch: Betrag aus Titel/nächstem Schritt/Stand,
 * IBAN, BIC und Empfänger aus dem verknüpften Brief, Verwendungszweck aus der
 * Referenzzeile. Es wird nichts überwiesen – Albert bestätigt in Qonto selbst.
 */

export type Zahlung = {
  empfaenger: string;
  iban: string | null;
  bic: string | null;
  betrag: number | null;
  zweck: string;
};

export type ZahlungBrief = { sender?: string | null; reference?: string | null; text?: string | null };

const ZAHL_WORT = /überweis|bezahl|zahlung|zahlen\b|mahnung|rechnung|forderung|rückstand|beitrag|gebühr|offene[nr]? betrag/i;
const BETRAG = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:€|EUR\b)/i;
const IBAN = /\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?)\b/g;
const BIC = /\bBIC:?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/;

/** „1.288,30“ → 1288.3 */
export function euroZahl(s: string): number {
  return Number(s.replace(/\./g, "").replace(",", "."));
}

/** IBAN-Prüfziffer nach ISO 13616 (mod 97). */
export function ibanGueltig(iban: string): boolean {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (s.startsWith("DE") && s.length !== 22) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ch of r) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}

/** „DE59360800800525943500“ → „DE59 3608 0080 0525 9435 00“ */
export function ibanFormat(iban: string): string {
  return iban.replace(/\s/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
}

/** Erste gültige IBAN im Text, die nicht zu den eigenen Konten gehört. */
export function ibanAusText(text: string, eigene: string[] = []): { iban: string; bic: string | null } | null {
  const eigen = new Set(eigene.map((e) => e.replace(/\s/g, "").toUpperCase()));
  for (const m of text.matchAll(IBAN)) {
    const roh = m[1]!.replace(/\s/g, "").toUpperCase();
    // IBANs, die über Zeilenenden/Wortgrenzen hinaus gelesen wurden, schrittweise kürzen
    for (let len = Math.min(roh.length, 34); len >= 15; len--) {
      const kandidat = roh.slice(0, len);
      if (!ibanGueltig(kandidat)) continue;
      if (eigen.has(kandidat)) break;
      // BIC in derselben Zeile suchen – erst davor („BIC … IBAN …“), dann dahinter
      const start = m.index ?? 0;
      const zeileVor = text.slice(text.lastIndexOf("\n", start) + 1, start);
      const ende = text.indexOf("\n", start);
      const zeileNach = text.slice(start, ende === -1 ? undefined : ende);
      const bic = zeileVor.match(BIC)?.[1] ?? zeileNach.match(BIC)?.[1] ?? null;
      return { iban: ibanFormat(kandidat), bic };
    }
  }
  return null;
}

/** Verwendungszweck: Referenz aus dem nächsten Schritt, sonst aus der Brief-Referenz. */
export function zweckAus(schritt: string, titel: string, reference: string): string {
  const quelle = `${schritt} ${titel}`;
  const m =
    quelle.match(/\b(?:Ref\.?|Referenz|Verwendungszweck|Kassenzeichen)\s*:?\s*([A-Z0-9][A-Z0-9\-/]{4,})/i) ??
    quelle.match(/\bRe(?:chnung|Nr\.?)\s*(?:Nr\.?|nummer)?\s*:?\s*([A-Z0-9][A-Z0-9\-/]{4,})/i);
  if (m) return m[1]!;
  const teile = reference
    .split(/\s*·\s*/)
    .map((t) => t.trim())
    .filter(Boolean);
  const bevorzugt = teile.find((t) => /^(?:Ref\.?|Kassenzeichen|Rechnungsnr\.?|ReNr\.?|Rechnung)\b/i.test(t)) ?? teile[0];
  return (bevorzugt ?? "").replace(/^(?:Ref\.?|Kassenzeichen|Rechnungsnr\.?|ReNr\.?|Rechnung|Kundennr\.?)\s*:?\s*/i, "").trim();
}

/** Empfängername aus dem Absender des Briefs, ohne Zusätze in Klammern. */
export function empfaengerAus(sender: string): string {
  return sender.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s*–.*$/, "").replace(/\s+/g, " ").trim();
}

/**
 * Zahlungsdaten zu einem Vorgang – null, wenn der Vorgang nicht nach einer
 * Zahlung aussieht (kein Zahlwort oder kein Betrag).
 */
export function zahlungAus(
  v: { titel: string; schritt: string; notes: string },
  briefe: ZahlungBrief[],
  eigeneIbans: string[] = []
): Zahlung | null {
  const kopf = `${v.titel}\n${v.schritt}`;
  if (!ZAHL_WORT.test(kopf)) return null;
  // Betrag: erst im nächsten Schritt (dort steht der zu zahlende Endbetrag), dann im Titel, dann im Stand
  const roh = v.schritt.match(BETRAG)?.[1] ?? v.titel.match(BETRAG)?.[1] ?? v.notes.match(/=\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:€|EUR)/i)?.[1] ?? null;
  if (!roh) return null;
  let iban: Zahlung["iban"] = null;
  let bic: Zahlung["bic"] = null;
  for (const b of briefe) {
    const t = b.text ? ibanAusText(b.text, eigeneIbans) : null;
    if (t) {
      iban = t.iban;
      bic = t.bic;
      break;
    }
  }
  if (!iban) {
    const t = ibanAusText(v.notes, eigeneIbans);
    if (t) ({ iban, bic } = t);
  }
  const brief = briefe[0];
  return {
    empfaenger: empfaengerAus(brief?.sender ?? "") || v.titel.split(/\s[–-]\s/)[0]!.trim(),
    iban,
    bic,
    betrag: euroZahl(roh),
    zweck: zweckAus(v.schritt, v.titel, brief?.reference ?? ""),
  };
}

/** Text des Briefs aus letters.extracted (JSON mit Feld „text“) lesen. */
export function briefText(extracted: string | null | undefined): string {
  if (!extracted) return "";
  try {
    const j = JSON.parse(extracted) as { text?: unknown };
    return typeof j.text === "string" ? j.text : "";
  } catch {
    return "";
  }
}
