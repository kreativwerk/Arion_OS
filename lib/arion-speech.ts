/**
 * ARION – Sprachausgabe-Formatierung (rein, ohne Abhängigkeiten, testbar).
 *
 * Macht aus einer Antwort (evtl. mit Markdown, Beträgen, Datumsangaben)
 * einen Text, den eine deutsche TTS-Stimme natürlich vorliest:
 *   "1.745,86 €"   → "1.745 Euro 86"
 *   "2026-10-20"   → "20. Oktober" (Jahr nur, wenn es nicht das aktuelle ist)
 *   "**Wichtig:**" → "Wichtig:"
 */

const MONATE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Tausenderpunkte: 1745 → "1.745". */
function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Betrag zum Vorlesen: 1745.86 → "1.745 Euro 86", 0.5 → "50 Cent". */
export function spokenEuro(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const cents = Math.round(Math.abs(amount) * 100);
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  const sign = amount < 0 && cents > 0 ? "minus " : "";
  if (euros === 0 && rest > 0) return `${sign}${rest} Cent`;
  return `${sign}${groupThousands(euros)} Euro${rest > 0 ? ` ${rest}` : ""}`;
}

/** Betrag für die Anzeige: 1745.86 → "1.745,86 €" (mit geschütztem Leerzeichen). */
export function formatEuro(amount: number): string {
  if (!Number.isFinite(amount)) return "–";
  const cents = Math.round(Math.abs(amount) * 100);
  const euros = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  // geschütztes Leerzeichen: "€" bricht nie allein in die nächste Zeile
  return `${amount < 0 && cents > 0 ? "−" : ""}${groupThousands(euros)},${rest}\u00a0€`;
}

/** Deutsche oder einfache Dezimalschreibweise parsen: "1.745,86" → 1745.86,
 *  "1.745" → 1745, "1745.86" → 1745.86. */
export function parseAmount(raw: string): number {
  let s = raw.trim().replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (!/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
  return Number(s);
}

/** Datum zum Vorlesen. `today` (YYYY-MM-DD) erlaubt "heute"/"morgen" und
 *  lässt das Jahr weg, wenn es das aktuelle ist. */
export function spokenDate(iso: string, today?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return iso || "";
  const [, y, mo, d] = m;
  const month = Number(mo);
  if (month < 1 || month > 12) return iso;
  if (today && /^\d{4}-\d{2}-\d{2}$/.test(today)) {
    const diff = Math.round((Date.UTC(+y, month - 1, +d) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86400000);
    if (diff === 0) return "heute";
    if (diff === 1) return "morgen";
    if (diff === 2) return "übermorgen";
    if (diff === -1) return "gestern";
  }
  const sameYear = today ? today.slice(0, 4) === y : false;
  return `${Number(d)}. ${MONATE[month - 1]}${sameYear ? "" : ` ${y}`}`;
}

const MONTH_WORD = new RegExp(`^(${MONATE.join("|")})\\b`);

/** Markdown entfernen und Zeilen zu Sätzen verbinden. */
function stripMarkdown(text: string): string {
  const lines = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "den Link")
    .split(/\r?\n/);
  const out: string[] = [];
  for (let line of lines) {
    line = line
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*[-*•–]\s+/, "");
    // Nummerierte Liste ("1. Punkt") – aber nicht "1. Oktober"
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (num && !MONTH_WORD.test(num[1])) line = num[1];
    line = line
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\|/g, " ")
      .trim();
    if (!line || /^[-=*_\s]+$/.test(line)) continue;
    out.push(/[.!?:;]$/.test(line) ? line : line + ".");
  }
  return out.join(" ");
}

/** Ganze Antwort in Sprechtext umwandeln. */
export function toSpokenText(text: string, today?: string): string {
  if (!text) return "";
  let s = stripMarkdown(text);

  // Beträge: "1.745,86 €", "€ 1.745,86", "1.745,86 EUR", "-12,50 Euro"
  const NUM = "-?\\d[\\d.]*(?:,\\d{1,2})?";
  s = s.replace(new RegExp(`€\\s?(${NUM})|(${NUM})\\s?(?:€|EUR\\b|Euro\\b(?!\\s\\d))`, "g"), (all, a, b) => {
    const n = parseAmount(a ?? b);
    return Number.isFinite(n) ? spokenEuro(n) : all;
  });

  // Datumsangaben: ISO, "20.10.2026", "20.10."
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (all) => spokenDate(all, today));
  s = s.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, (all, d, m, y) =>
    +m >= 1 && +m <= 12 && +d >= 1 && +d <= 31 ? spokenDate(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, today) : all
  );
  s = s.replace(/\b(\d{1,2})\.(\d{1,2})\.(?!\d)/g, (all, d, m) =>
    +m >= 1 && +m <= 12 && +d >= 1 && +d <= 31 ? `${Number(d)}. ${MONATE[+m - 1]}` : all
  );

  // Abkürzungen und Zeichen, die Stimmen schlecht lesen
  s = s
    .replace(/\s?\([A-Z0-9_]{4,}\)/g, "")
    .replace(/(\d)\s?%/g, "$1 Prozent")
    .replace(/\bz\.\s?B\./g, "zum Beispiel")
    .replace(/\bca\./g, "circa")
    .replace(/\bNr\./g, "Nummer")
    .replace(/\bUSt\b/g, "Umsatzsteuer")
    .replace(/\bUSt-/g, "Umsatzsteuer-")
    .replace(/\s&\s/g, " und ")
    .replace(/\s[–—-]\s/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?:;])/g, "$1")
    .replace(/([.!?])\.+/g, "$1")
    .trim();
  return s && !/[.!?:;]$/.test(s) ? s + "." : s;
}

