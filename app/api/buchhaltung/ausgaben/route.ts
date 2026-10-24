import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { KAT } from "@/lib/abgleich-regeln";
import { merkeEmpfaenger } from "@/lib/beleg-abgleich";

export const dynamic = "force-dynamic";

/** Abbuchung von Hand markieren: „Kein Beleg nötig“ (optional Empfänger merken) oder zurück auf „FEHLT“. */
export const PATCH = withApi(async (req: NextRequest) => {
  const b = (await req.json().catch(() => ({}))) as { id?: number; aktion?: string; merken?: boolean };
  const id = Number(b.id);
  if (!id || !["ohne", "fehlt"].includes(String(b.aktion))) {
    return NextResponse.json({ error: "id und aktion (ohne|fehlt) erforderlich." }, { status: 400 });
  }
  const d = await getDb();
  const row = await d.get<{ empfaenger: string }>("SELECT empfaenger FROM buch_ausgaben WHERE id = ?", [id]);
  if (!row) return NextResponse.json({ error: "Buchung nicht gefunden." }, { status: 404 });
  if (b.aktion === "ohne") {
    await d.run("UPDATE buch_ausgaben SET kategorie = ?, hinweis = ? WHERE id = ?", [
      KAT.ohne,
      b.merken ? "manuell (Empfänger gemerkt)" : "manuell",
      id,
    ]);
    if (b.merken) await merkeEmpfaenger(d, row.empfaenger);
  } else {
    await d.run("UPDATE buch_ausgaben SET kategorie = ?, hinweis = '', beleg = '', beleg_url = '' WHERE id = ?", [KAT.fehlt, id]);
  }
  return NextResponse.json({ ok: true });
});
