/**
 * Ablage-Regeln für eingehende Belege und Dokumente (Alberts Archiv-Struktur).
 * Rein funktional, ohne Imports – direkt mit Node testbar (tests/beleg.test.mjs).
 *
 * Das Modell liefert nur strukturierte Fakten (Firma, Art, Lieferant, Betrag,
 * Datum, Kennzeichen …); Zielordner und Dateinamen baut dieser Code. So bleiben
 * Pfade und Namen einheitlich und das Modell kann keine beliebigen Pfade erfinden.
 */

export const MONATE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export type Firma = "arion" | "wohnwerk" | "kreativwerk" | "fleetfix" | "nicht_arion" | "unklar";
export type Art = "beleg" | "gutschrift" | "mahnung" | "lieferschein" | "dokument";
export type Kategorie =
  | "fahrzeug" | "personal" | "vertrag" | "versicherung" | "behoerde" | "firma" | "objekt" | "kunde" | "sonstiges";

export const FAHRZEUG_ORDNER = [
  "Zulassung & Fahrzeugschein", "Leasing & Miete", "Versicherung", "Wartung & TÜV", "Schäden & Unfälle", "Bußgelder",
] as const;
export const OBJEKT_ORDNER = ["Kauf & Grundbuch", "Mietverträge", "Nebenkosten", "Handwerker & Wartung", "Schriftverkehr"] as const;

export type DokFakten = {
  seiten: string;
  firma: Firma;
  art: Art;
  kategorie: Kategorie;
  lieferant: string;
  betrag: number | null;
  belegdatum: string; // YYYY-MM-DD oder ""
  kurzinhalt: string;
  rg_nr: string;
  kennzeichen: string;
  fahrzeug_ordner: string;
  person: string; // "Nachname, Vorname"
  objekt: string;
  objekt_ordner: string;
  einnahme: boolean;
  bar: boolean;
  sicherheit: "hoch" | "mittel" | "niedrig";
};

export type Ziel = { ziel_pfad: string; dateiname: string };

/** 1247.12 → "1.247,12" */
export function betragDe(v: number): string {
  const [i, d] = Math.abs(v).toFixed(2).split(".");
  return `${v < 0 ? "-" : ""}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`;
}

