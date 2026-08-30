import type { DB } from "./db";

/** Beispieldaten für den ersten Start – können in der App gelöscht/ersetzt werden. */
export async function seed(d: DB) {
  const today = new Date();
  const iso = (offsetDays: number) => {
    const t = new Date(today);
    t.setDate(t.getDate() + offsetDays);
    return t.toISOString().slice(0, 10);
  };

  const task = (vals: unknown[]) =>
    d.run(
      "INSERT INTO tasks (title, notes, horizon, due_date, recurrence, project, priority) VALUES (?,?,?,?,?,?,?)",
      vals
    );
  await task(["Wochenreport für Flottenkunden erstellen", "", "short", iso(0), "weekly", "Arion Logistics", 1]);
  await task(["Rechnungen freigeben", "", "short", iso(0), "daily", "Buchhaltung", 2]);
  await task(["Arval-Portal: neue Leasingrückläufer prüfen", "", "short", iso(1), "weekly", "Fuhrpark", 2]);
  await task(["Angebot an Neukunden nachfassen", "", "short", iso(2), null, "Vertrieb", 1]);
  await task(["Neues Lagerkonzept für Standort Süd ausarbeiten", "Grobkonzept bis Ende Q4", "long", iso(60), null, "Strategie", 2]);
  await task(["Digitalisierung Briefpost vollständig einführen", "", "long", iso(90), null, "Organisation", 2]);

  const habit = (vals: unknown[]) =>
    d.run("INSERT INTO habits (name, emoji, target_per_week) VALUES (?,?,?)", vals);
  await habit(["Sport / Bewegung", "directions_run", 4]);
  await habit(["Inbox Zero am Abend", "inbox", 5]);
  await habit(["Lesen (20 Min)", "menu_book", 5]);
  await habit(["Kein Handy nach 22 Uhr", "bedtime", 7]);

  const conflict = d.dialect === "sqlite" ? "ON CONFLICT DO NOTHING" : "ON CONFLICT (habit_id, date) DO NOTHING";
  const log = (vals: unknown[]) =>
    d.run(`INSERT INTO habit_logs (habit_id, date) VALUES (?,?) ${conflict}`, vals);
  await log([1, iso(-1)]);
  await log([1, iso(-3)]);
  await log([2, iso(-1)]);
  await log([2, iso(-2)]);
  await log([3, iso(-1)]);

  const clip = (vals: unknown[]) =>
    d.run("INSERT INTO clipboard_items (content, label, pinned) VALUES (?,?,?)", vals);
  await clip(["DE89 3704 0044 0532 0130 00", "IBAN Geschäftskonto", 1]);
  await clip(["Kundennummer Arval: 4711-2233", "Arval", 1]);
  await clip(["https://vendorcentral.amazon.de", "Amazon Vendor Central", 0]);

  const ev = (vals: unknown[]) =>
    d.run(
      "INSERT INTO calendar_events (title, date, start_time, end_time, location, source) VALUES (?,?,?,?,?,?)",
      vals
    );
  await ev(["Jour fixe Team Logistik", iso(0), "09:00", "09:30", "Büro / Teams", "lokal"]);
  await ev(["Call LeasePlan – Rahmenvertrag", iso(1), "11:00", "12:00", "Teams", "lokal"]);
  await ev(["Amazon: Anlieferfenster Standort Nord", iso(2), "14:00", "16:00", "Lager Nord", "lokal"]);

  const note = (vals: unknown[]) =>
    d.run("INSERT INTO knowledge_notes (title, body, scope, partner, tags) VALUES (?,?,?,?,?)", vals);
  await note([
    "Amazon – Zusammenarbeit & Portale",
    "Vendor Central für Bestellungen und Rechnungen. Anlieferungen nur mit bestätigtem Zeitfenster (Carrier Central). Ansprechpartner und SLAs hier pflegen.",
    "partner", "Amazon", "portal, anlieferung, sla",
  ]);
  await note([
    "Arval – Leasing & Fuhrparkprozesse",
    "Full-Service-Leasing für Teile der Flotte. Schadenmeldung über das Arval-Portal, Rückgabeprotokolle beachten. Kündigungsfristen der Einzelverträge im Modul Verträge.",
    "partner", "Arval", "leasing, fuhrpark, schaden",
  ]);
  await note([
    "LeasePlan – Rahmenvertrag",
    "Rahmenvertrag für Transporter. Quartalsweise Review-Calls. Konditionen und Laufzeiten im Modul Verträge hinterlegen.",
    "partner", "LeasePlan", "leasing, rahmenvertrag",
  ]);
  await note([
    "Onboarding neuer Fahrer",
    "Checkliste: Führerscheinkontrolle, Einweisung Fahrzeug, Ladungssicherung, App-Zugänge, Tankkarte.",
    "unternehmen", "", "hr, checkliste",
  ]);
  await note([
    "Meine Arbeitsprinzipien",
    "Erst wichtig, dann dringend. Ein Thema zu Ende bringen bevor das nächste startet. Freitags Wochenrückblick.",
    "persoenlich", "", "prinzipien",
  ]);

  const contract = (vals: unknown[]) =>
    d.run(
      "INSERT INTO contracts (name, provider, category, policy_number, annual_cost, start_date, end_date, cancel_period_days, notes) VALUES (?,?,?,?,?,?,?,?,?)",
      vals
    );
  await contract(["Betriebshaftpflicht", "Allianz", "Versicherung", "BH-2023-88431", 3400, "2023-01-01", iso(120), 90, ""]);
  await contract(["Flottenversicherung", "HDI", "Versicherung", "FL-99-120344", 18500, "2022-06-01", iso(45), 90, "Kündigungsfrist beachten!"]);
  await contract(["Leasing Sprinter (AR-L 2044)", "Arval", "Leasing", "ARV-56-2044", 7900, "2024-03-01", iso(400), 0, "Rückgabe mit Protokoll"]);
  await contract(["Rahmenvertrag Transporter", "LeasePlan", "Leasing", "LP-RV-2025-7", 0, "2025-01-01", iso(300), 180, "Quartalsreview"]);
  await contract(["Cyber-Versicherung", "Hiscox", "Versicherung", "CY-77-0021", 2100, "2024-09-01", iso(80), 60, ""]);

  const letter = (vals: unknown[]) =>
    d.run(
      "INSERT INTO letters (subject, sender, received_date, scanned_by, status, summary) VALUES (?,?,?,?,?,?)",
      vals
    );
  await letter([
    "Beitragsanpassung Flottenversicherung 2027",
    "HDI Versicherung", iso(-1), "M. Weber", "neu",
    "Beitrag steigt um 4,2 % ab 01.01.2027. Widerspruch/Sonderkündigung innerhalb von 6 Wochen möglich.",
  ]);
  await letter([
    "Bescheid: Genehmigung Schwerlasttransport",
    "Landratsamt", iso(-3), "M. Weber", "aktion",
    "Genehmigung erteilt, gültig 12 Monate. Auflagen: Streckenbindung, Begleitfahrzeug ab 3,5 m Breite.",
  ]);

  await d.run("INSERT INTO mail_accounts (label, address) VALUES (?,?)", ["Geschäftlich", "info@arion-logistics.de"]);
  await d.run("INSERT INTO mail_accounts (label, address) VALUES (?,?)", ["Persönlich", "privat@example.de"]);

  const rule = (vals: unknown[]) => d.run("INSERT INTO mail_rules (kind, value) VALUES (?,?)", vals);
  await rule(["absender", "arval.de"]);
  await rule(["absender", "leaseplan.com"]);
  await rule(["absender", "amazon.de"]);
  await rule(["stichwort", "Rechnung"]);
  await rule(["stichwort", "Kündigung"]);
  await rule(["stichwort", "Mahnung"]);
  await rule(["stichwort", "dringend"]);

  const mail = (vals: unknown[]) =>
    d.run(
      "INSERT INTO mail_digest (account, from_addr, subject, summary, matched_rule, important) VALUES (?,?,?,?,?,?)",
      vals
    );
  await mail([
    "Geschäftlich", "no-reply@arval.de",
    "Ihr Leasingfahrzeug: Wartung fällig",
    "Sprinter AR-L 2044: Wartungstermin innerhalb der nächsten 14 Tage vereinbaren.",
    "Absender: arval.de", 1,
  ]);
  await mail([
    "Geschäftlich", "vendor-central@amazon.de",
    "Neue Bestellung PO-8834412",
    "Neue PO über 240 Kartons, Anlieferung KW 37, Bestätigung bis Freitag erforderlich.",
    "Absender: amazon.de", 1,
  ]);
  await mail([
    "Geschäftlich", "buchhaltung@kunde-xy.de",
    "Rechnung 2026-0815 – Zahlungserinnerung",
    "Kunde bittet um Klärung der offenen Rechnung bis Ende der Woche.",
    "Stichwort: Rechnung", 1,
  ]);

  const watcher = (vals: unknown[]) =>
    d.run("INSERT INTO watchers (name, url, hint, interval_minutes) VALUES (?,?,?,?)", vals);
  await watcher(["Amazon Vendor Central", "https://vendorcentral.amazon.de", "Neue Bestellungen / Chargebacks", 60]);
  await watcher(["Arval Portal", "https://my.arval.de", "Neue Aufgaben, Schadenmeldungen", 120]);
  await watcher(["LeasePlan Portal", "https://www.leaseplan.com/de-de/login", "Vertragsdokumente, Reports", 240]);
  await watcher(["Elster / Steuerportal", "https://www.elster.de", "Neue Bescheide", 1440]);

  const wev = (vals: unknown[]) =>
    d.run("INSERT INTO watcher_events (watcher_id, title, detail) VALUES (?,?,?)", vals);
  await wev([1, "2 neue Bestellungen im Vendor Central", "PO-8834412, PO-8834467 – Bestätigung ausstehend."]);
  await wev([2, "Neues Dokument: Rückgabeprotokoll", "Rückgabeprotokoll für AR-L 1980 wurde bereitgestellt."]);

  await d.run("INSERT INTO slack_rules (person, note) VALUES (?,?)", ["Markus Weber", "Standortleiter Nord"]);
  await d.run("INSERT INTO slack_rules (person, note) VALUES (?,?)", ["Steuerberater", "Kanzlei Berger"]);

  const snote = (vals: unknown[]) =>
    d.run("INSERT INTO slack_notifications (from_person, channel, text, important) VALUES (?,?,?,?)", vals);
  await snote(["Markus Weber", "#lager-nord", "Anlieferung Amazon verschiebt sich auf 15 Uhr – passt das mit der Rampe?", 1]);
  await snote(["Steuerberater", "DM", "USt-Voranmeldung ist raus, bitte kurz freigeben.", 1]);
}

/** Fehlende Konfigurationsschlüssel mit Standardwerten anlegen (idempotent). */
export async function seedConfigDefaults(d: DB) {
  const defaults: Record<string, string> = {
    app_name: "Arion OS",
    user_name: "",
    company: "Arion Logistics",
    partners: "Amazon, Arval, LeasePlan",
    employee_app: "Codriver",
    about_me:
      "Ich führe Arion Logistics, ein Logistikunternehmen. Wichtige Partner: Amazon (Vendor Central), " +
      "Arval und LeasePlan (Fahrzeugleasing). Meine Briefpost wird von Mitarbeitern gescannt und digital " +
      "zugestellt. Mitarbeiter tragen mir Aufgaben über unsere eigene App Codriver ein.",
  };
  for (const [k, v] of Object.entries(defaults)) {
    await d.run("INSERT INTO app_config (key, value) VALUES (?,?) ON CONFLICT (key) DO NOTHING", [k, v]);
  }
}