/** Höchstens `max` Sätze – Sicherheitsnetz, damit Sprachantworten kurz bleiben. */
export function limitSentences(text: string, max = 4): string {
  // Satzende = Satzzeichen + Leerzeichen + Großbuchstabe, aber nicht nach einer
  // Ziffer ("20. Oktober", "1.745 Euro 86. Danach" bleiben zusammen).
  const parts = text.trim().split(/(?<=[^\d\s][.!?])\s+(?=[A-ZÄÖÜ])/);
  if (parts.length <= max) return text.trim();
  return parts.slice(0, max).join(" ").trim();
}

/** Monatsname: "2026-10" → "Oktober" (mit Jahr, wenn nicht das aktuelle). */
export function spokenMonth(ym: string, today?: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym || "");
  if (!m || +m[2] < 1 || +m[2] > 12) return ym || "";
  const name = MONATE[+m[2] - 1];
  return today && today.slice(0, 4) === m[1] ? name : `${name} ${m[1]}`;
}

const GENERIC_MAILBOX = /^(no-?reply|noreply|info|mail|service|support|kontakt|hello|hallo|team|news|newsletter|vendor-central|buchhaltung|rechnung|billing|notifications?)$/i;

/** Absender sprechbar machen: "Max Muster <max@x.de>" → "Max Muster",
 *  "no-reply@arval.de" → "Arval", "anna.berg@firma.de" → "anna.berg". */
export function senderName(from: string): string {
  const raw = String(from || "").trim();
  const named = /^"?([^"<]+?)"?\s*<[^>]+>$/.exec(raw);
  if (named) return named[1].trim();
  const m = /^([^@\s]+)@([^@\s>]+)$/.exec(raw.replace(/[<>]/g, ""));
  if (!m) return raw || "unbekannt";
  if (!GENERIC_MAILBOX.test(m[1])) return m[1];
  const parts = m[2].split(".");
  const domain = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

const SEPARABLE = ["zurück", "durch", "nach", "weg", "auf", "aus", "ein", "mit", "vor", "ab", "an", "um", "zu"];

/** Gesprochene Erinnerung in einen Aufgabentitel umformen:
 *  "die Sixt-Rechnung anzufordern" → "Die Sixt-Rechnung anfordern",
 *  "Reifen zu wechseln." → "Reifen wechseln". */
export function taskTitleFromSpeech(raw: string): string {
  let s = String(raw || "").trim().replace(/[.!?]+$/, "").replace(/^(daran|dass|bitte)[,\s]+/i, "");
  const words = s.split(/\s+/);
  const last = words[words.length - 1] ?? "";
  if (words.length > 1 && words[words.length - 2].toLowerCase() === "zu" && /en$|ern$|eln$/.test(last)) {
    words.splice(words.length - 2, 1);
  } else {
    const prefix = SEPARABLE.find((p) => last.toLowerCase().startsWith(p + "zu") && last.length > p.length + 4);
    if (prefix && /(en|ern|eln)$/.test(last)) words[words.length - 1] = last.slice(0, prefix.length) + last.slice(prefix.length + 2);
  }
  s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Datum für die Anzeige: "2026-11-10" → "10.11.2026". */
export function formatDateDe(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? "");
}

/** Kompakter Betrag für kleine Kacheln: 52340.17 → "52,3 T€", 980 → "980 €". */
export function compactEuro(amount: number): string {
  if (!Number.isFinite(amount)) return "–";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(".", ",")}\u00a0Mio.\u00a0€`;
  if (abs >= 10_000) return `${sign}${(abs / 1000).toFixed(1).replace(".", ",").replace(/,0$/, "")}\u00a0T€`;
  return `${sign}${groupThousands(Math.round(abs))}\u00a0€`;
}
