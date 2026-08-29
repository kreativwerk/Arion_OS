import type { Database } from "better-sqlite3";

/** Beispieldaten für den ersten Start – können in der App gelöscht/ersetzt werden. */
export function seed(d: Database) {
  const today = new Date();
  const iso = (offsetDays: number) => {
    const t = new Date(today);
    t.setDate(t.getDate() + offsetDays);
    return t.toISOString().slice(0, 10);
  };

  const task = d.prepare(
    "INSERT INTO tasks (title, notes, horizon, due_date, recurrence, project, priority) VALUES (?,?,?,?,?,?,?)"
  );
  task.run("Wochenreport für Flottenkunden erstellen", "", "short", iso(0), "weekly", "Arion Logistics", 1);
  task.run("Rechnungen freigeben", "", "short", iso(0), "daily", "Buchhaltung", 2);
  task.run("Arval-Portal: neue Leasingrückläufer prüfen", "", "short", iso(1), "weekly", "Fuhrpark", 2);
  task.run("Angebot an Neukunden nachfassen", "", "short", iso(2), null, "Vertrieb", 1);
  task.run("Neues Lagerkonzept für Standort Süd ausarbeiten", "Grobkonzept bis Ende Q4", "long", iso(60), null, "Strategie", 2);
  task.run("Digitalisierung Briefpost vollständig einführen", "", "long", iso(90), null, "Organisation", 2);

  const habit = d.prepare("INSERT INTO habits (name, emoji, target_per_week) VALUES (?,?,?)");
  habit.run("Sport / Bewegung", "🏃", 4);
  habit.run("Inbox Zero am Abend", "📥", 5);
  habit.run("Lesen (20 Min)", "📚", 5);
  habit.run("Kein Handy nach 22 Uhr", "🌙", 7);

  const log = d.prepare("INSERT OR IGNORE INTO habit_logs (habit_id, date) VALUES (?,?)");
  log.run(1, iso(-1));
  log.run(1, iso(-3));
  log.run(2, iso(-1));
  log.run(2, iso(-2));
  log.run(3, iso(-1));

  const clip = d.prepare("INSERT INTO clipboard_items (content, label, pinned) VALUES (?,?,?)");
  clip.run("DE89 3704 0044 0532 0130 00", "IBAN Geschäftskonto", 1);
  clip.run("Kundennummer Arval: 4711-2233", "Arval", 1);
  clip.run("https://vendorcentral.amazon.de", "Amazon Vendor Central", 0);

  const ev = d.prepare(
    "INSERT INTO calendar_events (title, date, start_time, end_time, location, source) VALUES (?,?,?,?,?,?)"
  );
  ev.run("Jour fixe Team Logistik", iso(0), "09:00", "09:30", "Büro / Teams", "lokal");
  ev.run("Call LeasePlan – Rahmenvertrag", iso(1), "11:00", "12:00", "Teams", "lokal");
  ev.run("Amazon: Anlieferfenster Standort Nord", iso(2), "14:00", "16:00", "Lager Nord", "lokal");

  const note = d.prepare(
    "INSERT INTO knowledge_notes (title, body, scope, partner, tags) VALUES (?,?,?,?,?)"
  );
  note.run(
    "Amazon – Zusammenarbeit & Portale",
    "Vendor Central für Bestellungen und Rechnungen. Anlieferungen nur mit bestätigtem Zeitfenster (Carrier Central). Ansprechpartner und SLAs hier pflegen.",
    "partner", "Amazon", "portal, anlieferung, sla"
  );
  note.run(
    "Arval – Leasing & Fuhrparkprozesse",
    "Full-Service-Leasing für Teile der Flotte. Schadenmeldung über das Arval-Portal, Rückgabeprotokolle beachten. Kündigungsfristen der Einzelverträge im Modul Verträge.",
    "partner", "Arval", "leasing, fuhrpark, schaden"
  );
  note.run(
    "LeasePlan – Rahmenvertrag",
    "Rahmenvertrag für Transporter. Quartalsweise Review-Calls. Konditionen und Laufzeiten im Modul Verträge hinterlegen.",
    "partner", "LeasePlan", "leasing, rahmenvertrag"
  );
  note.run(
    "Onboarding neuer Fahrer",
    "Checkliste: Führerscheinkontrolle, Einweisung Fahrzeug, Ladungssicherung, App-Zugänge, Tankkarte.",
    "unternehmen", "", "hr, checkliste"
  );
  note.run(
    "Meine Arbeitsprinzipien",
    "Erst wichtig, dann dringend. Ein Thema zu Ende bringen bevor das nächste startet. Freitags Wochenrückblick.",
    "persoenlich", "", "prinzipien"
  );

  const contract = d.prepare(
    "INSERT INTO contracts (name, provider, category, policy_number, annual_cost, start_date, end_date, cancel_period_days, notes) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  contract.run("Betriebshaftpflicht", "Allianz", "Versicherung", "BH-2023-88431", 3400, "2023-01-01", iso(120), 90, "");
  contract.run("Flottenversicherung", "HDI", "Versicherung", "FL-99-120344", 18500, "2022-06-01", iso(45), 90, "Kündigungsfrist beachten!");
  contract.run("Leasing Sprinter (AR-L 2044)", "Arval", "Leasing", "ARV-56-2044", 7900, "2024-03-01", iso(400), 0, "Rückgabe mit Protokoll");
  contract.run("Rahmenvertrag Transporter", "LeasePlan", "Leasing", "LP-RV-2025-7", 0, "2025-01-01", iso(300), 180, "Quartalsreview");
  contract.run("Cyber-Versicherung", "Hiscox", "Versicherung", "CY-77-0021", 2100, "2024-09-01", iso(80), 60, "");

  const letter = d.prepare(
    "INSERT INTO letters (subject, sender, received_date, scanned_by, status, summary) VALUES (?,?,?,?,?,?)"
  );
  letter.run(
    "Beitragsanpassung Flottenversicherung 2027",
    "HDI Versicherung", iso(-1), "M. Weber", "neu",
    "Beitrag steigt um 4,2 % ab 01.01.2027. Widerspruch/Sonderkündigung innerhalb von 6 Wochen möglich."
  );
  letter.run(
    "Bescheid: Genehmigung Schwerlasttransport",
    "Landratsamt", iso(-3), "M. Weber", "aktion",
    "Genehmigung erteilt, gültig 12 Monate. Auflagen: Streckenbindung, Begleitfahrzeug ab 3,5 m Breite."
  );

  d.prepare("INSERT INTO mail_accounts (label, address) VALUES (?,?)").run("Geschäftlich", "info@arion-logistics.de");
  d.prepare("INSERT INTO mail_accounts (label, address) VALUES (?,?)").run("Persönlich", "privat@example.de");

  const rule = d.prepare("INSERT INTO mail_rules (kind, value) VALUES (?,?)");
  rule.run("absender", "arval.de");
  rule.run("absender", "leaseplan.com");
  rule.run("absender", "amazon.de");
  rule.run("stichwort", "Rechnung");
  rule.run("stichwort", "Kündigung");
  rule.run("stichwort", "Mahnung");
  rule.run("stichwort", "dringend");

  const mail = d.prepare(
    "INSERT INTO mail_digest (account, from_addr, subject, summary, matched_rule, important) VALUES (?,?,?,?,?,?)"
  );
  mail.run(
    "Geschäftlich", "no-reply@arval.de",
    "Ihr Leasingfahrzeug: Wartung fällig",
    "Sprinter AR-L 2044: Wartungstermin innerhalb der nächsten 14 Tage vereinbaren.",
    "Absender: arval.de", 1
  );
  mail.run(
    "Geschäftlich", "vendor-central@amazon.de",
    "Neue Bestellung PO-8834412",
    "Neue PO über 240 Kartons, Anlieferung KW 37, Bestätigung bis Freitag erforderlich.",
    "Absender: amazon.de", 1
  );
  mail.run(
    "Geschäftlich", "buchhaltung@kunde-xy.de",
    "Rechnung 2026-0815 – Zahlungserinnerung",
    "Kunde bittet um Klärung der offenen Rechnung bis Ende der Woche.",
    "Stichwort: Rechnung", 1
  );

  const watcher = d.prepare("INSERT INTO watchers (name, url, hint, interval_minutes) VALUES (?,?,?,?)");
  watcher.run("Amazon Vendor Central", "https://vendorcentral.amazon.de", "Neue Bestellungen / Chargebacks", 60);
  watcher.run("Arval Portal", "https://my.arval.de", "Neue Aufgaben, Schadenmeldungen", 120);
  watcher.run("LeasePlan Portal", "https://www.leaseplan.com/de-de/login", "Vertragsdokumente, Reports", 240);
  watcher.run("Elster / Steuerportal", "https://www.elster.de", "Neue Bescheide", 1440);

  const wev = d.prepare("INSERT INTO watcher_events (watcher_id, title, detail) VALUES (?,?,?)");
  wev.run(1, "2 neue Bestellungen im Vendor Central", "PO-8834412, PO-8834467 – Bestätigung ausstehend.");
  wev.run(2, "Neues Dokument: Rückgabeprotokoll", "Rückgabeprotokoll für AR-L 1980 wurde bereitgestellt.");

  const srule = d.prepare("INSERT INTO slack_rules (person, note) VALUES (?,?)");
  srule.run("Markus Weber", "Standortleiter Nord");
  srule.run("Steuerberater", "Kanzlei Berger");

  const snote = d.prepare(
    "INSERT INTO slack_notifications (from_person, channel, text, important) VALUES (?,?,?,?)"
  );
  snote.run("Markus Weber", "#lager-nord", "Anlieferung Amazon verschiebt sich auf 15 Uhr – passt das mit der Rampe?", 1);
  snote.run("Steuerberater", "DM", "USt-Voranmeldung ist raus, bitte kurz freigeben.", 1);
}
