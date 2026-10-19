import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/buchhaltung/ablage/:id – fehlgeschlagenen Ablage-Auftrag erneut einreihen (fehler → offen). */
export const POST = withApi(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "Ungültige id" }, { status: 400 });
  const d = await getDb();
  const rows = await d.all<{ id: number }>(
    "UPDATE buch_ablage SET status = 'offen', fehler = '', gestartet_at = NULL WHERE id = ? AND status = 'fehler' RETURNING id",
    [Number(id)]
  );
  if (rows.length === 0) return NextResponse.json({ error: "Auftrag nicht gefunden oder nicht im Status „fehler“." }, { status: 409 });
  return NextResponse.json({ ok: true });
});
