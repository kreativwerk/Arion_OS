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
  const inline = req.nextUrl.searchParams.get("inline") === "1" && /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/.test(att.mime);
  return new NextResponse(new Uint8Array(att.data), {
    headers: {
      "content-type": att.mime || "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
});
