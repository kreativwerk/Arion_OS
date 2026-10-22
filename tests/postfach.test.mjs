// Tests ohne Netzwerk für das Postfach (Archiv + Versand-Hilfen).
// Aufruf: npm run test:postfach
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  archiveFolders,
  attachmentList,
  bodyParts,
  cleanText,
  htmlToText,
  parseAddressList,
  replySubject,
  sentFolder,
  smtpFor,
} from "../lib/mail-parts.ts";

const structure = {
  type: "multipart/mixed",
  childNodes: [
    {
      type: "multipart/alternative",
      part: "1",
      childNodes: [
        { type: "text/plain", part: "1.1", size: 120, encoding: "quoted-printable" },
        { type: "text/html", part: "1.2", size: 800, encoding: "quoted-printable" },
      ],
    },
    { type: "image/png", part: "2", size: 4000, encoding: "base64", disposition: "inline", id: "<logo>" },
    {
      type: "application/pdf",
      part: "3",
      size: 40000,
      encoding: "base64",
      disposition: "attachment",
      dispositionParameters: { filename: "Rechnung 9610846800.pdf" },
    },
    {
      type: "message/rfc822",
      part: "4",
      size: 5000,
      childNodes: [{ type: "text/plain", part: "4.1", size: 50 }],
    },
  ],
};

test("Textteile: je eine plain- und html-Variante, keine aus weitergeleiteten Mails", () => {
  assert.deepEqual(bodyParts(structure), [
    { part: "1.1", kind: "plain", size: 120 },
    { part: "1.2", kind: "html", size: 800 },
  ]);
});

test("Anhänge: PDF und weitergeleitete Mail, kein eingebettetes Logo; Base64-Größe geschätzt", () => {
  assert.deepEqual(attachmentList(structure), [
    { part: "3", filename: "Rechnung 9610846800.pdf", mime: "application/pdf", size: 30000 },
    { part: "4", filename: "Weitergeleitete Mail.eml", mime: "message/rfc822", size: 5000 },
  ]);
});

test("Eingebettete Vertragsfotos (Handy-Mail) zählen als Anhang, Logos nicht", () => {
  const handy = {
    type: "multipart/related",
    childNodes: [
      { type: "image/jpeg", part: "1", size: 600000, encoding: "base64", disposition: "inline", parameters: { name: "IMG_0412.jpg" } },
      { type: "image/jpeg", part: "2", size: 580000, encoding: "base64", disposition: "inline" },
      { type: "image/png", part: "3", size: 6000, encoding: "base64", disposition: "inline", id: "<sig>" },
    ],
  };
  assert.deepEqual(attachmentList(handy), [
    { part: "1", filename: "IMG_0412.jpg", mime: "image/jpeg", size: 450000 },
    { part: "2", filename: "Anhang.jpeg", mime: "image/jpeg", size: 435000 },
  ]);
  assert.deepEqual(bodyParts(handy), []);
  // Mail besteht nur aus einem PDF ohne Dateinamen
  assert.deepEqual(attachmentList({ type: "application/pdf", size: 200000, encoding: "base64" }), [
    { part: "1", filename: "Anhang.pdf", mime: "application/pdf", size: 150000 },
  ]);
});

test("Einfache Mail ohne multipart", () => {
  assert.deepEqual(bodyParts({ type: "text/plain", size: 10 }), [{ part: "1", kind: "plain", size: 10 }]);
  assert.deepEqual(attachmentList({ type: "text/plain", size: 10 }), []);
});

test("HTML → Text: Skripte/Styles weg, Umbrüche, Entitäten", () => {
  const t = htmlToText(
    "<html><head><style>p{color:red}</style></head><body><p>Hallo&nbsp;Herr M&uuml;ller,</p><script>alert(1)</script><p>Betrag: 1.247,12&#8364; &amp; mehr</p></body></html>"
  );
  assert.equal(t, "Hallo Herr Müller,\nBetrag: 1.247,12€ & mehr");
});

test("cleanText entfernt NUL und kürzt", () => {
  assert.equal(cleanText("a\u0000bc", 2), "ab");
});

test("Ordner: Posteingang, Gesendet, eigene – ohne Papierkorb/Spam/Entwürfe", () => {
  const list = [
    { path: "Spam" },
    { path: "Papierkorb", specialUse: "\\Trash" },
    { path: "Gesendete Objekte", specialUse: "\\Sent" },
    { path: "INBOX/Qonto Überweisungen" },
    { path: "Entwürfe", specialUse: "\\Drafts" },
    { path: "INBOX" },
    { path: "Archiv", flags: new Set(["\\Noselect"]) },
  ];
  assert.deepEqual(
    archiveFolders(list).map((f) => f.path),
    ["INBOX", "Gesendete Objekte", "INBOX/Qonto Überweisungen"]
  );
  assert.equal(sentFolder(list), "Gesendete Objekte");
  assert.equal(sentFolder([{ path: "INBOX" }, { path: "INBOX.Sent" }]), "INBOX.Sent");
  assert.equal(sentFolder([{ path: "INBOX" }]), null);
});

