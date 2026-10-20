import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { normalizeLayout } from "@/lib/home-widgets";

export const dynamic = "force-dynamic";

/** GET /api/home-layout – Reihenfolge, Sichtbarkeit und Breite der Startseiten-Widgets. */
export const GET = withApi(async () => {
  const d = await getDb();
  const row = await d.get<{ value: string }>("SELECT value FROM app_config WHERE key = 'home_layout'");
  return NextResponse.json({ layout: normalizeLayout(row?.value ?? null) });
});

/** POST /api/home-layout { layout } – speichern (unbekannte Widgets werden verworfen). */
export const POST = withApi(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as { layout?: unknown; zuruecksetzen?: boolean } | null;
  const layout = body?.zuruecksetzen ? normalizeLayout(null) : normalizeLayout(body?.layout ?? null);
  const d = await getDb();
  await d.run(
    "INSERT INTO app_config (key, value) VALUES ('home_layout', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [JSON.stringify(layout)]
  );
  return NextResponse.json({ layout });
});