/** Datei-/Ordnernamen säubern: keine Pfadtrenner, keine Steuerzeichen, kurz. */
export function sauber(s: string, max = 90): string {
  return (s || "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/^[.\s-]+|[.\s]+$/g, "");
}

/** Zulassungsbezirke der Flotte – für Kennzeichen ohne Trennzeichen ("MAZ6358E" → "M-AZ 6358E"). */
const BEZIRKE = ["ERH", "HÖS", "FÜ", "DEG", "NEA", "M", "K", "WI", "N", "ER", "FO", "BA", "SAD", "SW", "HS"];

/** "erh al 339", "ERHAL339", "FÜ-BB 362", "MAZ6358E" → "ERH-AL 339" / "FÜ-BB 362" / "M-AZ 6358E"; unbekannt → bereinigt. */
export function kennzeichenNorm(k: string): string {
  const s = (k || "").toUpperCase().replace(/\s+/g, " ").trim();
  const getrennt = s.match(/^([A-ZÄÖÜ]{1,3})[\s-]+([A-Z]{1,2})[\s-]*(\d{1,4}[EH]?)$/);
  if (getrennt) return `${getrennt[1]}-${getrennt[2]} ${getrennt[3]}`;
  const kompakt = s.replace(/[\s-]/g, "");
  for (const b of [...BEZIRKE].sort((a, c) => c.length - a.length)) {
    const m = kompakt.startsWith(b) ? kompakt.slice(b.length).match(/^([A-Z]{1,2})(\d{1,4}[EH]?)$/) : null;
    if (m) return `${b}-${m[1]} ${m[2]}`;
  }
  return sauber(s, 20);
}

/** "FÜ-BB 357, FÜ-DE 319" / "FÜ-BB 357 und FÜ-DE 319" → je Kennzeichen normalisiert, ohne Doppelte (max. 5). */
export function kennzeichenListe(k: string): string[] {
  const teile = (k || "").split(/\s*(?:,|;|\/|\bund\b|&)\s*/i).map((t) => t.trim()).filter(Boolean);
  return [...new Set(teile.map(kennzeichenNorm).filter(Boolean))].slice(0, 5);
}

/**
 * Amazon-Logistik-Gutschrift an Arion (Self-Billing, Arion ist Leistungserbringer) –
 * eine Einnahme, kein Eingangsbeleg. Erkennbar an „Amazon … Transport/Logistics“
 * oder der Belegnummer „INV-DE…“. Erstattungen von Amazon-Einkäufen fallen nicht darunter.
 */
export function istAmazonGutschrift(f: Pick<DokFakten, "art" | "lieferant" | "rg_nr">): boolean {
  if (f.art !== "gutschrift" || !/amazon/i.test(f.lieferant || "")) return false;
  return /transport|logistic/i.test(f.lieferant) || /^INV-DE/i.test((f.rg_nr || "").trim());
}

function datumOk(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
}

function monatsOrdner(datum: string, fallback: Date): { jahr: string; monat: string; mm: string } {
  const d = datumOk(datum) ? new Date(datum + "T12:00:00Z") : fallback;
  const m = d.getUTCMonth();
  return { jahr: String(d.getUTCFullYear()), monat: MONATE[m], mm: String(m + 1).padStart(2, "0") };
}

function belegName(f: DokFakten): string {
  const lief = sauber(f.lieferant, 40) || "Unbekannt";
  const prefix = f.art === "gutschrift" ? `${lief} Gutschrift` : f.art === "mahnung" ? `${lief} Mahnung` : lief;
  const betrag = f.betrag != null && Number.isFinite(f.betrag) ? betragDe(f.betrag) : "Betrag fehlt";
  const zusatz = [f.rg_nr ? `RG ${sauber(f.rg_nr, 30)}` : "", f.kennzeichen ? kennzeichenNorm(f.kennzeichen) : ""]
    .filter(Boolean)
    .join(", ");
  return `${prefix}_${betrag}${zusatz ? ` (${zusatz})` : ""}.pdf`;
}

function dokName(f: DokFakten): string {
  const datum = datumOk(f.belegdatum) ? f.belegdatum : "";
  const titel = `${sauber(f.lieferant, 40) || "Unbekannt"} – ${sauber(f.kurzinhalt, 80) || "Dokument"}`;
  const betrag = f.betrag != null && Number.isFinite(f.betrag) && f.betrag !== 0 ? `_${betragDe(f.betrag)}` : "";
  return `${datum ? datum + " " : ""}${titel}${betrag}.pdf`;
}

const FIRMA_ARCHIV: Record<string, string> = {
  arion: "Archiv/Arion Logistics",
  wohnwerk: "Archiv/Wohnwerk",
  kreativwerk: "Archiv/Kreativwerk",
  fleetfix: "Archiv/Fleetfix",
};

/**
 * Zielordner + Dateiname(n). Rückgabe [Hauptablage, optionale Kopie].
 * `jetzt` dient als Monat, wenn das Belegdatum fehlt.
 */
export function zielFuer(f: DokFakten, jetzt: Date = new Date()): Ziel[] {
  const out: Ziel[] = [];
  const { jahr, monat, mm } = monatsOrdner(f.belegdatum, jetzt);
  const istZahlung = f.art === "beleg" || f.art === "gutschrift";

  if (f.firma === "unklar" || f.sicherheit === "niedrig") {
    const was = [f.lieferant, f.kurzinhalt, f.betrag != null ? betragDe(f.betrag) : ""].filter(Boolean).join(" ");
    out.push({ ziel_pfad: "Archiv/_Unklar", dateiname: `${sauber(was, 110) || "Dokument"}.pdf` });
    return out;
  }
  if (f.firma === "nicht_arion") {
    const name = istZahlung ? belegName(f).replace(/\.pdf$/, f.bar ? " (bar).pdf" : ".pdf") : dokName(f);
    out.push({ ziel_pfad: "Scans/_Nicht Arion", dateiname: name });
    return out;
  }

  if (f.firma === "arion") {
    // Amazon-Gutschriften (Self-Billing nach § 14 Abs. 2 UStG) sind Einnahmen → Rechnungsausgang
    if (istAmazonGutschrift(f)) {
      const rg = f.rg_nr ? ` (RG ${sauber(f.rg_nr, 40)})` : "";
      const null_ = !f.betrag;
      out.push({
        ziel_pfad: `Ausgaben/${jahr}/${monat}/Rechnungsausgang/Amazon Rechnungen${null_ ? "/Nullbeträge" : ""}`,
        dateiname: `${betragDe(f.betrag ?? 0)}€${rg}.pdf`,
      });
      return out;
    }
    if (istZahlung) {
      out.push({ ziel_pfad: `Ausgaben/${jahr}/${monat}/Rechnungseingang/Belege`, dateiname: belegName(f) });
      if (f.kategorie === "fahrzeug" && f.kennzeichen) {
        const ord = (FAHRZEUG_ORDNER as readonly string[]).includes(f.fahrzeug_ordner) ? f.fahrzeug_ordner : "Wartung & TÜV";
        const datum = datumOk(f.belegdatum) ? f.belegdatum + " " : "";
        const betrag = f.betrag != null ? `_${betragDe(f.betrag)}` : "";
        // mehrere Kennzeichen ("FÜ-BB 357, FÜ-DE 319") → je Fahrzeugakte eine Kopie
        for (const kz of kennzeichenListe(f.kennzeichen)) {
          out.push({
            ziel_pfad: `Archiv/Arion Logistics/02 Fahrzeuge/${kz}/${ord}`,
            dateiname: `${datum}${sauber(f.lieferant, 40)} – ${sauber(f.kurzinhalt, 60) || "Rechnung"}${betrag}.pdf`,
          });
        }
      }
      return out;
    }
    if (f.art === "mahnung") {
      out.push({ ziel_pfad: `Ausgaben/${jahr}/${monat}/Sonstiges/Mahnungen`, dateiname: belegName(f) });
      return out;
    }
    if (f.art === "lieferschein") {
      out.push({ ziel_pfad: `Ausgaben/${jahr}/${monat}/Sonstiges/Lieferscheine & Sonstiges`, dateiname: dokName(f) });
      return out;
    }
    const base = FIRMA_ARCHIV.arion;
    let pfad: string;
    switch (f.kategorie) {
      case "fahrzeug": {
        const kz = f.kennzeichen ? kennzeichenListe(f.kennzeichen)[0] || "_Ohne Kennzeichen" : "_Ohne Kennzeichen";
        const ord = (FAHRZEUG_ORDNER as readonly string[]).includes(f.fahrzeug_ordner) ? f.fahrzeug_ordner : "";
        pfad = `${base}/02 Fahrzeuge/${kz}${ord ? "/" + ord : ""}`;
        break;
      }
      case "personal":
        pfad = `${base}/03 Personal/${sauber(f.person, 60) || "_Ohne Zuordnung"}`;
        break;
      case "vertrag":
        pfad = `${base}/04 Verträge`;
        break;
      case "versicherung":
        pfad = `${base}/05 Versicherungen`;
        break;
      case "behoerde":
        pfad = `${base}/06 Behörden & Recht`;
        break;
      default:
        pfad = `${base}/07 Firma`;
    }
    out.push({ ziel_pfad: pfad, dateiname: dokName(f) });
    return out;
  }

  // Wohnwerk, Kreativwerk, Fleetfix
  const base = FIRMA_ARCHIV[f.firma];
  if (istZahlung || f.art === "mahnung") {
    out.push({
      ziel_pfad: `${base}/01 Buchhaltung/${jahr}/${mm} ${monat}/${f.einnahme ? "Einnahmen" : "Ausgaben"}`,
      dateiname: belegName(f),
    });
    if (f.firma === "wohnwerk" && f.objekt && f.kategorie === "objekt") {
      const ord = (OBJEKT_ORDNER as readonly string[]).includes(f.objekt_ordner) ? f.objekt_ordner : "Handwerker & Wartung";
      out.push({ ziel_pfad: `${base}/02 Objekte/${sauber(f.objekt, 60)}/${ord}`, dateiname: dokName(f) });
    }
    return out;
  }
  if (f.firma === "wohnwerk") {
    if (f.objekt) {
      const ord = (OBJEKT_ORDNER as readonly string[]).includes(f.objekt_ordner) ? f.objekt_ordner : "Schriftverkehr";
      out.push({ ziel_pfad: `${base}/02 Objekte/${sauber(f.objekt, 60)}/${ord}`, dateiname: dokName(f) });
    } else {
      out.push({
        ziel_pfad: `${base}/${f.kategorie === "firma" ? "04 Gesellschaft" : "03 Verträge & Versicherungen"}`,
        dateiname: dokName(f),
      });
    }
    return out;
  }
  if (f.firma === "kreativwerk") {
    const pfad = f.kategorie === "kunde" && f.person ? `${base}/02 Kunden/${sauber(f.person, 60)}` : `${base}/03 Verträge`;
    out.push({ ziel_pfad: pfad, dateiname: dokName(f) });
    return out;
  }
  out.push({ ziel_pfad: `${base}/02 Verträge`, dateiname: dokName(f) });
  return out;
}

/** "GO EZY (EZY GmbH)" / "GoEzy" → "goezy" – Lieferanten tolerant vergleichen. */
export function lieferantKey(s: string): string {
  return (s || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/gmbh|ag|se|kg|co\b|&/g, "").replace(/[^a-z0-9äöüß]/g, "");
}

/** Rechnungsnummer aus einem Ablage-Dateinamen ("… (RG 123, KZ).pdf") oder "". */
export function rgAusName(name: string): string {
  const m = (name || "").match(/\(RG ([^,)]+)/);
  return m ? m[1].trim().toLowerCase() : "";
}

/**
 * Gleicher Beleg? Gleicher Betrag und ähnlicher Lieferant reichen nur, wenn
 * nicht beide unterschiedliche Rechnungsnummern tragen (Mietflotten schicken
 * oft mehrere Rechnungen mit identischem Betrag).
 */
export function gleicherBeleg(
  a: { lieferant: string; betrag: number | null; dateiname: string },
  b: { lieferant: string; betrag: number | null; dateiname: string }
): boolean {
  if (a.betrag == null || b.betrag == null || Math.abs(a.betrag - b.betrag) > 0.005) return false;
  const la = lieferantKey(a.lieferant), lb = lieferantKey(b.lieferant);
  if (!la || !lb || !(la.includes(lb) || lb.includes(la))) return false;
  const ra = rgAusName(a.dateiname), rb = rgAusName(b.dateiname);
  return !(ra && rb && ra !== rb);
}

/**
 * Liegt eine Amazon-Gutschrift mit diesem Betrag schon im Ordner? Alberts Namen
 * sind z. B. „105.852,29€.pdf“, „93.057,34 €.pdf“ oder „100809,17€.pdf“ – verglichen
 * wird der Betrag ohne Punkte/Leerzeichen am Namensanfang.
 */
export function amazonSchonAbgelegt(dateiname: string, vorhandene: string[]): boolean {
  const norm = (s: string) => s.replace(/[\s.]/g, "");
  const m = norm(dateiname).match(/^(-?\d+,\d{2})€/);
  if (!m || m[1] === "0,00") return false;
  return vorhandene.some((n) => n !== dateiname && norm(n).startsWith(m[1] + "€"));
}

/** Sicherheitsnetz für Pfade aus Modell-Fakten: nichts außerhalb des Roots, max. 12 Ebenen. */
export function pfadOk(p: string): boolean {
  const teile = p.split("/");
  return teile.length <= 12 && teile.every((t) => t.length > 0 && t !== "." && t !== "..");
}
