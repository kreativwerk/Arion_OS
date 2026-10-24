import { getDb, todayIso, type DB } from "@/lib/db";
import { driveConfigured } from "@/lib/google-drive";
import { qontoConfigured } from "@/lib/qonto";
import { nachbarMonat } from "@/lib/abgleich-regeln";

/** Aggregationen für /buchhaltung und die Dashboard-Karte. */

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export async function latestMonth(d: DB): Promise<string> {
  const row = await d.get<{ m: string | null }>("SELECT MAX(monat) AS m FROM buch_ausgaben");
  return row?.m && MONTH_RE.test(row.m) ? row.m : todayIso().slice(0, 7);
}

export async function monthSummary(d: DB, monat: string) {
  const [tot, perKat, fehlt] = await Promise.all([
    d.get<{ n: number; s: number }>("SELECT COUNT(*) AS n, SUM(betrag) AS s FROM buch_ausgaben WHERE monat = ?", [monat]),
    d.all<{ kategorie: string; n: number; s: number }>(
      "SELECT COALESCE(kategorie, '') AS kategorie, COUNT(*) AS n, SUM(betrag) AS s FROM buch_ausgaben WHERE monat = ? GROUP BY COALESCE(kategorie, '') ORDER BY SUM(betrag) DESC",
      [monat]
    ),
    d.all<Record<string, unknown>>(
      "SELECT id, datum, empfaenger, zweck, betrag, hinweis FROM buch_ausgaben WHERE monat = ? AND kategorie = 'FEHLT' ORDER BY datum ASC, id ASC",
      [monat]
    ),
  ]);
  const summe = num(tot?.s);
  const fehltSumme = num(fehlt.reduce((a, r) => a + num(r.betrag), 0));
  return {
    anzahl: Number(tot?.n ?? 0),
    summe,
    kategorien: perKat.map((k) => ({ kategorie: k.kategorie || "ohne Kategorie", anzahl: Number(k.n), summe: num(k.s) })),
    fehlt: fehlt.map((r) => ({ ...r, betrag: num(r.betrag) })),
    fehlt_anzahl: fehlt.length,
    fehlt_summe: fehltSumme,
    belegt_prozent: summe > 0 ? Math.round(((summe - fehltSumme) / summe) * 1000) / 10 : null,
  };
}

