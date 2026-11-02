import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Eingang (docs/VORGAENGE.md): alles Neue an einer Stelle – neue Briefe,
 * wichtige ungelesene Mails aus dem Mail-Digest, Aufgaben von Mitarbeitern.
 * Jede Sache wird einmal geklärt: Vorgang daraus machen, erledigt/gelesen
 * oder (Mitarbeiter-Aufgabe) annehmen/ablehnen. Gelöscht wird nichts.
 */

const FIRMEN = ["Arion", "Fleet Fix", "Wohnwerk", "Kreativwerk", "Privat"];
const firmaOderLeer = (f: string | null | undefined) => (FIRMEN.includes((f ?? "").trim()) ? (f ?? "").trim() : "");
const isoTag = (v: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? (v as string) : null);

export const GET = withApi(async () => {
  const d = await getDb();
  const [briefe, mails, mailGesamt, mitarbeiter] = await Promise.all([
    d.all(
      `SELECT id, subject, sender, summary, action, due_date, firma, received_date
       FROM letters WHERE status = 'neu' ORDER BY id DESC LIMIT 50`
    ),
    d.all(
      `SELECT id, account, from_addr, subject, summary, received_at
       FROM mail_digest WHERE read = 0 AND important = 1 ORDER BY received_at DESC LIMIT 40`
    ),
    d.get<{ n: number }>("SELECT COUNT(*) AS n FROM mail_digest WHERE read = 0 AND important = 1"),
    d.all(
      `SELECT id, title, notes, due_date, submitted_by, source, created_at
       FROM tasks WHERE done = 0 AND accepted = 0 ORDER BY id DESC LIMIT 30`
    ),
  ]);
  return NextResponse.json({ briefe, mails, mailGesamt: Number(mailGesamt?.n ?? 0), mitarbeiter });
});

type Aktion = { art: "brief" | "mail" | "mitarbeiter" | "mails"; id?: number; aktion: string; tage?: number };

export const POST = withApi(async (req: NextRequest) => {
  const body = (await req.json()) as Aktion;
  const d = await getDb();
  const id = Number(body.id);

  if (body.art === "brief") {
    const b = await d.get<{ subject: string; sender: string; summary: string; action: string; due_date: string; firma: string }>(
      "SELECT subject, sender, summary, action, due_date, firma FROM letters WHERE id = ?",
      [id]
    );
    if (!b) return NextResponse.json({ error: "Brief nicht gefunden" }, { status: 404 });
    if (body.aktion === "erledigt") {
      await d.run("UPDATE letters SET status = 'archiv' WHERE id = ?", [id]);
      return NextResponse.json({ ok: true });
    }
    if (body.aktion === "vorgang") {
      const notes = [b.sender ? `Von: ${b.sender}` : "", b.summary ?? "", `Dokument: brief ${id}`].filter(Boolean).join("\n");
      const taskId = await d.insert(
        `INSERT INTO tasks (title, notes, horizon, due_date, project, priority, source, accepted, naechster_schritt)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [b.subject || "Brief", notes, "short", isoTag(b.due_date), firmaOderLeer(b.firma), 2, "eingang", 1, (b.action ?? "").slice(0, 300)]
      );
      await d.run("UPDATE letters SET status = 'aktion', task_id = ? WHERE id = ?", [taskId, id]);
      return NextResponse.json({ ok: true, taskId });
    }
  }

  if (body.art === "mail") {
    const m = await d.get<{ subject: string; from_addr: string; summary: string; account: string }>(
      "SELECT subject, from_addr, summary, account FROM mail_digest WHERE id = ?",
      [id]
    );
    if (!m) return NextResponse.json({ error: "Mail nicht gefunden" }, { status: 404 });
    if (body.aktion === "vorgang") {
      const notes = [`Mail von ${m.from_addr} an ${m.account}`, m.summary ?? ""].filter(Boolean).join("\n");
      const taskId = await d.insert(
        "INSERT INTO tasks (title, notes, horizon, project, priority, source, accepted) VALUES (?,?,?,?,?,?,?)",
        [m.subject || "Mail", notes, "short", "", 2, "eingang", 1]
      );
      await d.run("UPDATE mail_digest SET read = 1 WHERE id = ?", [id]);
      return NextResponse.json({ ok: true, taskId });
    }
    if (body.aktion === "erledigt") {
      await d.run("UPDATE mail_digest SET read = 1 WHERE id = ?", [id]);
      return NextResponse.json({ ok: true });
    }
  }

  // Ältere wichtige Mails gesammelt als gelesen markieren (sie bleiben im Postfach)
  if (body.art === "mails" && body.aktion === "alt_gelesen") {
    const tage = Math.max(1, Math.min(365, Number(body.tage) || 7));
    const grenze = new Date(Date.now() - tage * 86_400_000).toISOString();
    await d.run("UPDATE mail_digest SET read = 1 WHERE read = 0 AND important = 1 AND received_at < ?", [grenze]);
    return NextResponse.json({ ok: true });
  }

  if (body.art === "mitarbeiter") {
    if (body.aktion === "annehmen") {
      await d.run("UPDATE tasks SET accepted = 1 WHERE id = ? AND accepted = 0", [id]);
      return NextResponse.json({ ok: true });
    }
    if (body.aktion === "ablehnen") {
      // nicht löschen: als erledigt (abgelehnt) ablegen
      await d.run("UPDATE tasks SET accepted = 1, done = 1, notes = COALESCE(notes, '') || ? WHERE id = ? AND accepted = 0", ["\n(abgelehnt im Eingang)", id]);
      return NextResponse.json({ ok: true });
    }
  }

  return NextResponse.json({ error: "Unbekannte Aktion" }, { status: 400 });
});
