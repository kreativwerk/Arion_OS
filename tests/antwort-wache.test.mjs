// Antwort-Wächter: Erkennen, Antworten zuordnen, nach 5 Tagen erinnern. Aufruf: npm run test:antwort-wache
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adressen, beobachten, erinnerungsMail, istAutoAntwort, normBetreff, berlinStunde } from "../lib/antwort-wache.ts";

test("Betreff normalisieren", () => {
  assert.equal(normBetreff("AW: WG: Re:  Fleet Fix GmbH – Teams-Termin"), "fleet fix gmbh – teams-termin");
  assert.equal(normBetreff("Antwort: SV: Hallo"), "hallo");
  assert.equal(normBetreff("Re[2]: Angebot"), "angebot");
});

test("Adressen und Auto-Antworten", () => {
  assert.deepEqual(adressen('"Stadler, Alex" <Alex.Stadler@sixt.com>, info@arion-logistics.de'), ["alex.stadler@sixt.com", "info@arion-logistics.de"]);
  assert.equal(istAutoAntwort(" Automatische Antwort: Fleet Fix GmbH – Teams-Termin"), true);
  assert.equal(istAutoAntwort("Out of Office: Termin"), true);
  assert.equal(istAutoAntwort("Unzustellbar: Rechnung"), true);
  assert.equal(istAutoAntwort("AW: Minijob-Anmeldung", "noreply@firma.de"), true);
  assert.equal(istAutoAntwort("AW: Minijob-Anmeldung", "Alena Schmitt <schmitt@walda-partner.de>"), false);
});

test("Was beobachtet wird", () => {
  assert.deepEqual(beobachten("alex.stadler@sixt.com", "Teams-Termin"), { ja: true, an: "alex.stadler@sixt.com", grund: "" });
  assert.equal(beobachten("halim@arion-logistics.de", "Info").grund, "intern");
  assert.equal(beobachten("Ich <albert.dobra@gmx.de>", "Notiz", ["albert.dobra@gmx.de"]).grund, "intern");
  assert.equal(beobachten("no-reply@amazon.com", "Frage").grund, "no-reply");
  assert.equal(beobachten("fahrer123@gmail.com", "WG: Dienstplan").grund, "weiterleitung");
  // Weiterleitung an eine Firma bleibt beobachtet (z. B. an den Notar)
  assert.equal(beobachten("busse@notarin-neustadtaisch.de", "WG: Finanzierungsbestätigung").ja, true);
  // intern + extern: der externe Empfänger zählt
  assert.equal(beobachten("info@arion-logistics.de, kaestner@walda-partner.de", "Anmeldung").an, "kaestner@walda-partner.de");
});

test("Erinnerungsmail und Tageszeit", () => {
  const m = erinnerungsMail([{ an: "alex.stadler@sixt.com", betreff: "Fleet Fix GmbH – Teams-Termin", gesendet: "2026-11-04T07:21:27.000Z", tage: 5 }]);
  assert.equal(m.betreff, "Keine Antwort seit 5 Tagen: alex.stadler@sixt.com");
  assert.match(m.text, /„Fleet Fix GmbH – Teams-Termin“ – gesendet am 04\.11\. \(5 Tage\)/);
  assert.equal(erinnerungsMail([m, m].map(() => ({ an: "a@b.de", betreff: "x", gesendet: "2026-11-01T10:00:00Z", tage: 8 }))).betreff, "Keine Antwort seit 5+ Tagen: 2 Mails");
  assert.equal(berlinStunde(new Date("2026-11-09T09:00:00Z")), 10);
});

