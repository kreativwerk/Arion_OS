/**
 * Seitenangaben für Ablage-Aufträge, z.B. "1-3,5" oder "3, 7-8".
 * Leer = alle Seiten. Rein funktional (keine Imports), damit das Test-Skript
 * die Datei direkt mit Node laden kann (tests/buchhaltung.test.mjs).
 */

/** Liefert 0-basierte Seitenindizes in der angegebenen Reihenfolge (ohne Duplikate).
 *  Wirft einen Error mit deutscher Meldung bei ungültiger Angabe. */
export function parsePageRanges(spec: string | null | undefined, pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("Dokument hat keine Seiten.");
  const s = (spec ?? "").trim();
  if (!s) return Array.from({ length: pageCount }, (_, i) => i);
  if (s.length > 500) throw new Error("Seitenangabe zu lang.");
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of s.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?$/);
    if (!m) throw new Error(`Ungültige Seitenangabe: „${part}“`);
    const from = Number(m[1]);
    const to = m[2] !== undefined ? Number(m[2]) : from;
    if (from < 1 || to < 1) throw new Error(`Seitenzahlen beginnen bei 1: „${part}“`);
    if (to < from) throw new Error(`Absteigender Bereich: „${part}“`);
    if (to > pageCount) throw new Error(`Seite ${to} existiert nicht (Dokument hat ${pageCount} Seiten).`);
    for (let p = from; p <= to; p++) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p - 1);
      }
    }
  }
  if (out.length === 0) throw new Error("Seitenangabe enthält keine Seiten.");
  return out;
}

/** Hängt " (n)" vor die Dateiendung: "Allianz_1,00.pdf" → "Allianz_1,00 (2).pdf". */
export function numberedName(name: string, n: number): string {
  if (n <= 1) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/** Erster freier Name, der nicht in `existing` vorkommt (Groß/Klein egal wie Drive: exakt). */
export function firstFreeName(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  for (let n = 1; n < 1000; n++) {
    const candidate = numberedName(name, n);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Kein freier Dateiname für „${name}“ gefunden.`);
}
