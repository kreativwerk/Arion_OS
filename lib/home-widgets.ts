/**
 * Startseite als Widget-Baukasten: welche Karten es gibt, in welcher
 * Reihenfolge sie stehen und ob sie die volle Breite nutzen. Das Layout liegt
 * in app_config.home_layout (JSON) und gilt damit auf allen Geräten.
 * Reine Funktionen – ohne DB, testbar.
 */

export type WidgetId =
  | "posteingaenge"
  | "wartet"
  | "faelle"
  | "fristen"
  | "aufgaben"
  | "termine"
  | "konto"
  | "station"
  | "flotte"
  | "wohnwerk"
  | "buchhaltung"
  | "vertraege"
  | "gewohnheiten"
  | "ernaehrung";

export type WidgetDef = { id: WidgetId; label: string; icon: string; beschreibung: string; standardBreit: boolean };

export const WIDGETS: WidgetDef[] = [
  { id: "posteingaenge", label: "Posteingänge", icon: "inbox", beschreibung: "Slack, Mail, Post, Portale – ungelesen", standardBreit: true },
  { id: "wartet", label: "Wartet auf dich", icon: "pending_actions", beschreibung: "Mail-Entwürfe, die nur noch auf Senden warten", standardBreit: false },
  { id: "faelle", label: "Fälle mit Claude", icon: "checklist", beschreibung: "Was mit Claude besprochen wurde – offen und erledigt abhaken", standardBreit: false },
  { id: "fristen", label: "Fristen-Ampel", icon: "timer", beschreibung: "Alle Termine mit Datum: Buchhaltung, Aufgaben, Verträge", standardBreit: false },
  { id: "aufgaben", label: "Aufgaben heute", icon: "task_alt", beschreibung: "Heute fällig, mit täglichen Checks", standardBreit: false },
  { id: "termine", label: "Nächste Termine", icon: "calendar_month", beschreibung: "Kalender der nächsten Tage", standardBreit: false },
  { id: "konto", label: "Konto", icon: "account_balance", beschreibung: "Qonto-Stand und angekündigte Lastschriften", standardBreit: false },
  { id: "station", label: "Station heute", icon: "local_shipping", beschreibung: "DBY5 aus Codriver: Fahrer, Abwesenheiten, Vorfälle", standardBreit: false },
  { id: "flotte", label: "Flotte", icon: "directions_car", beschreibung: "Fahrzeuge, Schäden und Werkstatt aus Codriver", standardBreit: false },
  { id: "wohnwerk", label: "Wohnwerk", icon: "apartment", beschreibung: "Mieteingänge des Monats", standardBreit: false },
  { id: "buchhaltung", label: "Buchhaltung", icon: "receipt_long", beschreibung: "Fehlende Belege, neue Eingänge, nächste Frist", standardBreit: false },
  { id: "vertraege", label: "Verträge im Blick", icon: "contract", beschreibung: "Kündigungsfenster, die bald schließen", standardBreit: false },
  { id: "gewohnheiten", label: "Gewohnheiten", icon: "self_improvement", beschreibung: "Tägliche Gewohnheiten abhaken", standardBreit: false },
  { id: "ernaehrung", label: "Ernährung", icon: "water_drop", beschreibung: "Wasser, Protein, Vitamine", standardBreit: true },
];

export type LayoutItem = { id: WidgetId; an: boolean; breit: boolean };

/** Reihenfolge bei leerem Layout: das Wichtigste oben. */
export const STANDARD_LAYOUT: LayoutItem[] = [
  "posteingaenge",
  "wartet",
  "faelle",
  "fristen",
  "aufgaben",
  "termine",
  "konto",
  "station",
  "flotte",
  "buchhaltung",
  "wohnwerk",
  "vertraege",
  "gewohnheiten",
  "ernaehrung",
].map((id) => {
  const def = WIDGETS.find((w) => w.id === id)!;
  return { id: def.id, an: true, breit: def.standardBreit };
});

const IDS = new Set<string>(WIDGETS.map((w) => w.id));

/**
 * Gespeichertes Layout bereinigen: unbekannte und doppelte Einträge raus.
 * Neue Widgets (die es beim Speichern noch nicht gab) landen hinter ihrem
 * Vorgänger aus dem Standard-Layout – so erscheint ein neues Widget dort,
 * wo es hingehört, statt ganz unten.
 */
export function normalizeLayout(raw: unknown): LayoutItem[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      list = null;
    }
  }
  if (!Array.isArray(list) || list.length === 0) return STANDARD_LAYOUT.map((x) => ({ ...x }));
  const out: LayoutItem[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id = (item as { id?: unknown })?.id;
    if (typeof id !== "string" || !IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    const def = WIDGETS.find((w) => w.id === id)!;
    const breit = (item as { breit?: unknown }).breit;
    out.push({ id: def.id, an: (item as { an?: unknown }).an !== false, breit: typeof breit === "boolean" ? breit : def.standardBreit });
  }
  STANDARD_LAYOUT.forEach((def, i) => {
    if (seen.has(def.id)) return;
    seen.add(def.id);
    // Nächsten Vorgänger aus dem Standard-Layout suchen, der im Layout steht;
    // gibt es keinen, kommt das Widget ans Ende.
    let pos = out.length;
    for (let k = i - 1; k >= 0; k--) {
      const j = out.findIndex((x) => x.id === STANDARD_LAYOUT[k].id);
      if (j >= 0) {
        pos = j + 1;
        break;
      }
    }
    out.splice(pos, 0, { ...def });
  });
  return out;
}

/** Ein Widget um eine Position verschieben (für die Pfeile im Bearbeiten-Modus). */
export function moveItem(layout: LayoutItem[], id: WidgetId, delta: -1 | 1): LayoutItem[] {
  const i = layout.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= layout.length) return layout;
  const next = layout.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/* ── Auswertung von Qonto-Benachrichtigungen (Mail-Archiv) ── */

/** „1.349,82 EUR“ → 1349.82 */
export function parseEuro(s: string): number | null {
  const m = s.match(/(-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|-?\d+(?:,\d{1,2})?)\s*(?:EUR|€)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Qonto „Überweisung erhalten“: Betrag und Absender. */
export function parseQontoEingang(body: string): { betrag: number; von: string } | null {
  const b = body.match(/Betrag:\s*([^\n]+)/);
  const v = body.match(/Von:\s*([^\n]+)/);
  const betrag = b ? parseEuro(b[1]) : null;
  if (betrag === null || !v) return null;
  return { betrag, von: v[1].trim() };
}

const MONATE: Record<string, number> = {
  jan: 1, feb: 2, "mär": 3, mar: 3, mrz: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12,
};

/** Qonto „X wird Ihr Konto am 21. Okt 2026 belasten“: Empfänger, Datum (ISO), Betrag. */
export function parseQontoLastschrift(subject: string, body: string): { an: string; datum: string; betrag: number | null } | null {
  const m = subject.match(/^(.+?) wird Ihr Konto am (\d{1,2})\.\s*([A-Za-zäÄ]{3,})\.?\s*(\d{4}) belasten/);
  if (!m) return null;
  const mon = MONATE[m[3].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  const datum = `${m[4]}-${String(mon).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const b = body.match(/Betrag:\s*([^\n]+)/);
  return { an: m[1].trim(), datum, betrag: b ? parseEuro(b[1]) : null };
}
