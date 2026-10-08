import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb, todayIso } from "@/lib/db";
import { isLetterMime, letterAnalysisEnabled } from "@/lib/letter-analyze";
import { analyzeStoredLetter, LETTER_CHUNK_SIZE, LETTER_MAX_SIZE } from "@/lib/letter-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Briefpost-Upload: EIN Scan pro Upload (die Oberfläche lädt einen Stapel
 *  nacheinander hoch). Vercel nimmt pro Request nur ~4,5 MB an – größere Scans
 *  schickt die Oberfläche deshalb in Stücken: Dieser Request legt den Brief mit
 *  dem ersten Stück an, weitere Stücke hängt PUT /api/letters/[id] an. Die
 *  KI-Analyse läuft, sobald das letzte Stück da ist (`final`). */

export const GET = withApi(async () => {
  return NextResponse.json({ analysis: letterAnalysisEnabled(), maxSize: LETTER_MAX_SIZE, chunkSize: LETTER_CHUNK_SIZE });
});

export const POST = withApi(async (req: NextRequest) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "Datei fehlt" }, { status: 400 });
  // Bei Stück-Uploads kommen Name, Typ und Gesamtgröße als eigene Felder
  const name = String(form.get("name") ?? (file instanceof File ? file.name : "")) || "Brief";
  const mime = String(form.get("type") ?? "") || file.type || "application/octet-stream";
  const total = Number(form.get("size") ?? file.size);
  const final = form.get("final") === null || form.get("final") === "1";

  if (!total || file.size === 0) return NextResponse.json({ error: "Datei ist leer" }, { status: 400 });
  if (total > LETTER_MAX_SIZE) {
    return NextResponse.json({ error: `Datei zu groß (max. ${LETTER_MAX_SIZE / 1024 / 1024} MB)` }, { status: 400 });
  }
  if (!isLetterMime(mime)) {
    return NextResponse.json({ error: "Nur PDF, JPG, PNG, GIF oder WebP" }, { status: 400 });
  }
  const scannedBy = form.get("scanned_by");

  const d = await getDb();
  const id = await d.insert(
    "INSERT INTO letters (subject, received_date, scanned_by, status, file_ref, mime) VALUES (?,?,?,?,?,?)",
    [
      name.replace(/\.[^.]+$/, "").slice(0, 200) || "Brief",
      todayIso(),
      typeof scannedBy === "string" ? scannedBy.trim().slice(0, 100) : "",
      "neu",
      name.slice(0, 300),
      mime,
    ]
  );
  await d.run("INSERT INTO letter_blobs (letter_id, data) VALUES (?,?)", [id, Buffer.from(await file.arrayBuffer())]);

  const analysisError = final ? await analyzeStoredLetter(id) : null;
  const row = await d.get("SELECT * FROM letters WHERE id = ?", [id]);
  return NextResponse.json({ letter: row, analysisError }, { status: 201 });
});
