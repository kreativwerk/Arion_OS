/**
 * Brief → Mail-Entwurf (reine Logik, testbar). Absender-Postfach nach Firma
 * des Briefs; Betreff, Text mit Kurzfassung und Dateiname für den Scan-Anhang.
 */

export type ForwardLetter = {
  subject: string;
  sender: string;
  summary: string;
  action: string;
  reference: string;
  received_date: string;
  firma: string | null;
  file_ref: string;
  mime: string;
};

type Account = { id: number; label: string; address: string; username: string };

/** Bevorzugte Absender je Firma (Adresse) – erste passende aktive gewinnt. */
const FIRMA_ABSENDER: Record<string, string[]> = {
  Arion: ["info@arion-logistics.de", "rechnung@arion-logistics.de"],
  "Fleet Fix": ["info@fleet-fix.app"],
  Wohnwerk: ["info@wohnwerkbau.de"],
  Kreativwerk: ["info@kw-agentur.de"],
  Privat: ["albert.dobra@gmx.de", "info@albertdobra.de"],
};

export function pickForwardAccount(firma: string | null, accounts: Account[]): number {
  const wanted = FIRMA_ABSENDER[firma ?? ""] ?? FIRMA_ABSENDER.Arion;
  const addr = (a: Account) => (a.username || a.address || "").toLowerCase();
  for (const w of wanted) {
    const hit = accounts.find((a) => addr(a) === w);
    if (hit) return Number(hit.id);
  }
  return Number(accounts.find((a) => addr(a) === "info@arion-logistics.de")?.id ?? accounts[0]?.id ?? 0);
}

const deDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join(".") : iso);

export function letterForwardDraft(l: ForwardLetter, accounts: Account[]) {
  const ext = l.mime === "application/pdf" ? "pdf" : (l.mime.split("/")[1] ?? "pdf").replace("jpeg", "jpg");
  const base = [l.sender, l.subject].filter(Boolean).join(" – ").replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 120) || "Brief";
  const lines = [
    "Hallo,",
    "",
    `anbei ein Schreiben${l.sender ? ` von ${l.sender}` : ""}${l.received_date ? `, bei uns eingegangen am ${deDate(l.received_date)}` : ""}.`,
    "",
    ...(l.subject ? [`Betreff: ${l.subject}`] : []),
    ...(l.reference ? [`Zeichen: ${l.reference}`] : []),
    ...(l.summary ? ["", l.summary] : []),
    "",
    "Viele Grüße",
    "Albert Dobra",
  ];
  return {
    accountId: pickForwardAccount(l.firma, accounts),
    subject: `Weiterleitung: ${l.subject || "Brief"}`.slice(0, 200),
    body: lines.join("\n"),
    filename: `${base}.${ext}`,
  };
}
