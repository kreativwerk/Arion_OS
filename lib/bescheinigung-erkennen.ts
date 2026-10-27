/**
 * Erkennt in der Briefpost Anforderungen von Bescheinigungen und Meldungen:
 * Arbeitsbescheinigung (BA), Bescheinigung über Nebeneinkommen (BA),
 * Entgeltbescheinigung für Kranken-/Verletztengeld (Krankenkasse, EEL) und
 * fehlende DEÜV-Meldungen (An-/Ab-/Jahresmeldung).
 *
 * Reine Funktionen – Tests in tests/bescheinigung.test.mjs.
 */

export const BESCHEINIGUNG_ARTEN = ["arbeitsbescheinigung", "nebeneinkommen", "entgeltbescheinigung", "deuev", "sonstiges"] as const;
export type BescheinigungArt = (typeof BESCHEINIGUNG_ARTEN)[number];

export const ART_LABEL: Record<BescheinigungArt, string> = {
  arbeitsbescheinigung: "Arbeitsbescheinigung",
  nebeneinkommen: "Nebeneinkommen",
  entgeltbescheinigung: "Entgeltbescheinigung Krankengeld",
  deuev: "DEÜV-Meldung",
  sonstiges: "Sonstiges",
};

export type Anforderung = {
  art: BescheinigungArt;
  person: string;
  geb: string; // TT.MM.JJJJ
  rvnr: string;
  stelle: string; // anfordernde Stelle
  zeichen: string;
  von: string; // TT.MM.JJJJ
  bis: string;
  frist: string; // YYYY-MM-DD
  erinnerung: boolean;
};

const MONATE: Record<string, string> = {
  januar: "01", februar: "02", "märz": "03", maerz: "03", april: "04", mai: "05", juni: "06",
  juli: "07", august: "08", september: "09", oktober: "10", november: "11", dezember: "12",
};

