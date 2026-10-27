import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { erkenneAusBriefen, legeAn, overview, runLohnImport } from "@/lib/bescheinigung";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Übersicht aller Vorgänge + Stand der gelesenen Abrechnungen. */
export const GET = withApi(async () => NextResponse.json(await overview(await getDb())));

/**
 * POST {aktion:"erkennen", alle?} – Briefpost nach Anforderungen durchsuchen
 * POST {aktion:"lohn"}            – neue SD-Worx-Abrechnungen aus dem Drive lesen
 * POST {art, person, …}           – Vorgang von Hand anlegen
 */
export const POST = withApi(async (req: NextRequest) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const d = await getDb();
  if (b.aktion === "erkennen") return NextResponse.json(await erkenneAusBriefen(d, b.alle === true));
  if (b.aktion === "lohn") return NextResponse.json(await runLohnImport(d, Date.now() + 280_000));
  if (!String(b.person ?? "").trim()) return NextResponse.json({ error: "Name fehlt." }, { status: 400 });
  return NextResponse.json({ id: await legeAn(d, b) });
});
