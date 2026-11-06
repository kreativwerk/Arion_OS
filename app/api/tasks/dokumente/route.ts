import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { dokumenteAusStand, vorgangDokumente, type JetztItem } from "@/lib/home-data";

export const dynamic = "force-dynamic";

type Row = { id: number; title: string; notes: string | null; naechster_schritt: string | null; project: string | null };

/**
 * Dokumente und Zahlungsdaten aller offenen Vorgänge für die Vorgänge-Seite:
 * Zeilen „Dokument: …“ im Stand und Briefe mit letters.task_id (lib/home-data.ts).
 * Antwort: { [taskId]: { dokumente, zahlung } } – nur Vorgänge mit Dokument oder Zahlung.
 */
export const GET = withApi(async () => {
  const d = await getDb();
  const rows = await d.all<Row>("SELECT id, title, notes, naechster_schritt, project FROM tasks WHERE done = 0 ORDER BY id DESC LIMIT 300");
  const items: JetztItem[] = rows.map((r) => ({
    id: Number(r.id),
    titel: r.title,
    schritt: (r.naechster_schritt ?? "").trim(),
    projekt: (r.project ?? "").trim(),
    frist: null,
    tage: null,
    dringend: false,
    status: "ich",
    wartet: "",
    nachhakenAm: null,
    dokumente: dokumenteAusStand(r.notes ?? "").dokumente,
    zahlung: null,
  }));
  await vorgangDokumente(d, items, new Map(rows.map((r) => [Number(r.id), r.notes ?? ""])));
  const out: Record<number, Pick<JetztItem, "dokumente" | "zahlung">> = {};
  for (const x of items) if (x.dokumente.length || x.zahlung) out[x.id] = { dokumente: x.dokumente, zahlung: x.zahlung };
  return NextResponse.json(out);
});
