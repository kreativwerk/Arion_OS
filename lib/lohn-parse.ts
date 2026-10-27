/**
 * SD-Worx-Verdienstabrechnungen lesen (Sammel-PDF „JJJJ_MM_Verdienstabrechnung_40007_…“).
 *
 * Das PDF enthält alle Mitarbeiter eines Abrechnungslaufs hintereinander. Wir
 * bauen den Text zeilenweise mit Abständen nach (wie `pdftotext -layout`),
 * schneiden ihn an den Kopfzeilen „Arion Logistics GmbH“ in einzelne Zettel
 * und lesen daraus die Werte, die Arbeits-, Entgelt- und Nebeneinkommens-
 * bescheinigungen brauchen. Beträge werden in Cent gespeichert.
 *
 * Reine Funktionen (außer pdfToLayoutText) – Tests in tests/bescheinigung.test.mjs.
 */

export type Lohnart = { nr: string; text: string; werte: number[] };

export type LohnZettel = {
  pn: string;
  monat: string; // "YYYY-MM"
  lauf: string; // "/1" usw. aus „Abrechnungsmonat 09.2026/1“
  art: string; // Endabrechnung, Rückrechnung …
  name: string;
  geb: string; // TT.MM.JJJJ
  rvnr: string;
  eintritt: string;
  austritt: string;
  kk: string;
  bgrs: string;
  pgr: string;
  svTage: number;
  bruttoCt: number;
  svLfdCt: number; // beitragspflichtiges laufendes Entgelt (Spalte Soz-Vers-Brutto)
  svEbCt: number; // Einmalbezüge
  nettoCt: number;
  auszahlungCt: number;
  lohnarten: Lohnart[];
};

/** "1.234,56" / "90,40-" → Cent. Leere/ungültige Werte → 0. */
export function centOf(raw: string | undefined): number {
  if (!raw) return 0;
  let s = raw.trim();
  const neg = s.endsWith("-") || s.startsWith("-");
  s = s.replace(/-/g, "").replace(/\./g, "").replace(",", ".");
  const v = Number(s);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) * (neg ? -1 : 1);
}

const NUM = /-?[\d.]*\d,\d+-?/g;

function pick(re: RegExp, s: string): string {
  const m = s.match(re);
  return m ? m[1].trim() : "";
}

/** Text nach Zetteln trennen: jede Kopfzeile „Arion Logistics GmbH“ (nicht die Absenderzeile) beginnt einen Zettel. */
export function splitSlips(text: string): string[] {
  const t = text.replace(/\f/g, "\n");
  const parts = t.split(/(?=^[ \t]*Arion Logistics GmbH[ \t]*$)/m);
  return parts.filter((p) => /Personalnummer\s+\d{3,}/.test(p));
}

/** Monat „09.2026/1“ → { monat: "2026-09", lauf: "1" } */
function monatOf(s: string): { monat: string; lauf: string } {
  const m = s.match(/(\d{2})\.(\d{4})\/?(\d*)/);
  return m ? { monat: `${m[2]}-${m[1]}`, lauf: m[3] || "" } : { monat: "", lauf: "" };
}

export function parseSlip(t: string): LohnZettel {
  const { monat, lauf } = monatOf(pick(/Abrechnungsmonat\s+(\S+)/, t));
  const nameLine = t.split("\n").find((l) => /Steuer-ID/.test(l)) ?? "";
  const name = nameLine.replace(/Steuer-ID.*$/, "").trim();
  const svLfd = (t.match(/\n[ \t]*SV-Brutto\s+lfd\.\s+([^\n]*)/)?.[1] ?? "").match(NUM) ?? [];
  const svEb = (t.match(/\n[ \t]*SV-Brutto\s+Einmalb\.\s+([^\n]*)/)?.[1] ?? "").match(NUM) ?? [];

  const lohnarten: Lohnart[] = [];
  const a = t.indexOf("Tg Lohnart");
  const b = t.indexOf("Gesamtbrutto", a);
  if (a >= 0 && b > a) {
    for (const line of t.slice(a, b).split("\n").slice(1)) {
      const m = line.match(/^\s*(\d{3})\s+(\S.*?)(?:\s{2,}(.*))?$/);
      if (!m) continue;
      lohnarten.push({ nr: m[1], text: m[2].trim(), werte: (m[3]?.match(NUM) ?? []).map((x) => centOf(x) / 100) });
    }
  }

  return {
    pn: pick(/Personalnummer\s+(\d+)/, t),
    monat,
    lauf,
    art: pick(/Art der Abrechnung[ \t]+([^\n]+)/, t),
    name,
    geb: pick(/Geburtsdatum[ \t]+(\d{2}\.\d{2}\.\d{4})/, t),
    rvnr: pick(/Versicherungs-\/Verfahrensnr\.[ \t]+([0-9A-Z]{12})/, t),
    eintritt: pick(/Eintrittsdatum[ \t]+(\d{2}\.\d{2}\.\d{4})/, t),
    austritt: pick(/Austrittsdatum[ \t]+(\d{2}\.\d{2}\.\d{4})/, t),
    kk: pick(/KK:\s*\d+\s+(.+?)(?:\s{2,}|\s+\d+,\d+%|\s+Elterneig|$)/m, t),
    bgrs: pick(/BGRS:\s*(\d+)/, t),
    pgr: pick(/PGR:\s*(\d+)/, t),
    svTage: Number(pick(/SV-Tg\.1:\s*(\d+)/, t) || 0),
    bruttoCt: centOf(pick(/\n[ \t]*Gesamtbrutto[ \t]+(\S+)/, t)),
    svLfdCt: centOf(svLfd[0]),
    svEbCt: centOf(svEb[0]),
    nettoCt: centOf(pick(/\n[ \t]*Netto[ \t]+(\S+)/, t)),
    auszahlungCt: centOf(pick(/Auszahlung \/ Überweisung[ \t]+(\S+)/, t)),
    lohnarten,
  };
}

export function parseSlips(text: string): LohnZettel[] {
  return splitSlips(text)
    .map(parseSlip)
    .filter((z) => z.pn && z.monat);
}

/* ── PDF → Text mit Layout ──────────────────────────────────────────────── */

type TextItem = { str: string; transform: number[]; width: number };

/** Breite einer Zeichenspalte in pt (SD-Worx-Zettel: Festbreitenschrift, ~4,5 pt). */
const CHAR_PT = 4.5;
/** Textstücke, deren Grundlinien so nah beieinander liegen, gehören zu einer Zeile. */
const ROW_TOLERANCE_PT = 3.5;

/**
 * Baut aus den Textstücken einer Seite Zeilen wie `pdftotext -layout`: jedes Stück
 * landet in der Zeichenspalte seiner x-Position, Leerraum-Stücke werden ignoriert.
 */
export function itemsToLines(items: TextItem[]): string[] {
  const parts = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; items: typeof parts }[] = [];
  for (const p of parts) {
    const row = rows.find((r) => Math.abs(r.y - p.y) <= ROW_TOLERANCE_PT);
    if (row) row.items.push(p);
    else rows.push({ y: p.y, items: [p] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      let line = "";
      for (const p of row.items.sort((a, b) => a.x - b.x)) {
        const col = Math.max(0, Math.round(p.x / CHAR_PT));
        line += line.length < col ? " ".repeat(col - line.length) : line ? " " : "";
        line += p.str;
      }
      return line.replace(/\s+$/, "");
    });
}

export async function pdfToLayoutText(data: Uint8Array): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(itemsToLines(content.items as TextItem[]).join("\n"));
  }
  return pages.join("\n");
}
