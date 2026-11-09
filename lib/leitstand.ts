/**
 * Leitstand: alle Bereiche auf einen Blick, je Bereich eine Ampel.
 *
 * Reine Funktionen (ohne DB), damit die Ampel-Regeln testbar sind:
 * - `amazonAvis` liest eine Amazon-„Remittance Advice“-Mail aus.
 * - `leitstandBereiche` macht aus den Kennzahlen die Karten mit Ampel.
 * Die Daten sammelt `app/api/leitstand/route.ts` aus den bestehenden Quellen.
 */

export type Ampel = "rot" | "gelb" | "gruen" | "grau";

export type Punkt = { text: string; ton?: "bad" | "warn" | "neutral"; href?: string };

export type Bereich = {
  id: string;
  titel: string;
  icon: string;
  ampel: Ampel;
  /** große Zahl oder kurzer Wert */
  kennzahl: string;
  /** Satz unter der Kennzahl */
  zeile: string;
  punkte: Punkt[];
  href: string;
};

/* ── Amazon-Zahlungsavis ─────────────────────────────────── */

export type AvisPosten = { rechnung: string; datum: string; station: string; woche: string; betrag: number };
export type AmazonAvis = { nummer: string; zahlungsdatum: string; zahler: string; posten: AvisPosten[]; summe: number };

const MONATE: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** „09-NOV-2026“ → „2026-11-09“ */
export function amazonDatum(s: string): string {
  const m = s.trim().match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/i);
  if (!m) return "";
  const mon = MONATE[m[2]!.toUpperCase()];
  return mon ? `${m[3]}-${mon}-${m[1]!.padStart(2, "0")}` : "";
}

