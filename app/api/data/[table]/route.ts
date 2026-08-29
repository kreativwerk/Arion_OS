import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { TABLES } from "@/lib/tables";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ table: string }> };

function guard(table: string) {
  const meta = TABLES[table];
  if (!meta) throw new Error(`Unbekannte Tabelle: ${table}`);
  return meta;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { table } = await ctx.params;
  try {
    const meta = guard(table);
    const order = meta.orderBy ?? "id DESC";
    const rows = db().prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { table } = await ctx.params;
  try {
    const meta = guard(table);
    const body = (await req.json()) as Record<string, unknown>;
    const cols = meta.columns.filter((c) => body[c] !== undefined);
    if (cols.length === 0) throw new Error("Keine gültigen Felder");
    const placeholders = cols.map(() => "?").join(",");
    const stmt = db().prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`);
    const info = stmt.run(...cols.map((c) => body[c]));
    const row = db().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { table } = await ctx.params;
  try {
    const meta = guard(table);
    const body = (await req.json()) as Record<string, unknown> & { id?: number };
    if (!body.id) throw new Error("id fehlt");
    const cols = meta.columns.filter((c) => body[c] !== undefined);
    if (cols.length === 0) throw new Error("Keine gültigen Felder");
    const sets = cols.map((c) => `${c} = ?`).join(", ");
    db().prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...cols.map((c) => body[c]), body.id);
    const row = db().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(body.id);
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { table } = await ctx.params;
  try {
    guard(table);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new Error("id fehlt");
    db().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
