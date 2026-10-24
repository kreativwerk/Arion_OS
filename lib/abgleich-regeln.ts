/**
 * Reine Regeln für den Belegabgleich (Bank ↔ Belege in Google Drive) und für
 * Konto 1590. Ohne Netzwerk – getestet in tests/beleg.test.mjs.
 *
 * Belege heißen bei Albert „Lieferant_Betrag“, z. B. „Aral_334,56.pdf“ oder
 * „Sixt_1.211,42 (9603296267 Jan).pdf“. Der Betrag im Dateinamen ist der Schlüssel
 * für den Abgleich, Lieferant und Rechnungsnummer entscheiden bei Gleichstand.
 */

import { MONATE } from "@/lib/beleg-regeln";

export const KAT = {
  gefunden: "Beleg gefunden",
  fehlt: "FEHLT",
  qonto: "Beleg in Qonto",
  ohne: "Kein Beleg nötig",
} as const;

/** "Ausgaben/2026/September" für "2026-09". */
export function monatsOrdner(monat: string): string {
  const [j, m] = monat.split("-");
  return `Ausgaben/${j}/${MONATE[Number(m) - 1]}`;
}

/** Vormonat / Folgemonat als YYYY-MM. */
export function nachbarMonat(monat: string, delta: number): string {
  const [j, m] = monat.split("-").map(Number);
  const d = new Date(Date.UTC(j!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Deutscher Betrag „1.211,42“ → 1211.42. */
export function parseDeBetrag(s: string): number | null {
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Betrag aus dem Dateinamen – bevorzugt direkt nach dem „_“, sonst der erste Betrag. */
export function betragAusDateiname(name: string): number | null {
  const stem = name.replace(/\.[a-z0-9]{2,5}$/i, "");
  const nachUnterstrich = stem.match(/_\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/);
  const irgendwo = stem.match(/(?<![\d,.])(-?\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/);
  const hit = nachUnterstrich?.[1] ?? irgendwo?.[1];
  return hit ? parseDeBetrag(hit) : null;
}

/** Kleinbuchstaben-Wörter (≥ 3 Zeichen) für den Lieferanten-Vergleich. */
export function woerter(s: string): string[] {
  return (s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{3,}/g) ?? []).filter(
    (w) => !["gmbh", "beleg", "fehlt", "fehlen", "und", "der", "die", "das", "von", "fuer", "co"].includes(w)
  );
}

export type Datei = { name: string; url: string; pfad: string; betrag?: number | null };
export type Posten = { key: string | number; betrag: number; text: string; belegnr?: string; monat?: string };

/**
 * Ordnet jeder Buchung höchstens eine Datei zu (jede Datei nur einmal).
 * Gleicher Betrag ist Pflicht; Punkte für Rechnungsnummer im Namen, gemeinsamen
 * Lieferanten und gleichen Monat. Bei mehreren gleich guten Dateien gewinnt die
 * erste – so bleibt das Ergebnis stabil.
 */
export function ordneZu(posten: Posten[], dateien: Datei[], monatVon?: (d: Datei) => string | null): Map<string | number, Datei> {
  const pool = dateien
    .map((d) => ({ ...d, betrag: d.betrag ?? betragAusDateiname(d.name) }))
    .filter((d) => d.betrag !== null && d.betrag > 0);
  const frei = new Set(pool.map((_, i) => i));
  const res = new Map<string | number, Datei>();

  const score = (p: Posten, d: (typeof pool)[number]) => {
    let s = 0;
    const name = d.name.toLowerCase();
    if (p.belegnr && p.belegnr.length >= 4 && name.includes(p.belegnr.toLowerCase())) s += 10;
    const w = woerter(p.text);
    if (w.some((x) => name.includes(x))) s += 4;
    if (p.monat && monatVon && monatVon(d) === p.monat) s += 2;
    return s;
  };

  // Erst die Buchungen mit eindeutigen Hinweisen (Rechnungsnummer), dann der Rest
  const reihenfolge = [...posten].sort((a, b) => Number(Boolean(b.belegnr)) - Number(Boolean(a.belegnr)));
  for (const p of reihenfolge) {
    let best = -1;
    let bestScore = -1;
    for (const i of frei) {
      const d = pool[i]!;
      if (Math.abs((d.betrag ?? 0) - Math.abs(p.betrag)) > 0.005) continue;
      const s = score(p, d);
      if (s > bestScore) {
        best = i;
        bestScore = s;
      }
    }
    if (best >= 0) {
      frei.delete(best);
      res.set(p.key, pool[best]!);
    }
  }
  return res;
}

/** Monat (YYYY-MM) aus einem Drive-Pfad „Ausgaben/2026/September/…“. */
export function monatAusPfad(pfad: string): string | null {
  const m = pfad.match(/Ausgaben\/(\d{4})\/([^/]+)/);
  if (!m) return null;
  const i = MONATE.indexOf(m[2]!);
  return i < 0 ? null : `${m[1]}-${String(i + 1).padStart(2, "0")}`;
}

/** Braucht diese Abbuchung keinen Beleg im Drive? (Lohn, Steuern, Umbuchungen …) */
export function ohneBelegGrund(t: {
  operation_type?: string | null;
  label?: string | null;
  kategorie?: string | null;
  referenz?: string | null;
  gemerkt?: string[];
}): string | null {
  const label = (t.label ?? "").trim().toLowerCase();
  if (t.gemerkt?.includes(label)) return "gemerkt";
  if (t.operation_type === "qonto_fee") return "Qonto-Gebühr (Rechnung in Qonto)";
  const text = `${t.kategorie ?? ""} ${t.referenz ?? ""}`.toLowerCase();
  if (/(gehalt|gehälter|lohn|löhne|salar|payroll|vorschuss)/.test(text)) return "Lohn/Gehalt";
  if (/(finanzamt|steuer|tax)/.test(text) || /finanzamt/.test(label)) return "Steuer";
  if (/(umbuchung|internal transfer|eigene konten|between accounts)/.test(text)) return "Umbuchung";
  return null;
}

/** Eine Zeile aus Daniels 1590-Liste, wie sie das Modell liefert. */
export type Zeile1590 = { datum: string; text: string; betrag: number; belegnr: string };

/** Schlüssel je Zeile; gleiche Zeilen bekommen eine laufende Nummer (#2, #3 …). */
export function schluessel1590(zeilen: Zeile1590[]): string[] {
  const seen = new Map<string, number>();
  return zeilen.map((z) => {
    const base = `${z.datum}|${z.betrag.toFixed(2)}|${z.belegnr.trim()}|${woerter(z.text).slice(0, 2).join(" ")}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

/** Dateiname für einen nachgereichten 1590-Beleg: „Sixt_1.211,42 (9603296267).pdf“. */
export function dateiname1590(text: string, betrag: number, belegnr: string, ext: string): string {
  const lieferant =
    text
      .split(",")[0]!
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "Beleg";
  const b = Math.abs(betrag).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nr = belegnr.trim() ? ` (${belegnr.trim().slice(0, 40)})` : "";
  return `${lieferant}_${b}${nr}.${ext}`;
}