export async function buildOverview(monatParam: string | null) {
  const d = await getDb();
  const monat = monatParam && MONTH_RE.test(monatParam) ? monatParam : await latestMonth(d);

  const [summary, monateRows, eingang, ablage, fristen, kennzahlen, mails, counts, proMonat] = await Promise.all([
    monthSummary(d, monat),
    d.all<{ m: string }>(
      "SELECT DISTINCT monat AS m FROM buch_ausgaben WHERE monat IS NOT NULL UNION SELECT DISTINCT monat AS m FROM buch_ablage WHERE monat IS NOT NULL"
    ),
    d.all<Record<string, unknown>>(
      `SELECT e.id, e.quelle, e.account, e.from_addr, e.subject, e.received_at, e.filename, e.mime, e.size,
              e.status, e.firma, e.notiz, e.created_at,
              (SELECT COUNT(*) FROM buch_ablage a WHERE a.eingang_id = e.id) AS auftraege
       FROM buch_eingang e ORDER BY e.id DESC LIMIT 50`
    ),
    d.all<Record<string, unknown>>(
      `SELECT id, eingang_id, seiten, ziel_pfad, dateiname, lieferant, betrag, belegdatum, monat, status,
              drive_url, fehler, created_at, done_at
       FROM buch_ablage ORDER BY COALESCE(done_at, created_at) DESC, id DESC LIMIT 30`
    ),
    d.all<Record<string, unknown>>(
      "SELECT * FROM buch_fristen WHERE status = 'offen' ORDER BY faellig IS NULL, faellig ASC, id ASC LIMIT 50"
    ),
    d.all<{ key: string; value: string; updated_at: string }>("SELECT key, value, updated_at FROM buch_kennzahlen"),
    d.all<Record<string, unknown>>(
      "SELECT id, account, from_addr, subject, summary, matched_rule, received_at, read FROM mail_digest WHERE important = 1 ORDER BY received_at DESC LIMIT 20"
    ),
    d.get<{ neu: number; offen: number; fehler: number }>(
      `SELECT (SELECT COUNT(*) FROM buch_eingang WHERE status = 'neu') AS neu,
              (SELECT COUNT(*) FROM buch_ablage WHERE status IN ('offen','in_arbeit')) AS offen,
              (SELECT COUNT(*) FROM buch_ablage WHERE status = 'fehler') AS fehler`
    ),
    d.all<{ monat: string; n: number; fehlt: number }>(
      "SELECT monat, COUNT(*) AS n, SUM(CASE WHEN kategorie = 'FEHLT' THEN 1 ELSE 0 END) AS fehlt FROM buch_ausgaben GROUP BY monat"
    ),
  ]);

  // Immer die letzten 12 Monate anbieten, damit auch ein noch leerer Monat abgeglichen werden kann
  const heute = todayIso().slice(0, 7);
  const letzte12 = Array.from({ length: 12 }, (_, i) => nachbarMonat(heute, -i));
  const monate = Array.from(new Set([...monateRows.map((r) => r.m).filter((m) => MONTH_RE.test(m)), monat, ...letzte12]))
    .sort()
    .reverse();
  const kz = Object.fromEntries(kennzahlen.map((k) => [k.key, k]));
  const monate_status = monate.map((m) => {
    const r = proMonat.find((x) => x.monat === m);
    return {
      monat: m,
      buchungen: Number(r?.n ?? 0),
      fehlt: r ? Number(r.fehlt ?? 0) : null,
      abgeglichen: kz[`abgleich_${m}`]?.value ?? null,
    };
  });

  return {
    monat,
    monate,
    drive_verbunden: await driveConfigured(),
    qonto_verbunden: qontoConfigured(),
    monate_status,
    zusammenfassung: summary,
    eingang: eingang.map((e) => ({ ...e, size: Number(e.size ?? 0), auftraege: Number(e.auftraege ?? 0) })),
    ablage: ablage.map((a) => ({ ...a, betrag: a.betrag === null ? null : num(a.betrag) })),
    fristen: fristen.map((f) => ({ ...f, betrag: f.betrag === null ? null : num(f.betrag) })),
    kennzahlen: Object.fromEntries(
      kennzahlen.filter((k) => !k.key.startsWith("abgleich_") && k.key !== "ohne_beleg_empfaenger").map((k) => [k.key, { value: k.value, updated_at: k.updated_at }])
    ),
    mails,
    zaehler: {
      eingang_neu: Number(counts?.neu ?? 0),
      ablage_offen: Number(counts?.offen ?? 0),
      ablage_fehler: Number(counts?.fehler ?? 0),
    },
  };
}

/** Kompakte Kennzahlen für die Dashboard-Karte. */
export async function dashboardBuchhaltung(d: DB) {
  const monat = await latestMonth(d);
  const [summary, neu, frist] = await Promise.all([
    monthSummary(d, monat),
    d.get<{ n: number }>("SELECT COUNT(*) AS n FROM buch_eingang WHERE status = 'neu'"),
    d.get<Record<string, unknown>>(
      "SELECT titel, faellig, betrag, art FROM buch_fristen WHERE status = 'offen' AND faellig IS NOT NULL ORDER BY faellig ASC LIMIT 1"
    ),
  ]);
  return {
    monat,
    fehlt_anzahl: summary.fehlt_anzahl,
    fehlt_summe: summary.fehlt_summe,
    belegt_prozent: summary.belegt_prozent,
    eingang_neu: Number(neu?.n ?? 0),
    naechste_frist: frist ? { ...frist, betrag: frist.betrag === null ? null : num(frist.betrag) } : null,
  };
}
