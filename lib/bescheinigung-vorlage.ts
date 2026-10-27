import type { BescheinigungArt } from "@/lib/bescheinigung-erkennen";
import type { Lohnart } from "@/lib/lohn-parse";

/**
 * Baut aus einem Vorgang, den gelesenen Verdienstabrechnungen und den Angaben,
 * die nur ein Mensch kennt (Kündigung, Wochenstunden, AU), die Ausfüllvorlage
 * für das SV-Meldeportal. Was fehlt, steht in `fehlend` – die Vorlage ist erst
 * „fertig“, wenn die Liste leer ist.
 *
 * Reine Funktionen – Tests in tests/bescheinigung.test.mjs.
 */

/** Zettel, wie er in lohn_zettel liegt (Beträge in Cent). */
export type Zettel = {
  pn: string;
  monat: string; // YYYY-MM
  name: string;
  geb: string;
  rvnr: string;
  eintritt: string;
  austritt: string;
  kk: string;
  bgrs: string;
  pgr: string;
  sv_tage: number;
  brutto_ct: number;
  sv_lfd_ct: number;
  sv_eb_ct: number;
  netto_ct: number;
  lohnarten: Lohnart[];
};

export type Vorgang = {
  art: BescheinigungArt;
  person: string;
  geb: string;
  rvnr: string;
  stelle: string;
  zeichen: string;
  von: string;
  bis: string;
  frist: string;
};

/** Von Hand ergänzte Angaben (JSON in bescheinigungen.angaben). */
export type Angaben = {
  wochenstunden?: string;
  taetigkeit?: string;
  // Beendigung (wie „Fragebogen zur Arbeitsbescheinigung“)
  beendet_durch?: string; // Arbeitgeber | Arbeitnehmer | Aufhebungsvertrag | Befristung | Tod
  gekuendigt_am?: string;
  beendet_zum?: string;
  kuendigungsfrist?: string;
  befristet_bis?: string;
  freistellung_ab?: string;
  abfindung?: string;
  // Nebeneinkommen: Stunden je Kalenderwoche, Schlüssel = Montag (TT.MM.JJJJ)
  wochen?: Record<string, string>;
  // Entgeltbescheinigung Krankengeld
  au_beginn?: string;
  letzter_arbeitstag?: string;
  efz_ende?: string;
  // DEÜV
  meldegrund?: string;
  taetigkeitsschluessel?: string;
};

export type Feld = { label: string; wert: string; hinweis?: string; fehlt?: boolean; angabe?: keyof Angaben; /** Schlüssel in angaben.wochen */ woche?: string };
export type Tabelle = { kopf: string[]; zeilen: string[][]; summe?: string[] };
export type Abschnitt = { titel: string; felder: Feld[]; tabelle?: Tabelle; hinweis?: string };
export type Vorlage = { titel: string; abschnitte: Abschnitt[]; fehlend: string[]; warnungen: string[] };