/** „01. August 2025“, „1. November 2026“, „21.12.1986“ → „01.08.2025“ (sonst ""). */
export function deDatum(s: string): string {
  const t = s.trim();
  let m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[1].padStart(2, "0")}.${m[2].padStart(2, "0")}.${m[3]}`;
  m = t.match(/^(\d{1,2})\.\s*([A-Za-zäÄ]+)\s+(\d{4})$/);
  if (m && MONATE[m[2].toLowerCase()]) return `${m[1].padStart(2, "0")}.${MONATE[m[2].toLowerCase()]}.${m[3]}`;
  return "";
}

/** „TT.MM.JJJJ“ → „JJJJ-MM-TT“ */
export function isoOf(de: string): string {
  const m = de.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

const DATUM = String.raw`(\d{1,2}\.\s*(?:\d{1,2}\.\d{4}|[A-Za-zäÄ]+\s+\d{4}))`;

function first(text: string, res: RegExp[]): string {
  for (const re of res) {
    const m = text.match(re);
    if (m?.[1]) return m[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

/** Text des Briefs aus `letters.extracted` (JSON {text}) oder Rohtext. */
export function briefText(extracted: string | null | undefined): string {
  if (!extracted) return "";
  try {
    const j = JSON.parse(extracted) as { text?: string };
    return typeof j.text === "string" ? j.text : extracted;
  } catch {
    return extracted;
  }
}

export function erkenneAnforderung(l: {
  subject?: string | null;
  sender?: string | null;
  summary?: string | null;
  extracted?: string | null;
  due_date?: string | null;
}): Anforderung | null {
  const text = briefText(l.extracted);
  const all = `${l.subject ?? ""}\n${l.summary ?? ""}\n${text}`;
  const low = all.toLowerCase();

  let art: BescheinigungArt | null = null;
  if (/nebeneinkommen/.test(low)) art = "nebeneinkommen";
  else if (/arbeitsbescheinigung/.test(low)) art = "arbeitsbescheinigung";
  else if (/entgeltbescheinigung/.test(low) && /(krankengeld|entgeltersatz|verletztengeld|arbeitsunfähig)/.test(low)) art = "entgeltbescheinigung";
  else if (
    /(deüv|anmeldung zur sozialversicherung|abmeldung|jahresmeldung|entgeltmeldung)/.test(low) &&
    /(fehlend|fehlt|erinner|noch nicht|nicht vor)/.test(low) &&
    !/(herzlich willkommen|arbeitgeberkonto)/.test(low)
  )
    art = "deuev";
  if (!art) return null;

  const name = first(text, [
    /Versicherte(?:\(r\)|r)?:\s*([^\n]+)/,
    /(?:Arbeitsbescheinigung|Nebeneinkommen|Bescheinigung\/en)\s+für\s+(?:Herrn\s+|Frau\s+)?([A-ZÄÖÜ][^\n(]+?)\s*(?:\(|\n|$)/,
    /(?:Versicherten|Mitglied|Mitarbeiter(?:in)?)\s*\n+\s*([A-ZÄÖÜ][^\n]+?)\s*\n/,
    /für\s+(?:Herrn\s+|Frau\s+)?([A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+)+)/,
  ]);
  const bkk = text.match(/Name:\s*([^,\n]+),\s*Vorname:\s*([^,\n]+)/);
  const kandidat = name.replace(/\s*\(.*$/, "");
  // Floskeln wie „für Ihre Bemühungen“ sind keine Namen
  const floskel = /^(ihre?n?|sie|unser\w*|den|die|das|diese\w*)\b/i.test(kandidat);
  const person = bkk ? `${bkk[2].trim()} ${bkk[1].trim()}` : floskel ? "" : kandidat;

  const geb = deDatum(
    first(all, [
      new RegExp(String.raw`geboren am\s+${DATUM}`),
      /Geburtsdatum:?\s*(\d{2}\.\d{2}\.\d{4})/,
      /Geb\.-Dat\.:?\s*(\d{2}\.\d{2}\.\d{4})/,
      /geb\.\s*(\d{2}\.\d{2}\.\d{4})/,
    ])
  );
  const rvnr = first(all, [
    /(?:Rentenversicherungsnummer|Versicherungsnummer|Versicherungs-Nr\.?|RVNR):?\s*(\d{8}[A-Z]\d{3})/,
    /\b(\d{8}[A-Z]\d{3})\b/,
  ]);
  const zeichen = first(all, [
    /Mein Zeichen:?\s*([A-Z0-9][A-Z0-9-]{5,})/,
    /Versichertennummer:?\s*([A-Z]\d{9})/,
    /Unser Zeichen:?\s*(\S+)/,
  ]);

  let von = "";
  let bis = "";
  const z = all.match(new RegExp(String.raw`(?:vom|Zeitraum vom|zeitraum vom)\s+${DATUM}\s+bis\s+(?:zum\s+)?${DATUM}`));
  if (z) {
    von = deDatum(z[1]);
    bis = deDatum(z[2]);
  }
  if (!von) {
    const b = all.match(/Beginn\s+(\d{2}\.\d{2}\.\d{4}),\s*Ende\s+(\d{2}\.\d{2}\.\d{4})/);
    if (b) {
      von = b[1];
      bis = b[2];
    }
  }
  if (!bis && art === "deuev") {
    bis = first(all, [/(?:Abmeldung|Anmeldung)[^\n.]{0,60}?zum\s+(\d{2}\.\d{2}\.\d{4})/]);
  }
  if (!von && art === "entgeltbescheinigung") {
    von = deDatum(first(all, [/Arbeitsunfähigkeit ab:?\s*(\d{2}\.\d{2}\.\d{4})/, /AU ab\s*(\d{2}\.\d{2}\.\d{4})/]));
  }

  let frist = isoOf(deDatum(first(all, [new RegExp(String.raw`Erledigung bis (?:zum\s+)?${DATUM}`)])));
  if (!frist && /^\d{4}-\d{2}-\d{2}$/.test(l.due_date ?? "")) frist = String(l.due_date);

  const stelle = (l.sender ?? "").trim() || first(text, [/^(Bundesagentur für Arbeit[^\n]*)/m, /^(BARMER|AOK[^\n]*|BKK[^\n]*)/m]);

  return {
    art,
    person: person.slice(0, 120),
    geb,
    rvnr,
    stelle: stelle.slice(0, 200),
    zeichen: zeichen.slice(0, 60),
    von,
    bis,
    frist,
    erinnerung: /(erinner|liegt mir bisher nicht vor|noch nicht vor|bisherigen aufforderungen)/.test(low),
  };
}

/** Gleicher Vorgang? (gleiche Art und gleiche Person – über RV-Nummer, sonst Name) */
export function gleicherVorgang(
  a: Pick<Anforderung, "art" | "person" | "rvnr">,
  b: Pick<Anforderung, "art" | "person" | "rvnr">
): boolean {
  if (a.art !== b.art) return false;
  if (a.rvnr && b.rvnr) return a.rvnr === b.rvnr;
  return normName(a.person) !== "" && normName(a.person) === normName(b.person);
}

/** Namen vergleichbar machen: Kleinschreibung, Umlaute, Reihenfolge egal. */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}
