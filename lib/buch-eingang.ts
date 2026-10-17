import { createHash } from "crypto";
import type { DB } from "@/lib/db";

/** Eingang des Buchhaltungs-Moduls: Belege aus Mail-Anhängen, Scans, Uploads. */

export const BELEG_MAX_BYTES = 20 * 1024 * 1024;
/** Eingebettete Bilder darunter (Logos, Signaturen) werden ignoriert. */
export const INLINE_IMAGE_MIN_BYTES = 30 * 1024;
/** Winzige Bilder sind nie ein Beleg – auch nicht als regulärer Anhang. */
export const IMAGE_MIN_BYTES = 8 * 1024;

export const SCAN_ADDRESS = "scan@arion-logistics.de";

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
};
const ALLOWED_MIME = new Set(Object.values(MIME_BY_EXT));

/** Normalisierter MIME-Typ, wenn der Anhang ein möglicher Beleg ist – sonst null.
 *  application/octet-stream wird über die Dateiendung erkannt. */
export function belegMime(mime: string | undefined, filename: string | undefined): string | null {
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  const normalized = m === "image/jpg" || m === "image/pjpeg" ? "image/jpeg" : m;
  if (ALLOWED_MIME.has(normalized)) return normalized;
  const ext = (filename || "").toLowerCase().split(".").pop() || "";
  if ((normalized === "" || normalized === "application/octet-stream" || normalized === "application/x-pdf") && MIME_BY_EXT[ext]) {
    return MIME_BY_EXT[ext];
  }
  return null;
}

export function isScanSource(account: string, to: string, subject: string): boolean {
  const a = `${account} ${to}`.toLowerCase();
  return a.includes(SCAN_ADDRESS) || /^\s*scan b(ü|ue)rodrucker/i.test(subject);
}

export type EingangInput = {
  quelle: "mail" | "scan" | "upload";
  account: string;
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  filename: string;
  mime: string;
  data: Buffer;
};

/** Speichert einen Beleg (Metadaten + Blob). Dedupe über SHA-256 – liefert
 *  null, wenn die Datei schon im Eingang liegt. */
export async function storeEingang(d: DB, input: EingangInput): Promise<number | null> {
  if (input.data.length === 0 || input.data.length > BELEG_MAX_BYTES) return null;
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const known = await d.get<{ id: number }>("SELECT id FROM buch_eingang WHERE sha256 = ?", [sha256]);
  if (known) {
    // Früherer Lauf ist beim Blob gescheitert → jetzt nachholen
    const hasBlob = await d.get("SELECT 1 AS x FROM buch_eingang_blobs WHERE eingang_id = ?", [Number(known.id)]);
    if (hasBlob) return null;
    await d.run("INSERT INTO buch_eingang_blobs (eingang_id, data) VALUES (?,?) ON CONFLICT DO NOTHING", [Number(known.id), input.data]);
    await d.run("UPDATE buch_eingang SET status = 'neu', notiz = '' WHERE id = ? AND status = 'fehler'", [Number(known.id)]);
    return Number(known.id);
  }
  const rows = await d.all<{ id: number }>(
    `INSERT INTO buch_eingang (quelle, account, message_id, from_addr, subject, received_at, filename, mime, size, sha256, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,'neu') ON CONFLICT DO NOTHING RETURNING id`,
    [
      input.quelle,
      input.account.slice(0, 200),
      input.messageId.slice(0, 500),
      input.from.slice(0, 500),
      input.subject.slice(0, 500),
      input.receivedAt,
      (input.filename || "Anhang").slice(0, 255),
      input.mime,
      input.data.length,
      sha256,
    ]
  );
  const id = rows[0]?.id;
  if (!id) return null; // paralleler Lauf war schneller
  try {
    await d.run("INSERT INTO buch_eingang_blobs (eingang_id, data) VALUES (?,?)", [Number(id), input.data]);
  } catch (e) {
    await d.run("UPDATE buch_eingang SET status = 'fehler', notiz = ? WHERE id = ?", [
      `Datei konnte nicht gespeichert werden: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
      Number(id),
    ]);
    throw e;
  }
  return Number(id);
}