test("Ablauf mit Datenbank: Antwort erkannt, Abwesenheitsnotiz ignoriert, Erinnerung genau einmal", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wache-"));
  const cwd = process.cwd();
  const env = { DATABASE_URL: process.env.DATABASE_URL, VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY };
  delete process.env.DATABASE_URL;
  delete process.env.VAPID_PUBLIC_KEY;
  process.chdir(dir);
  try {
    const { getDb } = await import("../lib/db.ts");
    const { antwortWache, wacheListe } = await import("../lib/antwort-wache.ts");
    const d = await getDb();
    const now = new Date("2026-11-09T09:00:00Z");
    const vor = (tage, std = 0) => new Date(now.getTime() - tage * 86_400_000 - std * 3_600_000).toISOString();
    let uid = 1;
    const mail = (account, folder, from, to, subject, date, mid, inReplyTo = "", refs = "") =>
      d.run(
        `INSERT INTO mails (account, folder, uidvalidity, uid, message_id, from_addr, to_addr, subject, date, in_reply_to, references_hdr, body_text)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, '')`,
        [account, folder, uid++, mid, from, to, subject, date, inReplyTo, refs]
      );
    // Sixt: nur Abwesenheitsnotiz → nach 6 Tagen Erinnerung
    await mail("albert.dobra@gmx.de", "Gesendet", "albert.dobra@gmx.de", "alex.stadler@sixt.com", "Fleet Fix GmbH – Teams-Termin", vor(6), "<a@gmx.de>");
    await mail("albert.dobra@gmx.de", "INBOX", "Alex Stadler <alex.stadler@sixt.com>", "albert.dobra@gmx.de", " Automatische Antwort: Fleet Fix GmbH – Teams-Termin", vor(6, -1), "<x1@sixt.com>", "<a@gmx.de>", "<a@gmx.de>");
    // Steuerbüro: Antwort einer Kollegin über References
    await mail("WOHNWERK", "Gesendete Objekte", "info@wohnwerkbau.de", "kaestner@walda-partner.de", "Minijob-Anmeldung Halim Osaj", vor(5), "<b@wohnwerkbau.de>");
    await mail("WOHNWERK", "INBOX", "Alena Schmitt <schmitt@walda-partner.de>", "info@wohnwerkbau.de", "AW: Minijob-Anmeldung Halim Osaj", vor(3), "<y@walda-partner.de>", "<z@walda-partner.de>", "<b@wohnwerkbau.de> <z@walda-partner.de>");
    // Intern und Mitarbeiter-Weiterleitung → nicht beobachtet
    await mail("Info@arion-logistics.de", "Gesendete Objekte", "info@arion-logistics.de", "halim@arion-logistics.de", "Info", vor(6), "<c@arion>");
    await mail("Info@arion-logistics.de", "Gesendete Objekte", "info@arion-logistics.de", "fahrer@gmail.com", "WG: Dienstplan", vor(6), "<e@arion>");
    // Frisch gesendet → wartet, noch keine Erinnerung
    await mail("Info@arion-logistics.de", "Gesendete Objekte", "info@arion-logistics.de", "eu-ap-freight@amazon.co.uk", "Query – Payment 372974348", vor(0, 2), "<f@arion>");

    const r1 = await antwortWache(d, now);
    assert.equal(r1.erfasst, 3);
    assert.equal(r1.beantwortet, 1);
    assert.equal(r1.erinnert, 1);
    const status = Object.fromEntries((await d.all("SELECT an, status FROM antwort_wache")).map((r) => [r.an, r.status]));
    assert.equal(status["alex.stadler@sixt.com"], "erinnert");
    assert.equal(status["kaestner@walda-partner.de"], "beantwortet");
    assert.equal(status["eu-ap-freight@amazon.co.uk"], "wartet");
    assert.equal(status["halim@arion-logistics.de"], "ignoriert");
    assert.equal(status["fahrer@gmail.com"], "ignoriert");

    // Zweiter Lauf: keine neue Erinnerung, nichts doppelt erfasst
    const r2 = await antwortWache(d, new Date(now.getTime() + 600_000));
    assert.deepEqual([r2.erfasst, r2.beantwortet, r2.erinnert], [0, 0, 0]);

    // Antwort von Sixt kommt später → beantwortet
    await mail("albert.dobra@gmx.de", "INBOX", "Alex Stadler <alex.stadler@sixt.com>", "albert.dobra@gmx.de", "AW: Fleet Fix GmbH – Teams-Termin", vor(0, 1), "<x2@sixt.com>", "<a@gmx.de>", "<a@gmx.de>");
    const r3 = await antwortWache(d, now);
    assert.equal(r3.beantwortet, 1);
    const liste = await wacheListe(d, now);
    assert.deepEqual(liste.wartet.map((w) => w.an), ["eu-ap-freight@amazon.co.uk"]);
    assert.deepEqual(liste.beantwortet.map((b) => b.von).sort(), ["Alena Schmitt", "Alex Stadler"]);
  } finally {
    process.chdir(cwd);
    if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
    if (env.VAPID_PUBLIC_KEY) process.env.VAPID_PUBLIC_KEY = env.VAPID_PUBLIC_KEY;
  }
});
