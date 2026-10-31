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

/* ── Codriver-Fälligkeiten, Briefe, HTML ─────────────────── */
import { codriverFaelligkeiten, isoTag } from "../lib/codriver-faelligkeiten.ts";
import { berichtHtml } from "../lib/tagesbericht-html.ts";

test("isoTag versteht Codriver-Formate", () => {
  assert.equal(isoTag("03/08/2031"), "2031-08-03");
  assert.equal(isoTag("3.8.2031"), "2031-08-03");
  assert.equal(isoTag("2026-11-01"), "2026-11-01");
  assert.equal(isoTag("2026-10-31T23:00:00.000Z"), "2026-11-01");
  assert.equal(isoTag(""), "");
  assert.equal(isoTag(42), "");
});

test("Codriver: TÜV, Vertragsende, Führerschein – nur im Fenster, nur aktive", () => {
  const vehicles = [
    { plateNumber: "MAZ6416", brand: "Mercedes-Benz", model: "Sprinter", status: "OPERATIONAL", cortex: { stationCode: "DBY5", ownershipType: "AMAZON_LEASED", ownershipEnd: "2029-11-18" } },
    { plateNumber: "MTA3963", status: "DEFLEETED" },
    { plateNumber: "BULEZ20", brand: "Fiat", model: "Ducato", status: "ACTIVE", cortex: { stationCode: "DBZ4", ownershipType: "SELF_SOURCED_RENTAL", ownershipEnd: "2026-11-10" } },
  ];
  const vehicleDocuments = [
    { plateNumber: "MAZ6416", documentType: "HU_TUV_CERTIFICATE", expiryDate: "2024-11-01" },
    { plateNumber: "MAZ6416", documentType: "HU_TUV_CERTIFICATE", expiryDate: "2026-11-01" },
    { plateNumber: "MAZ6416", documentType: "FAHRZEUGSCHEIN", expiryDate: "" },
    { plateNumber: "MTA3963", documentType: "HU_TUV_CERTIFICATE", expiryDate: "2026-10-01" },
  ];
  const drivers = [
    { driverName: "Anna Aktiv", employeeNumber: "12", station: "DBY5", employmentPeriods: [{ start: "2025-11-15", end: "2026-11-15" }], onboarding: { licenseExpiry: "20/11/2026", idDocExpiry: "01/01/2030" } },
    { driverName: "Bernd Weg", employmentPeriods: [{ start: "2025-01-01", end: "2026-09-30" }], onboarding: { licenseExpiry: "01/11/2026" } },
  ];
  const r = codriverFaelligkeiten({ vehicles, vehicleDocuments, drivers }, "2026-10-31");
  assert.deepEqual(
    r.map((x) => [x.titel, x.datum, x.tage]),
    [
      ["MAZ6416 – TÜV/HU", "2026-11-01", 1],
      ["BULEZ20 – Mietende", "2026-11-10", 10],
      ["Anna Aktiv – Vertrag endet", "2026-11-15", 15],
      ["Anna Aktiv – Führerschein läuft ab", "2026-11-20", 20],
    ]
  );
  assert.equal(r[0].detail, "Mercedes-Benz Sprinter · DBY5");
  assert.equal(r[2].detail, "MA 12 · DBY5");
});

const basis = {
  tag: "2026-10-31",
  wochentag: "Samstag",
  fristen: [
    { titel: "VIACTIV – Beitragsrückstand", datum: "2026-10-29", tage: -2, art: "aufgabe", href: "/aufgaben" },
    { titel: "Cüneyt <Kaplan>", datum: "2026-11-01", tage: 1, art: "aufgabe", href: "/aufgaben" },
  ],
  sdworx: sdworxAuswerten(mails),
  fallTitel: { 16391071: "Darago – Nebeneinkommensbescheinigung" },
  entwuerfe: 2,
  briefe: [{ id: 87, absender: "TÜV NORD", betreff: "Mahnung", kurz: "Letzte Mahnung über 1.288,30 EUR.", aufgabe: "Bis 06.11. zahlen.", firma: "Arion", frist: "2026-11-06" }],
  codriver: { verbunden: false, letzterSync: "", fristen: [] },
};

test("Text: neue Briefe und Codriver-Abschnitt, Betreff zählt Briefe", () => {
  const b = berichtText(basis);
  assert.match(b.text, /NEUE BRIEFE\n- TÜV NORD: Mahnung \(Frist 06\.11\.2026\)\n  Letzte Mahnung/);
  assert.match(b.text, /CODRIVER – FÄLLIGKEITEN\n- Codriver ist noch nicht verbunden\./);
  assert.match(b.betreff, /1 überfällig · 1 Frist in 7 Tagen · 1 neuer Brief · 2 neu von SD Worx · 2 Entwürfe warten/);
});

test("HTML: Abschnitte, Abstände, Escaping, Hinweis ohne Codriver", () => {
  const html = berichtHtml(basis, "Tagesbericht 31.10.2026: Test");
  assert.match(html, /^<!doctype html>/);
  for (const t of ["Überfällig", "Fristen – nächste 7 Tage", "Neue Briefe", "Codriver – Fälligkeiten", "SD Worx – neu seit dem letzten Bericht", "Wartet auf dich"]) {
    assert.ok(html.includes(t), t);
  }
  assert.ok(html.includes("Cüneyt &lt;Kaplan&gt;"));
  assert.ok(!html.includes("<Kaplan>"));
  assert.ok(html.includes("überfällig seit 2 Tagen"));
  assert.ok(html.includes("Frist 06.11."));
  assert.ok(html.includes("To-do"));
  assert.ok(html.includes("noch nicht mit Arion OS verbunden"));
  assert.ok(html.includes("Darago – Nebeneinkommensbescheinigung"));
  assert.ok(html.includes("padding:0 0 10px 0"), "Abstand zwischen den Karten");
});

test("HTML mit Codriver-Fristen gruppiert nach Fahrzeugen und Fahrern", () => {
  const html = berichtHtml({
    ...basis,
    codriver: {
      verbunden: true,
      letzterSync: "",
      fristen: [
        { bereich: "fahrzeug", titel: "MAZ6416 – TÜV/HU", detail: "Sprinter · DBY5", datum: "2026-11-01", tage: 1 },
        { bereich: "fahrer", titel: "Anna – Vertrag endet", detail: "MA 12", datum: "2026-11-15", tage: 15 },
      ],
    },
  });
  assert.ok(html.indexOf("Fahrzeuge") < html.indexOf("MAZ6416 – TÜV/HU"));
  assert.ok(html.indexOf("MAZ6416 – TÜV/HU") < html.indexOf(">Fahrer<"));
  assert.ok(html.includes("Anna – Vertrag endet"));
});
