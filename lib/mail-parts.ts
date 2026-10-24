import type { MessageStructureObject } from "imapflow";

/**
 * Reine Hilfsfunktionen fürs Postfach-Archiv (ohne Netzwerk, testbar):
 * Textteile und Anhänge aus der IMAP-BODYSTRUCTURE, HTML → Text,
 * Ordnerauswahl, SMTP-Host, Adresslisten.
 */

export type BodyPart = { part: string; kind: "plain" | "html"; size: number };
export type AttachmentInfo = { part: string; filename: string; mime: string; size: number };

/** Größte Textteile, die wir laden – riesige Newsletter-HTMLs werden gekappt. */
export const BODY_PART_MAX_BYTES = 1_000_000;

/**
 * Eingebettete Bilder/PDFs ab dieser Größe gelten als echter Anhang. Handy-Mail-
 * Apps (z. B. GMX) betten Fotos von Verträgen „inline“ ein – kleine Logos und
 * Signatur-Bilder bleiben darunter und werden weiter ausgeblendet.
 */
export const INLINE_ANHANG_MIN_BYTES = 40_000;

function decodedSize(node: MessageStructureObject): number {
  const encoded = Number(node.size || 0);
  return node.encoding?.toLowerCase() === "base64" ? Math.floor(encoded * 0.75) : encoded;
}

function isAttachment(node: MessageStructureObject): boolean {
  const disp = node.disposition?.toLowerCase();
  const filename = node.dispositionParameters?.filename || node.parameters?.name;
  if (disp === "attachment" || (Boolean(filename) && disp !== "inline")) return true;
  const type = (node.type || "").toLowerCase();
  if (type.startsWith("text/") || type.startsWith("multipart/")) return false;
  return /^(image|application)\//.test(type) && decodedSize(node) >= INLINE_ANHANG_MIN_BYTES;
}

/**
 * Lesbare Textteile der Mail (nicht die von angehängten/weitergeleiteten Mails).
 * Bei multipart/alternative reicht uns je eine Variante pro Art – wir nehmen
 * die erste plain- und die erste html-Variante.
 */
export function bodyParts(node: MessageStructureObject | undefined): BodyPart[] {
  const out: BodyPart[] = [];
  const walk = (n: MessageStructureObject | undefined) => {
    if (!n) return;
    const type = (n.type || "").toLowerCase();
    if (type === "message/rfc822") return;
    if (n.childNodes?.length) {
      for (const c of n.childNodes) walk(c);
      return;
    }
    if (isAttachment(n)) return;
    const kind = type === "text/plain" ? "plain" : type === "text/html" ? "html" : null;
    if (!kind) return;
    if (out.some((p) => p.kind === kind)) return;
    out.push({ part: n.part || "1", kind, size: decodedSize(n) });
  };
  walk(node);
  return out;
}

/** Alle echten Anhänge (inkl. weitergeleiteter Mails), ohne eingebettete Logos. */
export function attachmentList(node: MessageStructureObject | undefined): AttachmentInfo[] {
  const out: AttachmentInfo[] = [];
  const walk = (n: MessageStructureObject | undefined) => {
    if (!n) return;
    const type = (n.type || "application/octet-stream").toLowerCase();
    if (type === "message/rfc822") {
      out.push({
        part: n.part || "1",
        filename: n.dispositionParameters?.filename || n.parameters?.name || "Weitergeleitete Mail.eml",
        mime: type,
        size: decodedSize(n),
      });
      return;
    }
    if (n.childNodes?.length) {
      for (const c of n.childNodes) walk(c);
      return;
    }
    if (!isAttachment(n)) return;
    out.push({
      part: n.part || "1",
      filename: n.dispositionParameters?.filename || n.parameters?.name || `Anhang.${type.split("/")[1] || "bin"}`,
      mime: type,
      size: decodedSize(n),
    });
  };
  walk(node);
  return out;
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  euro: "€",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
};

/** HTML grob in lesbaren Text (für Suche und Vorschau). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Postgres-TEXT verträgt kein NUL-Zeichen. */
export function cleanText(s: string, max: number): string {
  const t = s.replace(/\u0000/g, "");
  return t.length > max ? t.slice(0, max) : t;
}

export type FolderInfo = { path: string; specialUse?: string; flags?: Set<string> };

const SKIP_SPECIAL = new Set(["\\Trash", "\\Junk", "\\Drafts", "\\All", "\\Flagged"]);
const SKIP_NAME = /(^|[/.])(trash|papierkorb|gelöscht|geloescht|deleted|junk|spam|entwürfe|entwuerfe|drafts|vorlagen|templates)($|[/.])/i;

