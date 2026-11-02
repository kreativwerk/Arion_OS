import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb, todayIso } from "@/lib/db";
import { vorgangStatus, wartetText } from "@/lib/vorgang";

export const dynamic = "force-dynamic";

const FIRMEN = ["Arion", "Fleet Fix", "Wohnwerk", "Kreativwerk", "Privat"] as const;

/** Firmenseite: offene Vorgänge, neue/laufende Briefe und zuletzt Erledigtes einer Firma. */
export const GET = withApi(async (req: NextRequest) => {
  const f = req.nextUrl.searchParams.get("f") ?? "Arion";
  if (!(FIRMEN as readonly string[]).includes(f)) return NextResponse.json({ error: "Unbekannte Firma" }, { status: 400 });
  const d = await getDb();
  const today = todayIso();
  const [offen, erledigt, briefe, zahlen] = await Promise.all([
    d.all<{ id: number; title: string; due_date: string | null; priority: number; done: number; wer_dran: string; wartet_auf: string; naechster_schritt: string; nachhaken_am: string }>(
      `SELECT id, title, due_date, priority, done, wer_dran, wartet_auf, naechster_schritt, nachhaken_am
       FROM tasks WHERE done = 0 AND accepted = 1 AND project = ? AND (recurrence IS NULL OR recurrence = '')
       ORDER BY priority ASC, due_date IS NULL, due_date ASC`,
      [f]
    ),
    d.all(
      `SELECT id, title, completed_at FROM tasks WHERE done = 1 AND project = ? ORDER BY completed_at DESC LIMIT 8`,
      [f]
    ),
    d.all(
      `SELECT id, subject, sender, status, due_date, received_date FROM letters
       WHERE firma = ? AND status IN ('neu','aktion','sdworx') ORDER BY id DESC LIMIT 20`,
      [f]
    ),
    d.get<{ n: number }>("SELECT COUNT(*) AS n FROM letters WHERE firma = ?", [f]),
  ]);
  return NextResponse.json({
    firma: f,
    offen: offen.map((t) => ({
      id: Number(t.id),
      titel: t.title,
      frist: t.due_date,
      dringend: Number(t.priority) === 1,
      schritt: t.naechster_schritt ?? "",
      status: vorgangStatus(t, today),
      wartet: wartetText(t.wer_dran, t.wartet_auf),
      nachhakenAm: t.nachhaken_am || null,
    })),
    erledigt,
    briefe,
    briefeGesamt: Number(zahlen?.n ?? 0),
  });
});
