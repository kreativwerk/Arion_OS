import { NextRequest, NextResponse } from "next/server";
import { getDb, todayIso } from "@/lib/db";
import { verifyExternalToken } from "@/lib/external-auth";
import { isLetterMime } from "@/lib/letter-analyze";
import { analyzeStoredLetter, LETTER_CHUNK_SIZE, LETTER_MAX_SIZE } from "@/lib/letter-store";
import { notifyLetterbox } from "@/lib/letterbox";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Briefkasten-Scan vom Büro-Mac (scripts/letterbox): Der Scanner legt den
 * Stapel der Tagespost als PDF in den Ordner „Letterbox“, das Skript lädt ihn
 * hierher. Gleiches Verfahren wie POST /api/letters, aber mit API-Token statt
 * App-Login:
 *
 *   POST /api/external/letters
 *   Authorization: Bearer arion_…        (Token aus Einstellungen → API-Tokens)
 *   multipart: file (erstes Stück, max. 3 MB), name, type, size, final ("1" = letztes Stück)
 *
 * Weitere Stücke: PUT /api/external/letters/:id (file, offset, final).
 * Nach dem letzten Stück zerlegt Claude den Stapel in einzelne Briefe und liest
 * jeden – sie landen im Post-Modul (/post) mit „gescannt von Briefkasten“.
 */
export async function POST(req: NextRequest) {
  const token = await verifyExternalToken(req.headers.get("authorization"));
  if (!token) return NextResponse.json({ error: "Ungültiger oder fehlender API-Token" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof Blob)) return NextResponse.json({ error: "Datei fehlt" }, { status: 400 });
  const name = String(form.get("name") ?? (file instanceof File ? file.name : "")).slice(0, 300) || "Briefkasten.pdf";
  const mime = String(form.get("type") ?? "") || file.type || "application/pdf";
  const total = Number(form.get("size") ?? file.size);
  const final = form.get("final") === null || form.get("final") === "1";

  if (!total || file.size === 0) return NextResponse.json({ error: "Datei ist leer" }, { status: 400 });
  if (file.size > LETTER_CHUNK_SIZE + 1024) {
    return NextResponse.json({ error: `Stück zu groß (max. ${LETTER_CHUNK_SIZE / 1024 / 1024} MB je Request)` }, { status: 400 });
  }
  if (total > LETTER_MAX_SIZE) {
    return NextResponse.json({ error: `Datei zu groß (max. ${LETTER_MAX_SIZE / 1024 / 1024} MB)` }, { status: 400 });
  }
  if (!isLetterMime(mime)) return NextResponse.json({ error: "Nur PDF, JPG, PNG, GIF oder WebP" }, { status: 400 });
  const scannedBy = String(form.get("scanned_by") ?? "").trim().slice(0, 100) || "Briefkasten";

  const d = await getDb();
  const id = await d.insert(
    "INSERT INTO letters (subject, received_date, scanned_by, status, file_ref, mime) VALUES (?,?,?,?,?,?)",
    [name.replace(/\.[^.]+$/, "").slice(0, 200) || "Brief", todayIso(), scannedBy, "neu", name, mime]
  );
  await d.run("INSERT INTO letter_blobs (letter_id, data) VALUES (?,?)", [id, Buffer.from(await file.arrayBuffer())]);

  if (!final) return NextResponse.json({ id, count: 0 }, { status: 201 });
  const result = await analyzeStoredLetter(id);
  await notifyLetterbox(result.ids).catch(() => {});
  return NextResponse.json({ id, count: result.ids.length, analysisError: result.error }, { status: 201 });
}
