import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb, todayIso } from "@/lib/db";
import { dashboardBuchhaltung } from "@/lib/buch-overview";
import { eingangZahlen, fristen, jetztAuswaehlen, konto, station, flotte, wartetAufDich } from "@/lib/home-data";
import { amazonAvis, leitstandBereiche, leitstandKopf, type AmazonAvis } from "@/lib/leitstand";

export const dynamic = "force-dynamic";

/** Stationen, für die Arion fährt – andere Stationen in Zahlungsavisen werden markiert. */
const EIGENE_STATIONEN = ["DBY5", "DBZ4"];

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Leitstand: alle Bereiche mit Ampel (lib/leitstand.ts). Nur lesend. */
export const GET = withApi(async () => {
  const d = await getDb();
  const today = todayIso();
  const seit = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

  const [kontoDaten, buch, vorgangRows, entwuerfe, eingang, fristenListe, stationDaten, flotteDaten, avisMails] = await Promise.all([
    konto(d, today),
    safe(() => dashboardBuchhaltung(d), null),
    safe(
      () =>
        d.all<Parameters<typeof jetztAuswaehlen>[0][number]>(
          `SELECT id, title, notes, project, due_date, priority, recurrence, horizon, wer_dran, wartet_auf, naechster_schritt, nachhaken_am
           FROM tasks WHERE done = 0 AND accepted = 1`
        ),
      []
    ),
    safe(() => wartetAufDich(d), []),
    eingangZahlen(d),
    fristen(d, today),
    station(d, today),
    flotte(d),
    safe(
      () =>
        d.all<{ subject: string; body_text: string }>(
          "SELECT subject, body_text FROM mails WHERE subject LIKE 'Remittance Advice%' AND date >= ? ORDER BY date DESC LIMIT 60",
          [seit]
        ),
      []
    ),
  ]);

  // Vorgänge: alle offenen zählen (nicht nur die sieben für „Jetzt dran“)
  const j = jetztAuswaehlen(vorgangRows, today, 10_000);
  const vorgaenge = {
    beiDir: j.gesamt,
    ueberfaellig: j.items.filter((x) => x.tage !== null && x.tage < 0).length,
    nachhaken: j.items.filter((x) => x.status === "nachhaken").length,
    wartet: j.wartetGesamt,
    dringend: j.items.filter((x) => x.dringend).map((x) => x.titel),
  };

  // Amazon-Zahlungsavis: dieselbe Zahlung kommt in mehreren Postfächern an → nach Nummer zusammenfassen
  const avis = new Map<string, AmazonAvis>();
  for (const m of avisMails) {
    const a = amazonAvis(m.subject ?? "", m.body_text ?? "");
    if (a && !avis.has(a.nummer)) avis.set(a.nummer, a);
  }
  const amazon = [...avis.values()].sort((a, b) => b.zahlungsdatum.localeCompare(a.zahlungsdatum));

  const bereiche = leitstandBereiche({
    today,
    eigeneStationen: EIGENE_STATIONEN,
    konto: kontoDaten,
    amazon: amazon.filter((a) => a.zahlungsdatum >= today || a.posten.some((p) => !EIGENE_STATIONEN.includes(p.station))),
    buchhaltung: buch
      ? {
          ...buch,
          naechste_frist: buch.naechste_frist
            ? { titel: String((buch.naechste_frist as Record<string, unknown>).titel ?? ""), faellig: String((buch.naechste_frist as Record<string, unknown>).faellig ?? "").slice(0, 10) }
            : null,
        }
      : null,
    vorgaenge,
    entwuerfe: entwuerfe.length,
    eingang,
    fristen: fristenListe,
    station: { verbunden: stationDaten.verbunden, abwesend: stationDaten.abwesend.length, offeneAntraege: stationDaten.offeneAntraege, vorfaelle: stationDaten.vorfaelle },
    flotte: { verbunden: flotteDaten.verbunden, gesamt: flotteDaten.gesamt, ausgefallen: flotteDaten.ausgefallen },
  });

  return NextResponse.json({
    today,
    kopf: leitstandKopf(bereiche),
    bereiche,
    amazon: amazon.slice(0, 8),
    eigeneStationen: EIGENE_STATIONEN,
    lastschriften: kontoDaten.lastschriften,
  });
});
