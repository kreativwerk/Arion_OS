import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { parseAngaben, STATUS, vorlageFuer, type BescheinigungRow } from "@/lib/bescheinigung";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: number) {
  const d = await getDb();
  const row = await d.get<BescheinigungRow>("SELECT * FROM bescheinigungen WHERE id = ?", [id]);
  return { d, row };
}

/** Vorgang mit fertiger Ausfüllvorlage und den zugehörigen Briefen. */
export const GET = withApi(async (_req: NextRequest, ctx: Ctx) => {
  const { d, row } = await load(Number((await ctx.params).id));
  if (!row) return NextResponse.json({ error: "Vorgang nicht gefunden." }, { status: 404 });
  const ids = row.letter_ids.split(",").map(Number).filter(Boolean);
  const briefe = ids.length
    ? await d.all(`SELECT id, subject, sender, received_date FROM letters WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ids)
    : [];
  const { vorlage, zettel } = await vorlageFuer(d, row);
  return NextResponse.json({ ...row, angaben: parseAngaben(row.angaben), vorlage, zettel, briefe });
});

const TEXT_FELDER = ["person", "geb", "rvnr", "stelle", "zeichen", "von", "bis", "frist", "notiz"] as const;

/** PATCH {status?, angaben?, notiz?, person?, …} – Angaben ergänzen, Status setzen. */
export const PATCH = withApi(async (req: NextRequest, ctx: Ctx) => {
  const id = Number((await ctx.params).id);
  const { d, row } = await load(id);
  if (!row) return NextResponse.json({ error: "Vorgang nicht gefunden." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of TEXT_FELDER) {
    if (typeof b[k] === "string") {
      sets.push(`${k} = ?`);
      vals.push((b[k] as string).trim().slice(0, k === "notiz" ? 2000 : 200));
    }
  }
  if (b.status !== undefined) {
    if (!STATUS.includes(b.status as (typeof STATUS)[number])) return NextResponse.json({ error: "Unbekannter Status." }, { status: 400 });
    sets.push("status = ?");
    vals.push(b.status);
    if (b.status === "gesendet") {
      sets.push("gesendet_am = ?");
      vals.push(new Date().toISOString().slice(0, 10));
    }
  }
  if (b.angaben && typeof b.angaben === "object" && !Array.isArray(b.angaben)) {
    // Nur Text-Werte (und die Wochen-Tabelle) übernehmen, zusammengeführt mit dem Bestand
    const merged: Record<string, unknown> = { ...parseAngaben(row.angaben) };
    for (const [k, v] of Object.entries(b.angaben as Record<string, unknown>)) {
      if (k === "wochen" && v && typeof v === "object") {
        const w: Record<string, string> = {};
        for (const [wk, wv] of Object.entries(v as Record<string, unknown>)) if (/^\d{2}\.\d{2}\.\d{4}$/.test(wk)) w[wk] = String(wv ?? "").slice(0, 10);
        merged.wochen = { ...((merged.wochen as Record<string, string>) ?? {}), ...w };
      } else if (/^[a-z_]{2,40}$/.test(k) && (typeof v === "string" || v === null)) {
        if (v === null || v === "") delete merged[k];
        else merged[k] = v.slice(0, 300);
      }
    }
    sets.push("angaben = ?");
    vals.push(JSON.stringify(merged));
  }
  if (!sets.length) return NextResponse.json({ error: "Nichts zu ändern." }, { status: 400 });
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString());
  await d.run(`UPDATE bescheinigungen SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
  return NextResponse.json({ ok: true });
});
