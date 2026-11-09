import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { wacheListe } from "@/lib/antwort-wache";

export const dynamic = "force-dynamic";

/** Antwort-Wächter: Liste „wartet auf Antwort“ und neue Antworten (lib/antwort-wache.ts). */
export const GET = withApi(async () => {
  const d = await getDb();
  return NextResponse.json(await wacheListe(d));
});

/**
 * Von Hand abschließen: { id, aktion: "erledigt" } → braucht keine Antwort (mehr).
 * Gilt für den ganzen Verlauf (gleicher Empfänger + Betreff).
 */
export const POST = withApi(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as { id?: unknown; aktion?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0 || body?.aktion !== "erledigt") {
    return NextResponse.json({ error: "Erwartet { id, aktion: \"erledigt\" }." }, { status: 400 });
  }
  const d = await getDb();
  const row = await d.get<{ thread_key: string }>("SELECT thread_key FROM antwort_wache WHERE id = ?", [id]);
  if (!row) return NextResponse.json({ error: "Eintrag nicht gefunden." }, { status: 404 });
  await d.run(
    "UPDATE antwort_wache SET status = 'erledigt', updated_at = ? WHERE thread_key = ? AND status IN ('wartet','erinnert','ersetzt')",
    [new Date().toISOString(), row.thread_key]
  );
  return NextResponse.json({ ok: true });
});
