// Tagesbericht: SD-Worx-Mails auswerten, Text bauen, Zeit in Berlin. Aufruf: npm run test:tagesbericht
import { test } from "node:test";
import assert from "node:assert/strict";
import { berichtText, berlinJetzt, sdworxAuswerten } from "../lib/tagesbericht.ts";

const PORTAL = "SD Worx - MySP - Customer Portal <no-reply@sdworx.com>";

const mails = [
  {
    from_addr: PORTAL,
    subject: "Maryna Stas hat Sie in einem Post erwähnt",
    date: "2026-10-28T10:47:53.000Z",
    body_text:
      "16391071 — Maryna Stas (SD Worx GmbH)\r\n\r\nHallo Herr Dobra, @Albert Dobra (Kunde)​ ich bin aus dem Urlaub wieder da. Die Nebenbescheinigung habe ich erstellt und elektronisch an die Agentur weitergeleitet.\r\n\r\nPost in SD Worx - MySP - Customer Portal anzeigen: https://example.invalid",
  },
  {
    from_addr: PORTAL,
    subject: "Maryna Stas hat etwas im Kundenvorgang 16391071 gepostet",
    date: "2026-10-28T10:48:12.000Z",
    body_text: '16391071 — Maryna Stas (SD Worx GmbH)\r\nThe case "Bescheinigung über Nebeneinkommen" has been resolved: erl.\r\nPost in SD Worx',
  },
  {
    from_addr: "no-reply@buddy.sdworx.com",
    subject: "Task center SD Worx Buddy",
    date: "2026-10-28T03:45:42.000Z",
    body_text:
      "Diese Übersicht gibt Ihnen einen Überblick … Aufgabenzentrum Arion Logistics GmbH 41 Steuerbehörde: Daten fehlen 3 Funktion auswählen. Zum Aufgabenzentrum Wenn Sie …",
  },
  { from_addr: "SD Worx <sdworx@mail.sdworx.com>", subject: "ERINNERUNG: Weniger Administration", date: "2026-10-28T08:34:12.000Z", body_text: "Werbung" },
  {
    from_addr: "Maryna Stas <maryna.stas@sdworx.com>",
    subject: " Automatische Antwort: Ersad Doku",
    date: "2026-10-28T09:00:00.000Z",
    body_text: "Abwesend",
  },
  { from_addr: "Janina Manert <janina.manert@sdworx.com>", subject: "AW: Ersad Doku – BARMER", date: "2026-10-28T09:10:00.000Z", body_text: "Hallo" },
];

test("SD Worx: Erwähnung + Lösung eines Falls werden zusammengeführt, Werbung und Abwesenheit fallen weg", () => {
  const s = sdworxAuswerten(mails);
  assert.equal(s.posts.length, 1);
  const p = s.posts[0];
  assert.equal(p.fall, "16391071");
  assert.equal(p.von, "Maryna Stas");
  assert.equal(p.erwaehnt, true);
  assert.equal(p.geloest, true);
  assert.match(p.text, /^Hallo Herr Dobra, ich bin aus dem Urlaub/);
  assert.doesNotMatch(p.text, /Post in SD Worx/);
  assert.deepEqual(s.buddy, [
    { anzahl: 41, text: "Steuerbehörde: Daten fehlen" },
    { anzahl: 3, text: "Funktion auswählen" },
  ]);
  assert.deepEqual(s.direkt, [{ von: "Janina Manert", betreff: "AW: Ersad Doku – BARMER" }]);
});

test("Bericht: Fristen sortiert, Betreff und Push zählen richtig", () => {
  const b = berichtText({
    tag: "2026-10-28",
    wochentag: "Mittwoch",
    fristen: [
      { titel: "VIACTIV – Beitragsrückstand", datum: "2026-10-29", tage: 1, art: "aufgabe", href: "/aufgaben" },
      { titel: "Leontrim Sahiti – Arbeitsbescheinigung", datum: "2026-10-21", tage: -7, art: "aufgabe", href: "/aufgaben" },
      { titel: "BKK Linde", datum: "2026-11-02", tage: 5, art: "aufgabe", href: "/aufgaben" },
    ],
    sdworx: sdworxAuswerten(mails),
    fallTitel: { 16391071: "Darago – Nebeneinkommensbescheinigung" },
    entwuerfe: 1,
  });
  assert.equal(b.betreff, "Tagesbericht 28.10.2026: 1 überfällig · 2 Fristen in 7 Tagen · 2 neu von SD Worx · 1 Entwurf wartet");
  assert.equal(b.push.title, "Tagesbericht 28.10.");
  const t = b.text;
  assert.ok(t.indexOf("überfällig seit 7 Tagen (21.10.)") < t.indexOf("morgen (29.10.)"));
  assert.ok(t.indexOf("morgen (29.10.)") < t.indexOf("in 5 Tagen (02.11.)"));
  assert.match(t, /Fall 16391071 \(Darago – Nebeneinkommensbescheinigung\): Maryna Stas – als gelöst markiert/);
  assert.match(t, /Buddy-Aufgabenzentrum offen: 41 × Steuerbehörde: Daten fehlen, 3 × Funktion auswählen/);
  assert.match(t, /1 Mail-Entwurf zum Prüfen und Senden/);
});

test("Bericht ohne Fristen und ohne SD-Worx-Post bleibt freundlich", () => {
  const b = berichtText({
    tag: "2026-11-02",
    wochentag: "Montag",
    fristen: [],
    sdworx: { posts: [], buddy: [], direkt: [] },
    fallTitel: {},
    entwuerfe: 0,
  });
  assert.equal(b.betreff, "Tagesbericht 02.11.2026: keine Frist in 7 Tagen");
  assert.match(b.text, /läuft nichts ab/);
  assert.match(b.text, /Keine neuen Nachrichten im Kundenportal/);
  assert.doesNotMatch(b.text, /WARTET AUF DICH/);
});

test("Berliner Zeit: 9 Uhr im Winter = 8 Uhr UTC, im Sommer = 7 Uhr UTC", () => {
  assert.equal(berlinJetzt(new Date("2026-10-28T08:05:00Z")).stunde, 9);
  assert.equal(berlinJetzt(new Date("2026-10-28T07:55:00Z")).stunde, 8);
  assert.equal(berlinJetzt(new Date("2026-07-01T07:05:00Z")).stunde, 9);
  assert.equal(berlinJetzt(new Date("2026-10-28T23:30:00Z")).tag, "2026-10-29");
  assert.equal(berlinJetzt(new Date("2026-10-28T08:05:00Z")).wochentag, "Mittwoch");
});
