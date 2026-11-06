import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { loadMailAttachment } from "@/lib/mail-attachment-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Anhang einer archivierten Mail: aus der Datenbank-Kopie, sonst live vom
 * IMAP-Server (nur lesend, siehe lib/mail-attachment-store.ts).
 */
export const GET = withApi(async (req: NextRequest) => {
  const id = Number(req.nextUrl.searchParams.get("id"));
  const part = req.nextUrl.searchParams.get("part") || "";
  if (!id || !/^[0-9.]+$/.test(part)) return NextResponse.json({ error: "id und part erforderlich" }, { status: 400 });
  const d = await getDb();
  let att;
  try {
    att = await loadMailAttachment(d, id, part);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /nicht gefunden|nicht \(mehr\) verbunden/.test(msg) ? 404 : /neu aufgebaut/.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
  // Viele Absender schicken PDFs als application/octet-stream – dann zählt die Dateiendung
  const mime = typGenau(att.mime, att.filename);
  const inline = req.nextUrl.searchParams.get("inline") === "1" && /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/.test(mime);
  return new NextResponse(new Uint8Array(att.data), {
    headers: {
      "content-type": mime,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
});

const ENDUNG: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** Allgemeiner Typ (leer, octet-stream) → Typ nach Dateiendung, sonst der gemeldete Typ. */
function typGenau(mime: string, filename: string): string {
  const m = (mime || "").toLowerCase();
  if (m && m !== "application/octet-stream" && m !== "application/x-download" && m !== "binary/octet-stream") return m;
  const endung = (filename.split(".").pop() || "").toLowerCase();
  return ENDUNG[endung] ?? (m || "application/octet-stream");
}