export function eur(ct: number): string {
  const v = (Math.abs(ct) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${ct < 0 ? "-" : ""}${v} €`;
}

const TITEL: Record<BescheinigungArt, string> = {
  arbeitsbescheinigung: "Arbeitsbescheinigung nach § 312 SGB III",
  nebeneinkommen: "Bescheinigung über Nebeneinkommen (§ 313 SGB III)",
  entgeltbescheinigung: "Entgeltbescheinigung zur Berechnung von Krankengeld (EEL)",
  deuev: "DEÜV-Meldung",
  sonstiges: "Bescheinigung",
};

/** „TT.MM.JJJJ“ → Date (UTC) */
function dt(de: string): Date | null {
  const m = de?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
}
function de(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}
function monatDe(m: string): string {
  const [y, mo] = m.split("-");
  return `${mo}.${y}`;
}
function monatsGrenzen(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `01.${String(mo).padStart(2, "0")}.${y} – ${last}.${String(mo).padStart(2, "0")}.${y}`;
}

/** Je Abrechnungsmonat zusammengefasst (Korrekturläufe desselben Monats werden addiert). */
export type MonatsWert = { monat: string; svLfd: number; svEb: number; brutto: number; netto: number; svTage: number; stunden: number; arten: string[]; korrektur: boolean };

export function monatsWerte(zettel: Zettel[]): MonatsWert[] {
  const map = new Map<string, MonatsWert>();
  for (const z of zettel) {
    const w = map.get(z.monat) ?? { monat: z.monat, svLfd: 0, svEb: 0, brutto: 0, netto: 0, svTage: 0, stunden: 0, arten: [], korrektur: false };
    w.svLfd += z.sv_lfd_ct;
    w.svEb += z.sv_eb_ct;
    w.brutto += z.brutto_ct;
    w.netto += z.netto_ct;
    if (z.brutto_ct !== 0) w.svTage = Math.max(w.svTage, Number(z.sv_tage) || 0);
    for (const la of z.lohnarten ?? []) {
      if (la.nr === "099") continue;
      // Zeitlohn/Überstunden: [Stunden, Faktor, Betrag]
      if ((la.nr === "200" || la.nr === "322") && la.werte.length >= 3) w.stunden += la.werte[0];
      if (la.werte.some((v) => v < 0)) w.korrektur = true;
      const betrag = la.werte[la.werte.length - 1];
      if (!["665", "411"].includes(la.nr)) w.arten.push(`${la.text}${betrag !== undefined ? ` ${betrag.toLocaleString("de-DE", { minimumFractionDigits: 2 })}` : ""}`);
    }
    map.set(z.monat, w);
  }
  return [...map.values()].filter((w) => w.brutto !== 0 || w.svLfd !== 0).sort((a, b) => a.monat.localeCompare(b.monat));
}

/** Stammdaten aus dem jüngsten Zettel. */
function stamm(zettel: Zettel[]): Zettel | null {
  return [...zettel].sort((a, b) => b.monat.localeCompare(a.monat))[0] ?? null;
}

/** Vereinbarte Wochenstunden aus Monatsgehalt / Stundenlohn ableiten (173 Std./Monat ≈ 40 Std./Woche). */
function wochenstundenVorschlag(zettel: Zettel[]): string {
  // Vollzeit-Monatsgehalt → 40 Std.; Stundenlöhner/Minijob: muss von Hand rein
  return zettel.some((z) => (z.lohnarten ?? []).some((l) => l.nr === "100")) ? "40" : "";
}

function f(label: string, wert: string | undefined, opts: Partial<Feld> = {}): Feld {
  const leer = !wert || !String(wert).trim();
  return { label, wert: leer ? "" : String(wert), fehlt: leer && !opts.hinweis ? true : opts.fehlt, ...opts };
}

export function baueVorlage(v: Vorgang, zettel: Zettel[], a: Angaben): Vorlage {
  const s = stamm(zettel);
  const werte = monatsWerte(zettel);
  const warnungen: string[] = [];
  const abschnitte: Abschnitt[] = [];

  if (!zettel.length) warnungen.push("Keine Verdienstabrechnung zu dieser Person gefunden – Abrechnungen einlesen oder RV-Nummer prüfen.");
  if (s && v.rvnr && s.rvnr && s.rvnr !== v.rvnr) {
    warnungen.push(`RV-Nummer weicht ab: Anforderung ${v.rvnr}, Abrechnung ${s.rvnr}. Vor dem Senden klären.`);
  }

  abschnitte.push({
    titel: "Angaben zur Person",
    felder: [
      f("Name", s?.name || v.person),
      f("Geburtsdatum", s?.geb || v.geb),
      f("Versicherungsnummer", s?.rvnr || v.rvnr),
      f("Personalnummer", s?.pn),
      f("Krankenkasse", s?.kk),
    ],
  });

  const zeitraum: Abschnitt = { titel: "Beschäftigung", felder: [] };
  const eintritt = s?.eintritt ?? "";
  const austritt = s?.austritt ?? "";
  zeitraum.felder.push(f("Beschäftigt seit", eintritt));
  zeitraum.felder.push(f("Austritt laut Abrechnung", austritt, { hinweis: austritt ? undefined : "noch beschäftigt" }));
  if (v.von || v.bis) zeitraum.felder.push(f("Angefragter Zeitraum", `${v.von} – ${v.bis}`.trim()));
  zeitraum.felder.push(f("Beitragsgruppe / Personengruppe", s ? `${s.bgrs} / ${s.pgr}` : ""));
  zeitraum.felder.push(f("Tätigkeit", a.taetigkeit || "Paketzusteller / Fahrer", { angabe: "taetigkeit" }));
  zeitraum.felder.push(
    f("Vereinbarte Wochenarbeitszeit (Std.)", a.wochenstunden || wochenstundenVorschlag(zettel), {
      angabe: "wochenstunden",
      hinweis: a.wochenstunden ? undefined : "aus dem Monatsgehalt abgeleitet – bitte bestätigen",
    })
  );
  if (v.bis && austritt && v.bis !== austritt && v.art === "arbeitsbescheinigung") {
    warnungen.push(`Ende laut Anforderung ${v.bis}, laut Abrechnung ${austritt}. Es gilt der tatsächliche Zeitraum – vor dem Senden festlegen.`);
  }
  abschnitte.push(zeitraum);

  if (v.art === "arbeitsbescheinigung") {
    abschnitte.push({
      titel: "Beendigung",
      felder: [
        f("Beendet durch", a.beendet_durch, { angabe: "beendet_durch" }),
        f("Kündigung/Vertrag vom", a.gekuendigt_am, { angabe: "gekuendigt_am" }),
        f("Beendet zum", a.beendet_zum || austritt, { angabe: "beendet_zum" }),
        f("Kündigungsfrist", a.kuendigungsfrist, { angabe: "kuendigungsfrist" }),
        f("Befristet bis", a.befristet_bis || s?.austritt, { angabe: "befristet_bis", hinweis: a.befristet_bis ? undefined : "aus Abrechnung (Austrittsdatum) – prüfen" }),
        f("Freistellung ab", a.freistellung_ab, { angabe: "freistellung_ab", hinweis: a.freistellung_ab ? undefined : "keine" }),
        f("Abfindung", a.abfindung, { angabe: "abfindung", hinweis: a.abfindung ? undefined : "keine" }),
      ],
    });
    const letzte = werte.slice(-12);
    const ua = zettel.flatMap((z) => (z.lohnarten ?? []).filter((l) => l.nr === "481").map((l) => ({ m: z.monat, b: l.werte[l.werte.length - 1] })));
    abschnitte.push({
      titel: "Arbeitsentgelt (abgerechnete Monate, max. 12)",
      felder: ua.length ? [f("Urlaubsabgeltung", ua.map((u) => `${monatDe(u.m)}: ${u.b.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`).join(", "))] : [f("Urlaubsabgeltung", "keine", { hinweis: "keine" })],
      tabelle: {
        kopf: ["Zeitraum", "Beitragspfl. Entgelt", "Einmalzahlung", "Stunden", "Inhalt"],
        zeilen: letzte.map((w) => [
          `${monatsGrenzen(w.monat)}${w.svTage && w.svTage < 30 ? ` (${w.svTage} SV-Tage)` : ""}`,
          eur(w.svLfd),
          w.svEb ? eur(w.svEb) : "–",
          w.stunden ? w.stunden.toLocaleString("de-DE") : "–",
          w.arten.join(", ") + (w.korrektur ? " · Korrektur im Lauf" : ""),
        ]),
        summe: ["Summe", eur(letzte.reduce((x, w) => x + w.svLfd, 0)), eur(letzte.reduce((x, w) => x + w.svEb, 0)), "", ""],
      },
      hinweis: "Steuerfreie Reisekosten/Verpflegung sind nicht beitragspflichtig und nicht enthalten.",
    });
    if (werte.some((w) => w.korrektur)) warnungen.push("In einem Monat steht eine Korrektur (negativer Betrag). Zuordnung zum richtigen Monat prüfen.");
  }

  if (v.art === "nebeneinkommen") {
    const von = dt(v.von);
    const bis = dt(v.bis);
    const zeilen: string[][] = [];
    const felder: Feld[] = [];
    if (von && bis) {
      const start = new Date(von);
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // Montag
      for (let w = new Date(start); w <= bis; w.setUTCDate(w.getUTCDate() + 7)) {
        const ende = new Date(w);
        ende.setUTCDate(ende.getUTCDate() + 6);
        const key = de(w);
        const std = a.wochen?.[key] ?? "";
        felder.push(f(`Woche ${key} – ${de(ende > bis ? bis : ende)}`, std, { angabe: "wochen", woche: key }));
      }
    }
    const imZeitraum = werte.filter((w) => {
      if (!von || !bis) return true;
      const [y, m] = w.monat.split("-").map(Number);
      const anfang = new Date(Date.UTC(y, m - 1, 1));
      const ende = new Date(Date.UTC(y, m, 0));
      return ende >= von && anfang <= bis;
    });
    for (const w of imZeitraum) zeilen.push([monatDe(w.monat), w.stunden ? w.stunden.toLocaleString("de-DE") : "–", eur(w.brutto), eur(w.netto)]);
    abschnitte.push({ titel: "Arbeitsentgelt je Abrechnungsmonat", felder: [], tabelle: { kopf: ["Monat", "Stunden", "Brutto", "Netto"], zeilen } });
    abschnitte.push({
      titel: "Stunden je Kalenderwoche",
      felder,
      hinweis: "Tatsächlich geleistete Stunden (Kenjo). Die Summe muss zu den abgerechneten Monatsstunden passen.",
    });
  }

  if (v.art === "entgeltbescheinigung") {
    const au = a.au_beginn || v.von;
    const auD = dt(au);
    let efz = a.efz_ende ?? "";
    if (!efz && auD) {
      const e = new Date(auD);
      e.setUTCDate(e.getUTCDate() + 41);
      efz = de(e);
    }
    // letzter abgerechneter Monat VOR der AU
    const vorher = auD
      ? werte.filter((w) => {
          const [y, m] = w.monat.split("-").map(Number);
          return new Date(Date.UTC(y, m, 0)) < auD;
        })
      : werte;
    const bem = vorher[vorher.length - 1];
    const eb12 = auD
      ? zettel.filter((z) => z.sv_eb_ct && z.monat < `${auD.getUTCFullYear()}-${String(auD.getUTCMonth() + 1).padStart(2, "0")}`).reduce((x, z) => x + z.sv_eb_ct, 0)
      : 0;
    abschnitte.push({
      titel: "Arbeitsunfähigkeit",
      felder: [
        f("Arbeitsunfähig ab", au, { angabe: "au_beginn" }),
        f("Letzter Arbeitstag", a.letzter_arbeitstag, { angabe: "letzter_arbeitstag" }),
        f("Ende der Entgeltfortzahlung", efz, { angabe: "efz_ende", hinweis: a.efz_ende ? undefined : "6 Wochen gerechnet – mit AU-Bescheinigung abgleichen" }),
      ],
    });
    abschnitte.push({
      titel: "Entgelt im letzten abgerechneten Monat vor der AU",
      felder: [
        f("Abrechnungszeitraum", bem ? monatsGrenzen(bem.monat) : ""),
        f("Bruttoarbeitsentgelt", bem ? eur(bem.brutto) : ""),
        f("Nettoarbeitsentgelt", bem ? eur(bem.netto) : ""),
        f("Beitragspflichtiges Entgelt", bem ? eur(bem.svLfd) : ""),
        f("Bezahlte Stunden", bem?.stunden ? bem.stunden.toLocaleString("de-DE") : "", { hinweis: bem?.stunden ? undefined : "Monatsgehalt" }),
        f("Einmalzahlungen letzte 12 Monate", eb12 ? eur(eb12) : "keine", { hinweis: "aus den Abrechnungen" }),
      ],
    });
  }

  if (v.art === "deuev") {
    const jahr = (v.bis || v.von).slice(-4);
    const imJahr = werte.filter((w) => w.monat.startsWith(jahr));
    const summe = imJahr.reduce((x, w) => x + w.svLfd + w.svEb, 0);
    const ende = austritt && austritt.endsWith(jahr) ? austritt : v.bis;
    abschnitte.push({
      titel: "Meldung",
      felder: [
        f("Meldegrund", a.meldegrund || (austritt && austritt.endsWith(jahr) ? "30 – Abmeldung (Ende der Beschäftigung)" : "50 – Jahresmeldung"), { angabe: "meldegrund" }),
        f("Zeitraum", `${eintritt && eintritt.endsWith(jahr) ? eintritt : `01.01.${jahr}`} – ${ende}`),
        f("Beitragspflichtiges Entgelt (volle Euro)", summe ? `${Math.round(summe / 100).toLocaleString("de-DE")} € (${eur(summe)})` : ""),
        f("Tätigkeitsschlüssel", a.taetigkeitsschluessel, { angabe: "taetigkeitsschluessel", hinweis: a.taetigkeitsschluessel ? undefined : "aus den SD-Worx-Stammdaten übernehmen" }),
      ],
      tabelle: {
        kopf: ["Monat", "laufend", "Einmalzahlung"],
        zeilen: imJahr.map((w) => [monatDe(w.monat), eur(w.svLfd), w.svEb ? eur(w.svEb) : "–"]),
      },
    });
  }

  const fehlend = abschnitte.flatMap((x) => x.felder.filter((y) => y.fehlt).map((y) => `${x.titel}: ${y.label}`));
  return { titel: TITEL[v.art], abschnitte, fehlend, warnungen };
}

/**
 * Liegt derselbe Abrechnungsmonat in mehreren Dateien (Kopie, Test- und
 * Echtlauf), zählt nur eine Datei: die mit der höchsten Laufnummer im Namen
 * („…_009306_6.pdf“ < „…_009306_8.pdf“). Mehrere Zettel desselben Monats aus
 * dieser einen Datei (Rückrechnungen) bleiben alle drin.
 */
export function waehleQuellen<T extends { pn: string; monat: string; quelle_id: string; quelle_name?: string }>(rows: T[]): T[] {
  const best = new Map<string, string>();
  const rank = (n = "") => n.replace(/(\d+)/g, (m) => m.padStart(10, "0"));
  for (const r of rows) {
    const k = `${r.pn}|${r.monat}`;
    const cur = best.get(k);
    const curName = rows.find((x) => x.quelle_id === cur)?.quelle_name;
    if (!cur || rank(r.quelle_name) > rank(curName)) best.set(k, r.quelle_id);
  }
  return rows.filter((r) => best.get(`${r.pn}|${r.monat}`) === r.quelle_id);
}
