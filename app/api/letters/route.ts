import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb, todayIso } from "@/lib/db";
import { isLetterMime, letterAnalysisEnabled } from "@/lib/letter-analyze";
import { analyzeStoredLetter } from "@/lib/letter-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Briefpost-Upload: EIN Scan pro Request (die Oberfläche lädt einen Stapel
 *  nacheinander hoch) – so bleibt jeder Request unter Vercels Body-Limit und
 *  jede KI-Analyse in ihrem eigenen Zeitbudget. */

const MAX_SIZE = 4 * 1024 * 1024; // 4 MB – unter Vercels ~4,5-MB-Request-Limit

export const GET = withApi(async () => {
  return NextResponse.json({ analysis: letterAnalysisEnabled(), maxSize: MAX_SIZE });
});

export const POST = withApi(async (req: NextRequest) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Datei fehlt" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "Datei ist leer" }, { status: 400 });
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: `Datei zu groß (max. ${MAX_SIZE / 1024 / 1024} MB)` }, { status: 400 });
  }
  const mime = file.type || "application/octet-stream";
  if (!isLetterMime(mime)) {
    return NextResponse.json({ error: "Nur PDF, JPG, PNG, GIF oder WebP" }, { status: 400 });
  }
  const scannedBy = form.get("scanned_by");

  const d = await getDb();
  const id = await d.insert(
    "INSERT INTO letters (subject, received_date, scanned_by, status, file_ref, mime) VALUES (?,?,?,?,?,?)",
    [
      file.name.replace(/\.[^.]+$/, "").slice(0, 200) || "Brief",
      todayIso(),
      typeof scannedBy === "string" ? scannedBy.trim().slice(0, 100) : "",
      "neu",
      file.name.slice(0, 300),
      mime,
    ]
  );
  await d.run("INSERT INTO letter_blobs (letter_id, data) VALUES (?,?)", [id, Buffer.from(await file.arrayBuffer())]);

  const analysisError = await analyzeStoredLetter(id);
  const row = await d.get("SELECT * FROM letters WHERE id = ?", [id]);
  return NextResponse.json({ letter: row, analysisError }, { status: 201 });
});
