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
