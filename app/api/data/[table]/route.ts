import { NextRequest, NextResponse } from "next/server";
import { withApi, apiError } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { TABLES } from "@/lib/tables";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ table: string }> };

function guard(table: string) {
  return TABLES[table] ?? null;
}

export const GET = withApi(async (_req: NextRequest, ctx: Ctx) => {
  const { table } = await ctx.params;
  const meta = guard(table);
  if (!meta) return apiError(`Unbekannte Tabelle: ${table}`, 400);
  const d = await getDb();
  const order = meta.orderBy ?? "id DESC";
  const rows = await d.all(`SELECT * FROM ${table} ORDER BY ${order}`);
  return NextResponse.json(rows);
});

export const POST = withApi(async (req: NextRequest, ctx: Ctx) => {
  const { table } = await ctx.params;
  const meta = guard(table);
  if (!meta) return apiError(`Unbekannte Tabelle: ${table}`, 400);
  const body = (await req.json()) as Record<string, unknown>;
  const cols = meta.columns.filter((c) => body[c] !== undefined);
  if (cols.length === 0) return apiError("Keine gültigen Felder", 400);
  const d = await getDb();
  const placeholders = cols.map(() => "?").join(",");
  const id = await d.insert(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`,
    cols.map((c) => body[c])
  );
  const row = await d.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  return NextResponse.json(row, { status: 201 });
});

export const PATCH = withApi(async (req: NextRequest, ctx: Ctx) => {
  const { table } = await ctx.params;
  const meta = guard(table);
  if (!meta) return apiError(`Unbekannte Tabelle: ${table}`, 400);
  const body = (await req.json()) as Record<string, unknown> & { id?: number };
  if (!body.id) return apiError("id fehlt", 400);
  const cols = meta.columns.filter((c) => body[c] !== undefined);
  if (cols.length === 0) return apiError("Keine gültigen Felder", 400);
  const d = await getDb();
  const sets = cols.map((c) => `${c} = ?`).join(", ");
  await d.run(`UPDATE ${table} SET ${sets} WHERE id = ?`, [...cols.map((c) => body[c]), body.id]);
  const row = await d.get(`SELECT * FROM ${table} WHERE id = ?`, [body.id]);
  return NextResponse.json(row);
});

export const DELETE = withApi(async (req: NextRequest, ctx: Ctx) => {
  const { table } = await ctx.params;
  if (!guard(table)) return apiError(`Unbekannte Tabelle: ${table}`, 400);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return apiError("id fehlt", 400);
  const d = await getDb();
  await d.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
  return NextResponse.json({ ok: true });
});
