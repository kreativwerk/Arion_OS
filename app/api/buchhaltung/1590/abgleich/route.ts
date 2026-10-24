import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { withLock } from "@/lib/run-lock";
import { abgleich1590 } from "@/lib/buch-1590";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Offene 1590-Zeilen gegen die Belege im Drive abgleichen. */
export const POST = withApi(async (req: NextRequest) => {
  const b = (await req.json().catch(() => ({}))) as { jahr?: string };
  if (!b.jahr || !/^\d{4}$/.test(b.jahr)) return NextResponse.json({ error: "jahr fehlt." }, { status: 400 });
  const start = Date.now();
  const d = await getDb();
  const res = await withLock(d, "abgleich-1590", () => abgleich1590(d, b.jahr!, start + 55_000));
  if (!res) return NextResponse.json({ error: "Ein Abgleich läuft bereits – bitte gleich noch einmal." }, { status: 409 });
  return NextResponse.json(res);
});