test("SMTP-Server aus IMAP-Server", () => {
  assert.deepEqual(smtpFor("imap.ionos.de"), { host: "smtp.ionos.de", port: 465 });
  assert.deepEqual(smtpFor("imap.gmx.net"), { host: "mail.gmx.net", port: 465 });
  assert.deepEqual(smtpFor("imap.strato.de"), { host: "smtp.strato.de", port: 465 });
  assert.deepEqual(smtpFor("imap.strato.de"), { host: "smtp.strato.de", port: 465 });
  assert.deepEqual(smtpFor("imap.ionos.de", "mail.example.de", 587), { host: "mail.example.de", port: 587 });
});

test("Adresslisten: Namen, Trenner, Duplikate, ungültige Adressen", () => {
  assert.deepEqual(parseAddressList("Leon Breckel <leon.breckel@sixt.com>; rechnung@arion-logistics.de, LEON.BRECKEL@sixt.com"), [
    "leon.breckel@sixt.com",
    "rechnung@arion-logistics.de",
  ]);
  assert.deepEqual(parseAddressList(""), []);
  assert.throws(() => parseAddressList("kein-at-zeichen"), /Ungültige/);
  assert.throws(() => parseAddressList("a@b.de\r\nBcc: x@y.de"), /Ungültige/);
});

test("Antwort-Betreff nur einmal mit Re:", () => {
  assert.equal(replySubject("Rechnung"), "Re: Rechnung");
  assert.equal(replySubject("AW: Rechnung"), "AW: Rechnung");
  assert.equal(replySubject("re: x"), "re: x");
});

test("Briefkasten-Push: Anzahl, To-dos, Absender", async () => {
  const { letterboxPushText } = await import("../lib/letterbox.ts");
  const p = letterboxPushText([
    { sender: "Finanzamt Erlangen", action: "Bis 15.11. zahlen" },
    { sender: "AOK", action: "Keine Aktion nötig" },
    { sender: "Finanzamt Erlangen", action: "" },
  ]);
  assert.equal(p.title, "Briefkasten: 3 neue Briefe · 1 mit To-do");
  assert.equal(p.body, "Von Finanzamt Erlangen, AOK");
  assert.equal(p.url, "/post");
  assert.equal(letterboxPushText([{ sender: null, action: null }]).title, "Briefkasten: 1 neuer Brief");
});

test("Briefkasten: nur fertige, neue Scans aus Drive übernehmen", async () => {
  const { pickLetterboxFiles, letterboxMime, letterboxPushText } = await import("../lib/letterbox.ts");
  const now = Date.parse("2026-10-22T10:00:00Z");
  const f = (id, name, mimeType, ageS, size = 1000) => ({ id, name, mimeType, size, modifiedTime: new Date(now - ageS * 1000).toISOString() });
  const files = [
    f("a", "Scan_001.pdf", "application/pdf", 120),
    f("b", "Scan_002.pdf", "application/pdf", 10), // Drucker lädt noch
    f("c", "foto.jpg", "application/octet-stream", 300), // Typ über Endung
    f("d", "notiz.txt", "text/plain", 300),
    f("e", "Scan_000.pdf", "application/pdf", 900), // schon übernommen
    f("g", "riesig.pdf", "application/pdf", 900, 30 * 1024 * 1024),
  ];
  assert.deepEqual(pickLetterboxFiles(files, new Set(["e"]), now).map((x) => x.id), ["a", "c"]);
  assert.equal(letterboxMime({ name: "foto.jpg", mimeType: "application/octet-stream" }), "image/jpeg");
  const p = letterboxPushText([
    { sender: "Finanzamt", action: "Zahlen", firma: "Arion" },
    { sender: "Stadtwerke", action: "", firma: "Wohnwerk" },
    { sender: "X", action: "", firma: "Unklar" },
  ]);
  assert.equal(p.title, "Briefkasten: 3 neue Briefe · 1 mit To-do");
  assert.equal(p.body, "Arion · Wohnwerk – Von Finanzamt, Stadtwerke, X");
});

test("Brief weiterleiten: Absender nach Firma, Betreff, Anhangname", async () => {
  const { letterForwardDraft, pickForwardAccount } = await import("../lib/letter-forward.ts");
  const acc = [
    { id: 4, label: "Info", address: "info@arion-logistics.de", username: "info@arion-logistics.de" },
    { id: 9, label: "WOHNWERK", address: "info@wohnwerkbau.de", username: "info@wohnwerkbau.de" },
    { id: 10, label: "FLEET FIX GmbH", address: "info@fleet-fix.app", username: "info@fleet-fix.app" },
  ];
  assert.equal(pickForwardAccount("Wohnwerk", acc), 9);
  assert.equal(pickForwardAccount("Fleet Fix", acc), 10);
  assert.equal(pickForwardAccount("Unklar", acc), 4);
  assert.equal(pickForwardAccount("Kreativwerk", acc), 4); // Kreativwerk-Postfach fehlt → Arion
  const d = letterForwardDraft(
    { subject: "Erinnerung Entgeltbescheinigung", sender: "BARMER", summary: "Krankengeld fehlt.", action: "", reference: "Y199504797", received_date: "2026-10-22", firma: "Arion", file_ref: "x.pdf", mime: "application/pdf" },
    acc
  );
  assert.equal(d.accountId, 4);
  assert.equal(d.subject, "Weiterleitung: Erinnerung Entgeltbescheinigung");
  assert.equal(d.filename, "BARMER – Erinnerung Entgeltbescheinigung.pdf");
  assert.match(d.body, /eingegangen am 22\.10\.2026/);
  assert.match(d.body, /Zeichen: Y199504797/);
});