/** Ordner, die ins Archiv gehören: Posteingang, Gesendet und eigene Ordner. */
export function archiveFolders(list: FolderInfo[]): FolderInfo[] {
  const keep = list.filter((f) => {
    if (f.flags?.has("\\Noselect") || f.flags?.has("\\NonExistent")) return false;
    if (f.specialUse && SKIP_SPECIAL.has(f.specialUse)) return false;
    if (SKIP_NAME.test(f.path)) return false;
    return true;
  });
  // Posteingang zuerst, dann Gesendet, dann der Rest alphabetisch
  const rank = (f: FolderInfo) => (f.path.toUpperCase() === "INBOX" ? 0 : f.specialUse === "\\Sent" ? 1 : 2);
  return keep.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
}

/** Gesendet-Ordner (für die Kopie versendeter Mails). */
export function sentFolder(list: FolderInfo[]): string | null {
  const special = list.find((f) => f.specialUse === "\\Sent");
  if (special) return special.path;
  const byName = list.find((f) => /^(gesendete objekte|gesendet|sent|sent items|sent messages)$/i.test(f.path.split(/[/.]/).pop() || ""));
  return byName?.path ?? null;
}

/** SMTP-Server zum IMAP-Server (IONOS, GMX, sonst imap. → smtp.). */
export function smtpFor(imapHost: string, smtpHost?: string | null, smtpPort?: number | null): { host: string; port: number } {
  const port = Number(smtpPort) || 465;
  if (smtpHost) return { host: smtpHost, port };
  const h = imapHost.toLowerCase();
  if (h === "imap.ionos.de") return { host: "smtp.ionos.de", port };
  if (h === "imap.gmx.net") return { host: "mail.gmx.net", port };
  if (h === "imap.strato.de") return { host: "smtp.strato.de", port };
  if (h.startsWith("imap.")) return { host: "smtp." + h.slice(5), port };
  return { host: h, port };
}

/** "a@x.de, B <b@y.de>; c@z.de" → reine Adressen, validiert. Wirft bei Unsinn. */
export function parseAddressList(input: string | null | undefined): string[] {
  if (!input) return [];
  const out: string[] = [];
  for (const raw of input.split(/[,;\n]/)) {
    const s = raw.trim();
    if (!s) continue;
    const m = s.match(/<([^<>\s]+)>\s*$/);
    const addr = (m ? m[1] : s).trim();
    if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(addr)) {
      throw new Error(`Ungültige E-Mail-Adresse: „${s}“`);
    }
    if (!out.includes(addr.toLowerCase())) out.push(addr.toLowerCase());
  }
  return out;
}

/** "Re: " nur einmal voranstellen. */
export function replySubject(subject: string): string {
  return /^\s*(re|aw|antw)\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

/** "WG: " nur einmal voranstellen (auch Fwd:/FW: zählen als schon weitergeleitet). */
export function forwardSubject(subject: string): string {
  return /^\s*(wg|fwd?|fw)\s*:/i.test(subject) ? subject : `WG: ${subject}`;
}

/** Anhang-Liste aus der Spalte mails.attachments (JSON) – defekte Werte ergeben []. */
export function parseAttachmentMeta(json: string | null | undefined): AttachmentInfo[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v)
      ? v.filter((a) => a && typeof a.part === "string" && typeof a.filename === "string").map((a) => ({
          part: a.part,
          filename: a.filename,
          mime: typeof a.mime === "string" ? a.mime : "application/octet-stream",
          size: Number(a.size) || 0,
        }))
      : [];
  } catch {
    return [];
  }
}

export type ForwardSource = {
  from_addr: string;
  to_addr: string;
  cc_addr?: string | null;
  date: string;
  subject: string;
  body_text: string;
};

/** Kopf + vollständiger Text der weitergeleiteten Mail (wie in Mail-Programmen üblich). */
export function forwardBlock(m: ForwardSource): string {
  const datum = m.date
    ? new Date(m.date).toLocaleString("de-DE", {
        timeZone: "Europe/Berlin",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const kopf = [
    "---------- Weitergeleitete Nachricht ----------",
    `Von: ${m.from_addr}`,
    datum && `Datum: ${datum}`,
    `Betreff: ${m.subject}`,
    `An: ${m.to_addr}`,
    m.cc_addr ? `Cc: ${m.cc_addr}` : "",
  ].filter(Boolean);
  return `${kopf.join("\n")}\n\n${(m.body_text || "").replace(/\r\n/g, "\n")}`;
}
