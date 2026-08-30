import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyExternalToken } from "@/lib/external-auth";

export const dynamic = "force-dynamic";

/**
 * Externer Aufgaben-Eingang – z.B. für Codriver.
 *
 * Mitarbeiter tragen über die eigene App Aufgaben ein; sie landen im
 * "Eingang" des Aufgaben-Moduls (accepted = 0) und werden dort vom Nutzer
 * angenommen oder abgelehnt.
 *
 *   POST /api/external/tasks
 *   Authorization: Bearer arion_…            (Token aus Einstellungen)
 *   { "title": "…", "submitted_by": "Markus Weber",
 *     "notes"?, "due_date"? (YYYY-MM-DD), "priority"? (1|2|3), "project"? }
 *
 * Vollständige Doku: docs/CODRIVER.md
 */
export async function POST(req: NextRequest) {
  const tokenInfo = await verifyExternalToken(req.headers.get("authorization"));
  if (!tokenInfo) {
    return NextResponse.json({ error: "Ungültiger oder fehlender API-Token" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const submittedBy = typeof body.submitted_by === "string" ? body.submitted_by.trim() : "";
  if (!title) return NextResponse.json({ error: "title fehlt" }, { status: 400 });
  if (!submittedBy) return NextResponse.json({ error: "submitted_by fehlt" }, { status: 400 });
  if (title.length > 500) return NextResponse.json({ error: "title zu lang" }, { status: 400 });

  const dueDate =
    typeof body.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : null;
  const priority = [1, 2, 3].includes(Number(body.priority)) ? Number(body.priority) : 2;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : "";
  const project = typeof body.project === "string" ? body.project.slice(0, 200) : "";

  const d = await getDb();
  const id = await d.insert(
    `INSERT INTO tasks (title, notes, horizon, due_date, project, priority, source, submitted_by, accepted)
     VALUES (?,?,?,?,?,?,?,?,0)`,
    [title, notes, "short", dueDate, project, priority, tokenInfo.label.toLowerCase(), submittedBy]
  );

  return NextResponse.json({ ok: true, id, status: "im Eingang – wartet auf Annahme" }, { status: 201 });
}
