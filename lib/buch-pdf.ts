import { PDFDocument } from "pdf-lib";
import { parsePageRanges } from "@/lib/buch-pages";

/** PDF-Aufbereitung für die Drive-Ablage (Seiten schneiden, Fotos → A4-PDF). */

/** A4 in PDF-Punkten */
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 24;

/** Baut das abzulegende PDF aus dem Eingangs-Blob. */
export async function buildPdf(data: Uint8Array, mime: string, seiten: string | null): Promise<Uint8Array> {
  if (mime === "application/pdf") {
    const src = await PDFDocument.load(data, { ignoreEncryption: true });
    if (!seiten?.trim()) return data; // alle Seiten → Original unverändert ablegen (auch verschlüsselt)
    if (src.isEncrypted) {
      throw new Error(
        "PDF ist verschlüsselt – kann nicht getrennt werden, bitte ganze Datei ablegen oder entschlüsselte Fassung einsetzen."
      );
    }
    const pages = parsePageRanges(seiten, src.getPageCount());
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, pages);
    copied.forEach((p) => out.addPage(p));
    return out.save();
  }
  if (mime === "image/jpeg" || mime === "image/png") {
    const out = await PDFDocument.create();
    const img = mime === "image/png" ? await out.embedPng(data) : await out.embedJpg(data);
    // Hoch- oder Querformat passend zum Bild wählen
    const landscape = img.width > img.height;
    const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
    const scale = Math.min((pw - 2 * MARGIN) / img.width, (ph - 2 * MARGIN) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const page = out.addPage([pw, ph]);
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    return out.save();
  }
  throw new Error(`Dateityp ${mime || "unbekannt"} kann nicht als PDF abgelegt werden (nur PDF, JPG, PNG).`);
}

