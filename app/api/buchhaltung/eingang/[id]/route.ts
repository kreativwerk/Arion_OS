import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb, nowExpr } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Status, die in der App von Hand gesetzt werden dürfen. Alle anderen
 *  Übergänge (in_pruefung, abgelegt, fehler) gehören Routine bzw. Ablage-Lauf. */
const MANUAL_STATUS = new Set(["neu", "ignoriert"]);

/** PATCH /api/buchhaltung/eingang/:id  { status: "ignoriert" | "neu", notiz? } */
export const PATCH = withApi(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "Ungültige id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { status?: unknown; notiz?: unknown } | null;
  const status = typeof body?.status === "string" ? body.status : "";
  if (!MANUAL_STATUS.has(status)) {
    return NextResponse.json({ error: "status muss „neu“ oder „ignoriert“ sein." }, { status: 400 });
  }
  const d = await getDb();
  const row = await d.get<{ status: string }>("SELECT status FROM buch_eingang WHERE id = ?", [Number(id)]);
  if (!row) return NextResponse.json({ error: "Eingang nicht gefunden" }, { status: 404 });
  if (row.status === "abgelegt") {
    return NextResponse.json({ error: "Bereits abgelegt – Status kann nicht mehr geändert werden." }, { status: 409 });
  }
  const notiz = typeof body?.notiz === "string" ? body.notiz.slice(0, 1000) : null;
  if (notiz !== null) {
    await d.run(`UPDATE buch_eingang SET status = ?, notiz = ?, updated_at = ${nowExpr(d)} WHERE id = ?`, [status, notiz, Number(id)]);
  } else {
    await d.run(`UPDATE buch_eingang SET status = ?, updated_at = ${nowExpr(d)} WHERE id = ?`, [status, Number(id)]);
  }
  const updated = await d.get(
    "SELECT id, quelle, account, from_addr, subject, received_at, filename, mime, size, status, firma, notiz, created_at FROM buch_eingang WHERE id = ?",
    [Number(id)]
  );
  return NextResponse.json(updated);
});