/** „93,222.76“ / „(2,947.11)“ → 93222.76 / -2947.11 (Amazon schreibt englisch) */
export function amazonBetrag(s: string): number {
  const t = s.trim();
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Number(t.replace(/[()\-\s]/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

/** Liest eine „Remittance Advice“-Mail von Amazon Accounts Payable aus – null, wenn es keine ist. */
export function amazonAvis(subject: string, body: string): AmazonAvis | null {
  if (!/remittance advice/i.test(subject)) return null;
  const t = body.replace(/\s+/g, " ");
  const nummer = t.match(/Payment number:\s*(\d+)/i)?.[1] ?? subject.match(/Payment#\s*(\d+)/i)?.[1] ?? "";
  const zahlungsdatum = amazonDatum(t.match(/Payment date:\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i)?.[1] ?? "");
  const zahler = (t.match(/payment has been made by (.+?)\.\s/i)?.[1] ?? "").trim();
  const posten: AvisPosten[] = [];
  const re =
    /(INV-[A-Z0-9-]+)\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(.+?)\s+-\s+([A-Z]{3}\d)\s+(\(?-?[\d,]+\.\d{2}\)?)\s+(\(?-?[\d,]+\.\d{2}\)?)/g;
  for (const m of t.matchAll(re)) {
    const woche = m[3]!.match(/Week\s+(\d{6})/i)?.[1] ?? "";
    posten.push({ rechnung: m[1]!, datum: amazonDatum(m[2]!), station: m[4]!, woche, betrag: amazonBetrag(m[5]!) });
  }
  if (!nummer || !posten.length) return null;
  return { nummer, zahlungsdatum, zahler, posten, summe: Math.round(posten.reduce((s, p) => s + p.betrag, 0) * 100) / 100 };
}

/* ── Ampel-Regeln ────────────────────────────────────────── */

export type LeitstandInput = {
  today: string;
  /** Stationen, für die Arion fährt – alles andere in einem Avis wird markiert */
  eigeneStationen: string[];
  konto: { saldo: number | null; stand: string | null; summe7: number; lastschriften: { an: string; datum: string; betrag: number | null; tage: number }[] };
  amazon: AmazonAvis[];
  buchhaltung: { monat: string; fehlt_anzahl: number; fehlt_summe: number; eingang_neu: number; naechste_frist: { titel: string; faellig: string } | null } | null;
  vorgaenge: { beiDir: number; ueberfaellig: number; nachhaken: number; wartet: number; dringend: string[] };
  entwuerfe: number;
  eingang: { briefe: number; mails: number; mitarbeiter: number; gesamt: number };
  fristen: { titel: string; datum: string; tage: number; href: string }[];
  station: { verbunden: boolean; abwesend: number; offeneAntraege: number; vorfaelle: { datum: string; fahrer: string; kennzeichen: string }[] };
  flotte: { verbunden: boolean; gesamt: number; ausgefallen: { kennzeichen: string; status: string }[] };
  /** Antwort-Wächter (lib/antwort-wache.ts) */
  antworten?: { wartet: { an: string; betreff: string; tage: number; erinnert: boolean }[]; beantwortet: { von: string; betreff: string }[] };
};

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const tt = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : "");
const plural = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`;

export const AMPEL_RANG: Record<Ampel, number> = { rot: 0, gelb: 1, gruen: 2, grau: 3 };

export function leitstandBereiche(x: LeitstandInput): Bereich[] {
  const out: Bereich[] = [];

  /* Geld */
  {
    const kommend = x.amazon.filter((a) => a.zahlungsdatum >= x.today);
    const amazonSumme = kommend.reduce((s, a) => s + a.summe, 0);
    const fremd = x.amazon.flatMap((a) => a.posten.filter((p) => !x.eigeneStationen.includes(p.station)).map((p) => ({ ...p, zahlung: a.nummer })));
    const punkte: Punkt[] = [];
    if (kommend.length) punkte.push({ text: `Amazon zahlt ${eur2(amazonSumme)} (${kommend.map((a) => tt(a.zahlungsdatum)).filter((v, i, l) => l.indexOf(v) === i).join(", ")})` });
    for (const f of fremd.slice(0, 2)) punkte.push({ text: `Unbekannte Station ${f.station}: ${eur2(f.betrag)} – prüfen`, ton: "warn" });
    if (x.konto.summe7 > 0) punkte.push({ text: `Lastschriften 7 Tage: ${eur2(x.konto.summe7)}` });
    const knapp = x.konto.saldo !== null && x.konto.summe7 > 0 && x.konto.saldo < x.konto.summe7;
    if (knapp) punkte.unshift({ text: "Saldo reicht nicht für die angekündigten Lastschriften", ton: "bad" });
    out.push({
      id: "geld",
      titel: "Geld",
      icon: "account_balance_wallet",
      ampel: x.konto.saldo === null ? "grau" : knapp ? "rot" : fremd.length ? "gelb" : "gruen",
      kennzahl: x.konto.saldo === null ? "–" : eur(x.konto.saldo),
      zeile: x.konto.saldo === null ? "Qonto-Stand fehlt" : `Qonto${x.konto.stand ? ` · Stand ${tt(x.konto.stand.slice(0, 10))}` : ""}`,
      punkte,
      href: "/buchhaltung",
    });
  }

  /* Buchhaltung */
  {
    const b = x.buchhaltung;
    const fristTage = b?.naechste_frist?.faellig ? tageBis(b.naechste_frist.faellig, x.today) : null;
    const punkte: Punkt[] = [];
    if (b && b.fehlt_anzahl > 0) punkte.push({ text: `${plural(b.fehlt_anzahl, "Abbuchung", "Abbuchungen")} ohne Beleg · ${eur2(b.fehlt_summe)}`, ton: b.fehlt_anzahl > 20 ? "bad" : "warn" });
    if (b && b.eingang_neu > 0) punkte.push({ text: `${plural(b.eingang_neu, "neuer Beleg", "neue Belege")} im Eingang` });
    if (b?.naechste_frist) punkte.push({ text: `${b.naechste_frist.titel} · ${tt(b.naechste_frist.faellig)}`, ton: fristTage !== null && fristTage < 0 ? "bad" : fristTage !== null && fristTage <= 5 ? "warn" : "neutral" });
    out.push({
      id: "buchhaltung",
      titel: "Buchhaltung",
      icon: "receipt_long",
      ampel: !b ? "grau" : (fristTage !== null && fristTage < 0) || b.fehlt_anzahl > 20 ? "rot" : b.fehlt_anzahl > 0 || (fristTage !== null && fristTage <= 5) ? "gelb" : "gruen",
      kennzahl: b ? String(b.fehlt_anzahl) : "–",
      zeile: b ? `Belege fehlen · ${monatName(b.monat)}` : "keine Daten",
      punkte,
      href: "/buchhaltung",
    });
  }

  /* Vorgänge */
  {
    const v = x.vorgaenge;
    const punkte: Punkt[] = [];
    if (v.ueberfaellig) punkte.push({ text: `${plural(v.ueberfaellig, "Vorgang", "Vorgänge")} überfällig`, ton: "bad" });
    if (v.nachhaken) punkte.push({ text: `${v.nachhaken}× nachhaken fällig`, ton: "warn" });
    for (const t of v.dringend.slice(0, 2)) punkte.push({ text: t, ton: "warn" });
    if (x.entwuerfe) punkte.push({ text: `${plural(x.entwuerfe, "Entwurf wartet", "Entwürfe warten")} aufs Senden`, ton: "warn", href: "/" });
    if (v.wartet) punkte.push({ text: `${v.wartet} warten auf andere` });
    out.push({
      id: "vorgaenge",
      titel: "Vorgänge",
      icon: "task_alt",
      ampel: v.ueberfaellig > 0 ? "rot" : v.beiDir > 0 || v.nachhaken > 0 || x.entwuerfe > 0 ? "gelb" : "gruen",
      kennzahl: String(v.beiDir),
      zeile: "liegen bei dir",
      punkte,
      href: "/aufgaben",
    });
  }

  /* Antworten (Antwort-Wächter) */
  if (x.antworten) {
    const a = x.antworten;
    const ueber = a.wartet.filter((w) => w.erinnert || w.tage >= 5);
    out.push({
      id: "antworten",
      titel: "Antworten",
      icon: "forward_to_inbox",
      ampel: ueber.length ? "gelb" : "gruen",
      kennzahl: String(a.wartet.length),
      zeile: "warten auf Antwort",
      punkte: [
        ...ueber
          .sort((p, q) => q.tage - p.tage)
          .slice(0, 3)
          .map((w): Punkt => ({ text: `${w.an} · seit ${w.tage} T · ${w.betreff}`, ton: "warn" })),
        ...a.beantwortet.slice(0, 2).map((b): Punkt => ({ text: `Antwort da: ${b.von} · ${b.betreff}` })),
      ],
      href: "/leitstand#antworten",
    });
  }

  /* Fristen */
  {
    const offen = x.fristen.filter((f) => f.tage <= 14);
    const abgelaufen = offen.filter((f) => f.tage < 0);
    const bald = offen.filter((f) => f.tage >= 0 && f.tage <= 3);
    out.push({
      id: "fristen",
      titel: "Fristen",
      icon: "event_busy",
      ampel: abgelaufen.length ? "rot" : bald.length ? "gelb" : "gruen",
      kennzahl: String(offen.length),
      zeile: "in den nächsten 14 Tagen",
      punkte: offen.slice(0, 4).map((f) => ({
        text: `${f.titel} · ${f.tage < 0 ? `seit ${-f.tage} T` : f.tage === 0 ? "heute" : `in ${f.tage} T`}`,
        ton: f.tage < 0 ? "bad" : f.tage <= 3 ? "warn" : "neutral",
        href: f.href,
      })),
      href: "/aufgaben",
    });
  }

  /* Eingang */
  {
    const e = x.eingang;
    out.push({
      id: "eingang",
      titel: "Eingang",
      icon: "move_to_inbox",
      ampel: e.gesamt > 100 ? "rot" : e.gesamt > 0 ? "gelb" : "gruen",
      kennzahl: String(e.gesamt),
      zeile: "zu klären",
      punkte: [
        e.mails ? { text: plural(e.mails, "Mail", "Mails") } : null,
        e.briefe ? { text: plural(e.briefe, "Brief", "Briefe") } : null,
        e.mitarbeiter ? { text: `${e.mitarbeiter} von Mitarbeitern` } : null,
      ].filter((p): p is Punkt => Boolean(p)),
      href: "/eingang",
    });
  }

  /* Station (Codriver) */
  {
    const s = x.station;
    out.push({
      id: "station",
      titel: "Station & Personal",
      icon: "groups",
      ampel: !s.verbunden ? "grau" : s.vorfaelle.length > 0 || s.offeneAntraege > 0 ? "gelb" : "gruen",
      kennzahl: s.verbunden ? String(s.abwesend) : "–",
      zeile: s.verbunden ? "heute abwesend" : "Codriver nicht verbunden",
      punkte: s.verbunden
        ? ([
            s.offeneAntraege ? { text: `${plural(s.offeneAntraege, "Antrag", "Anträge")} offen`, ton: "warn" } : null,
            ...s.vorfaelle.slice(0, 3).map((v): Punkt => ({ text: `Unfall ${tt(v.datum)} · ${v.fahrer || "?"} · ${v.kennzeichen}`, ton: "warn" })),
          ] as (Punkt | null)[]).filter((p): p is Punkt => Boolean(p))
        : [{ text: "Codriver-Sync einrichten, dann erscheinen Unfälle, Urlaub und Krank hier." }],
      href: "/firmen",
    });
  }

  /* Flotte (Codriver) */
  {
    const f = x.flotte;
    out.push({
      id: "flotte",
      titel: "Flotte",
      icon: "local_shipping",
      ampel: !f.verbunden ? "grau" : f.ausgefallen.length > 5 ? "rot" : f.ausgefallen.length > 0 ? "gelb" : "gruen",
      kennzahl: f.verbunden ? `${f.gesamt - f.ausgefallen.length}/${f.gesamt}` : "–",
      zeile: f.verbunden ? "Fahrzeuge einsatzbereit" : "Codriver nicht verbunden",
      punkte: f.verbunden
        ? f.ausgefallen.slice(0, 3).map((a) => ({ text: `${a.kennzeichen} · ${a.status}`, ton: "warn" as const }))
        : [{ text: "Codriver-Sync einrichten, dann erscheinen ausgefallene Fahrzeuge hier." }],
      href: "/firmen",
    });
  }

  return out;
}

/** Gesamtbild für den Kopf: Zählung je Ampel und ein Satz. */
export function leitstandKopf(bereiche: Bereich[]): { rot: number; gelb: number; gruen: number; grau: number; satz: string } {
  const z = { rot: 0, gelb: 0, gruen: 0, grau: 0 };
  for (const b of bereiche) z[b.ampel]++;
  const rote = bereiche.filter((b) => b.ampel === "rot").map((b) => b.titel);
  const satz = rote.length
    ? `Sofort ansehen: ${rote.join(", ")}.`
    : z.gelb
      ? `Nichts brennt – ${plural(z.gelb, "Bereich braucht", "Bereiche brauchen")} Aufmerksamkeit.`
      : "Alles im grünen Bereich.";
  return { ...z, satz };
}

function tageBis(iso: string, today: string): number {
  return Math.round((new Date(`${iso.slice(0, 10)}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);
}

function monatName(m: string): string {
  return /^\d{4}-\d{2}$/.test(m) ? new Date(`${m}-01T12:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric" }) : m;
}
