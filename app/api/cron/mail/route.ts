import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { antwortWache } from "@/lib/antwort-wache";
import { notifyNewDrafts } from "@/lib/draft-notify";
import { sendFreigegebene } from "@/lib/draft-freigabe";
import { signPendingDrafts } from "@/lib/draft-sign";
import { runMailFetch } from "@/lib/mail-fetch";
import { tagesberichtFaellig } from "@/lib/tagesbericht";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mail-Abruf + Postfach-Archiv. Täglich über Vercel Cron (vercel.json) und –
 * für ein aktuelles Postfach – alle 10 Minuten über Supabase pg_cron
 * (siehe docs/INTEGRATIONEN.md, Abschnitt Postfach).
 * Vercel schickt automatisch `Authorization: Bearer ${CRON_SECRET}`,
 * wenn die Umgebungsvariable CRON_SECRET gesetzt ist.
 *
 * `?nur=senden` verschickt nur die im Claude-Chat freigegebenen Entwürfe
 * (lib/draft-freigabe.ts) – so kann Claude den Versand sofort anstoßen, ohne
 * einen kompletten Mail-Abruf auszulösen.
 */
export const GET = withApi(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET fehlt – bitte als Umgebungsvariable setzen, sonst bleibt der Cron-Endpunkt gesperrt." },
      { status: 401 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ungültiges Cron-Secret." }, { status: 401 });
  }
  // maxDuration 60 s: 50 s Budget, Rest als Puffer für den Abschluss
  // Neue Claude-Entwürfe zuerst melden – das dauert Sekunden, der Abruf nimmt den Rest
  const d = await getDb();
  const start = Date.now();
  if (req.nextUrl.searchParams.get("nur") === "senden") {
    const sign = await signPendingDrafts(d, start + 12_000).catch((e) => ({ unterschrieben: 0, fehler: [String(e)] }));
    const versand = await sendFreigegebene(d, start + 45_000).catch((e) => ({ gesendet: 0, fehler: [String(e)] }));
    return NextResponse.json({ versand, unterschrieben: sign.unterschrieben, unterschrift_fehler: sign.fehler });
  }
  // Unterschrifts-Aufträge vor der Meldung erledigen, damit der Push den fertigen Anhang zählt
  const sign = await signPendingDrafts(d, start + 12_000).catch((e) => ({ unterschrieben: 0, fehler: [String(e)] }));
  // Im Chat freigegebene Claude-Entwürfe verschicken (höchstens bis Sekunde 20)
  const versand = await sendFreigegebene(d, start + 20_000).catch((e) => ({ gesendet: 0, fehler: [String(e)] }));
  const entwuerfe = await notifyNewDrafts(d).catch(() => ({ gemeldet: 0 }));
  // Tagesbericht ab 9 Uhr (Berlin), einmal pro Tag – Push + Mail (lib/tagesbericht.ts)
  const bericht = await tagesberichtFaellig(d).catch((e) => ({ gesendet: false, grund: e instanceof Error ? e.message : String(e) }));
  // Abruf bekommt den Rest bis Sekunde 48 (vorher: 12 s Unterschrift + 36 s Abruf)
  const res = await runMailFetch({ push: true, deadline: start + 48_000 });
  // Antwort-Wächter nach dem Abruf: neue Antworten melden, nach 5 Tagen erinnern (lib/antwort-wache.ts)
  const wache = await antwortWache(d).catch((e) => ({ fehler: e instanceof Error ? e.message : String(e) }));
  return NextResponse.json({
    ...res,
    antwort_wache: wache,
    freigegeben_gesendet: versand.gesendet,
    freigabe_fehler: versand.fehler,
    entwuerfe_gemeldet: entwuerfe.gemeldet,
    unterschrieben: sign.unterschrieben,
    unterschrift_fehler: sign.fehler,
    tagesbericht: bericht,
  });
});

/** pg_cron (net.http_post) ruft per POST auf – gleiche Logik. */
export const POST = GET;
