import type { DB } from "@/lib/db";
import { fristAusStand, fristen, type Frist } from "@/lib/home-data";
import { pushConfigured, sendPushToAll } from "@/lib/push";
import { sendDraft } from "@/lib/mail-send";
import { codriverStand, type CodriverStand } from "@/lib/codriver-faelligkeiten";
import { APP_URL, berichtHtml, deDatum, kurzDatum, wannText } from "@/lib/tagesbericht-html";

export { APP_URL, deDatum, kurzDatum, wannText };

/**
 * Tagesbericht um 9 Uhr: Fristen (überfällig und nächste 7 Tage), neue Briefe
 * aus dem Scanner, Fälligkeiten aus Codriver (TÜV, Verträge, Führerscheine),
 * Neues von SD Worx und was in Arion OS auf Albert wartet – als Push und als
 * Mail (HTML mit Text-Alternative, Layout in lib/tagesbericht-html.ts).
 *
 * Läuft im Mail-Cron (pg_cron alle 10 Minuten). Ab 9:00 Uhr Berliner Zeit
 * wird einmal pro Tag gesendet; ein atomares Upsert in app_config verhindert
 * Doppelversand, falls zwei Läufe gleichzeitig kommen.
 *
 * SD Worx: Der „To Dos“-Zähler im Kundenportal ist nur mit Login sichtbar.
 * Arion OS liest stattdessen die Benachrichtigungs-Mails des Portals
 * (Posts, Erwähnungen, gelöste Fälle) und die tägliche Übersicht aus
 * dem Buddy-Aufgabenzentrum.
 *
 * Abschalten: ARION_TAGESBERICHT=aus. Empfänger: ARION_TAGESBERICHT_AN
 * (Standard info@arion-logistics.de), gesendet über dasselbe Postfach.
 */

const DAY = 86_400_000;
const STUNDE = 9;
const FENSTER_TAGE = 7;
const STANDARD_AN = "info@arion-logistics.de";

/* ── Zeit in Berlin ─────────────────────────────────────── */

export function berlinJetzt(now = new Date()): { tag: string; stunde: number; wochentag: string } {
  const tz = process.env.APP_TIMEZONE || "Europe/Berlin";
  const tag = now.toLocaleDateString("sv-SE", { timeZone: tz });
  const stunde = Number(now.toLocaleString("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }));
  const wochentag = now.toLocaleDateString("de-DE", { timeZone: tz, weekday: "long" });
  return { tag, stunde: stunde === 24 ? 0 : stunde, wochentag };
}


/* ── SD Worx: Benachrichtigungs-Mails auswerten ─────────── */

export type SdworxMail = { from_addr: string; subject: string; body_text: string; date: string };

export type SdworxPost = { fall: string; von: string; erwaehnt: boolean; geloest: boolean; text: string };

export type SdworxNeu = {
  posts: SdworxPost[];
  /** Buddy-Aufgabenzentrum, letzte Übersicht: „41 × Steuerbehörde: Daten fehlen“ */
  buddy: { anzahl: number; text: string }[];
  /** Mails direkt von SD-Worx-Mitarbeitern (nicht Portal, nicht Werbung) */
  direkt: { von: string; betreff: string }[];
};

const PORTAL = /no-reply@sdworx\.com/i;
const BUDDY = /buddy\.sdworx\.com/i;
const WERBUNG = /@(mail|academy)\.sdworx\.com|academy@|sdworx@mail\./i;

function postText(body: string): string {
  const flach = body.replace(/\s+/g, " ").trim();
  // „16391071 — Maryna Stas (SD Worx GmbH) Hallo Herr Dobra, … Post in SD Worx - MySP …“
  const m = flach.match(/^\d{6,10}\s+—\s+.+?\(SD Worx[^)]*\)\s+(.*?)(?:\s+Post in SD Worx|\s+---|$)/);
  let t = (m?.[1] ?? flach).replace(/@Albert Dobra \(Kunde\)​?/g, "").replace(/\s+/g, " ").trim();
  if (t.length > 220) t = `${t.slice(0, 217).replace(/\s+\S*$/, "")} …`;
  return t;
}

/** Wertet die SD-Worx-Mails seit dem letzten Bericht aus (pure Funktion, testbar). */
export function sdworxAuswerten(mails: SdworxMail[]): SdworxNeu {
  const nachFall = new Map<string, SdworxPost>();
  const buddy: SdworxNeu["buddy"] = [];
  const direkt: SdworxNeu["direkt"] = [];
  const sortiert = [...mails].sort((a, b) => a.date.localeCompare(b.date));
  let letzteBuddy: SdworxMail | null = null;

  for (const m of sortiert) {
    if (BUDDY.test(m.from_addr)) {
      letzteBuddy = m;
      continue;
    }
    if (PORTAL.test(m.from_addr)) {
      const erw = m.subject.match(/^\s*(.+?) hat Sie in einem Post erwähnt/i);
      const post = m.subject.match(/^\s*(.+?) hat etwas im Kundenvorgang (\d+) gepostet/i);
      const fall = post?.[2] ?? m.body_text.trim().match(/^(\d{6,10})\s+—/)?.[1];
      if (!fall || (!erw && !post)) continue;
      const von = (erw?.[1] ?? post?.[1] ?? "").trim();
      const geloest = /has been resolved|wurde gelöst/i.test(m.body_text);
      const text = geloest ? "" : postText(m.body_text);
      const alt = nachFall.get(fall);
      if (alt) {
        alt.erwaehnt ||= Boolean(erw);
        alt.geloest ||= geloest;
        if (text && !alt.text) alt.text = text;
      } else {
        nachFall.set(fall, { fall, von, erwaehnt: Boolean(erw), geloest, text });
      }
      continue;
    }
    if (WERBUNG.test(m.from_addr)) continue;
    if (/@sdworx\.com/i.test(m.from_addr) && !/automatische antwort|out of office/i.test(m.subject)) {
      direkt.push({ von: m.from_addr.replace(/<.*>/, "").trim() || m.from_addr, betreff: m.subject.trim() });
    }
  }

  if (letzteBuddy) {
    const flach = letzteBuddy.body_text.replace(/\s+/g, " ");
    const teil = flach.match(/Aufgabenzentrum\s+.+?GmbH\s+(.*?)\s+Zum Aufgabenzentrum/i)?.[1] ?? "";
    for (const x of teil.matchAll(/(\d+)\s+(.+?)(?=\s+\d+\s+|$)/g)) {
      const text = x[2].replace(/[.\s]+$/, "").trim();
      if (text) buddy.push({ anzahl: Number(x[1]), text });
    }
  }
  return { posts: [...nachFall.values()], buddy, direkt };
}

/* ── Bericht bauen ──────────────────────────────────────── */

export type BerichtDaten = {
  tag: string;
  wochentag: string;
  fristen: Frist[];
  sdworx: SdworxNeu;
  /** Fallnummer → Titel des passenden Falls in Arion OS */
  fallTitel: Record<string, string>;
  entwuerfe: number;
  /** Neue Briefe aus Scanner/Briefkasten seit dem letzten Bericht */
  briefe?: BriefNeu[];
  /** Fälligkeiten aus Codriver (Spiegel codriver_docs) */
  codriver?: CodriverStand;
};

export type BriefNeu = {
  id: number;
  absender: string;
  betreff: string;
  kurz: string;
  aufgabe: string;
  firma: string;
  frist: string;
};



function fristZeile(f: { tage: number; datum: string; titel: string }): string {
  const wann = f.tage === 0 ? "heute" : `${wannText(f.tage)} (${kurzDatum(f.datum)})`;
  return `- ${wann}: ${f.titel}`;
}

export function berichtText(b: BerichtDaten): { betreff: string; text: string; push: { title: string; body: string } } {
  const ueber = b.fristen.filter((f) => f.tage < 0);
  const bald = b.fristen.filter((f) => f.tage >= 0);
  const zeilen: string[] = [`Guten Morgen Albert,`, ``, `hier dein Tagesbericht für ${b.wochentag}, ${deDatum(b.tag)}.`, ``];

  zeilen.push(`FRISTEN`);
  if (!b.fristen.length) zeilen.push(`- In den nächsten ${FENSTER_TAGE} Tagen läuft nichts ab.`);
  for (const f of [...ueber, ...bald]) zeilen.push(fristZeile(f));
  zeilen.push(``);

  const briefe = b.briefe ?? [];
  if (briefe.length) {
    zeilen.push(`NEUE BRIEFE`);
    for (const br of briefe) {
      zeilen.push(`- ${br.absender}: ${br.betreff}${br.frist ? ` (Frist ${deDatum(br.frist)})` : ""}`);
      if (br.kurz) zeilen.push(`  ${br.kurz}`);
    }
    zeilen.push(``);
  }

  if (b.codriver) {
    zeilen.push(`CODRIVER – FÄLLIGKEITEN`);
    if (!b.codriver.verbunden) zeilen.push(`- Codriver ist noch nicht verbunden.`);
    else if (!b.codriver.fristen.length) zeilen.push(`- In den nächsten 30 Tagen läuft nichts ab.`);
    for (const f of b.codriver.fristen) zeilen.push(fristZeile(f));
    zeilen.push(``);
  }

  zeilen.push(`SD WORX – NEU SEIT DEM LETZTEN BERICHT`);
  const s = b.sdworx;
  if (!s.posts.length && !s.direkt.length) zeilen.push(`- Keine neuen Nachrichten im Kundenportal.`);
  for (const p of s.posts) {
    const titel = b.fallTitel[p.fall] ? ` (${b.fallTitel[p.fall]})` : "";
    const status = p.geloest ? " – als gelöst markiert" : p.erwaehnt ? " – du wurdest erwähnt, bitte ansehen" : "";
    zeilen.push(`- Fall ${p.fall}${titel}: ${p.von}${status}`);
    if (p.text) zeilen.push(`  „${p.text}“`);
  }
  for (const m of s.direkt) zeilen.push(`- Mail von ${m.von}: ${m.betreff}`);
  if (s.buddy.length) {
    zeilen.push(`- Buddy-Aufgabenzentrum offen: ${s.buddy.map((x) => `${x.anzahl} × ${x.text}`).join(", ")}`);
  }
  zeilen.push(``);

  if (b.entwuerfe > 0) {
    zeilen.push(`WARTET AUF DICH`);
    zeilen.push(`- ${b.entwuerfe} Mail-${b.entwuerfe === 1 ? "Entwurf" : "Entwürfe"} zum Prüfen und Senden`);
    zeilen.push(``);
  }
  zeilen.push(`Arion OS: ${APP_URL}`);

  const teile: string[] = [];
  if (ueber.length) teile.push(`${ueber.length} überfällig`);
  const woche = bald.length;
  teile.push(woche ? `${woche} ${woche === 1 ? "Frist" : "Fristen"} in ${FENSTER_TAGE} Tagen` : "keine Frist in 7 Tagen");
  const sdN = s.posts.length + s.direkt.length;
  if (briefe.length) teile.push(`${briefe.length} ${briefe.length === 1 ? "neuer Brief" : "neue Briefe"}`);
  const cdN = b.codriver?.fristen.filter((f) => f.tage <= FENSTER_TAGE).length ?? 0;
  if (cdN) teile.push(`${cdN} Codriver`);
  if (sdN) teile.push(`${sdN} neu von SD Worx`);
  if (b.entwuerfe) teile.push(`${b.entwuerfe} ${b.entwuerfe === 1 ? "Entwurf wartet" : "Entwürfe warten"}`);

  return {
    betreff: `Tagesbericht ${deDatum(b.tag)}: ${teile.join(" · ")}`,
    text: zeilen.join("\n"),
    push: { title: `Tagesbericht ${kurzDatum(b.tag)}`, body: teile.join(" · ") },
  };
}

/* ── Daten holen ────────────────────────────────────────── */

async function claudeFristen(d: DB, today: string): Promise<Frist[]> {
  // Claude-Fälle ohne due_date, aber mit „Frist: TT.MM.JJJJ“ im Stand
  const rows = await d.all<{ title: string; notes: string }>(
    "SELECT title, notes FROM tasks WHERE done = 0 AND source = 'claude' AND (due_date IS NULL OR due_date = '') AND notes LIKE '%Frist:%'"
  );
  const out: Frist[] = [];
  for (const r of rows) {
    const f = fristAusStand(r.notes || "", Number(today.slice(0, 4))).frist;
    if (!f) continue;
    const tage = Math.round((new Date(`${f}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / DAY);
    out.push({ titel: r.title, datum: f, tage, art: "aufgabe", href: "/aufgaben" });
  }
  return out;
}

async function fallTitel(d: DB, faelle: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of faelle) {
    const t = await d.get<{ title: string }>("SELECT title FROM tasks WHERE notes LIKE ? ORDER BY done, id DESC LIMIT 1", [`%${f}%`]);
    if (t?.title) out[f] = t.title;
  }
  return out;
}

export async function berichtDaten(d: DB, now: Date, seit: string): Promise<BerichtDaten> {
  const { tag, wochentag } = berlinJetzt(now);
  const alle = [...(await fristen(d, tag)), ...(await claudeFristen(d, tag))];
  const gesehen = new Set<string>();
  const fr = alle
    .filter((f) => f.tage <= FENSTER_TAGE && f.tage >= -60)
    .filter((f) => {
      const k = `${f.titel}|${f.datum}`;
      if (gesehen.has(k)) return false;
      gesehen.add(k);
      return true;
    })
    .sort((a, b) => a.tage - b.tage);

  const mails = await d.all<SdworxMail>(
    `SELECT from_addr, subject, body_text, date FROM mails
     WHERE from_addr LIKE '%sdworx%' AND date > ? AND folder NOT LIKE '%Gesendet%' AND folder NOT LIKE '%Sent%'
     ORDER BY date LIMIT 200`,
    [seit]
  );
  const sdworx = sdworxAuswerten(mails);
  const titel = await fallTitel(
    d,
    sdworx.posts.map((p) => p.fall)
  );
  const e = await d.get<{ n: number }>("SELECT COUNT(*) AS n FROM mail_drafts WHERE status = 'entwurf'");
  const briefe = await neueBriefe(d, seit).catch(() => []);
  const codriver = await codriverStand(d, tag);
  return { tag, wochentag, fristen: fr, sdworx, fallTitel: titel, entwuerfe: Number(e?.n ?? 0), briefe, codriver };
}

async function neueBriefe(d: DB, seit: string): Promise<BriefNeu[]> {
  const rows = await d.all<{
    id: number;
    sender: string;
    subject: string;
    summary: string;
    action: string;
    firma: string;
    due_date: string;
  }>(
    // created_at ist Text („2026-10-30 11:16:11+00“ bzw. ISO mit „T“) – beide Seiten auf Leerzeichen bringen,
    // sonst sortiert „ “ vor „T“ und Briefe vom selben Tag fallen heraus
    `SELECT id, sender, subject, summary, action, firma, due_date FROM letters
     WHERE REPLACE(created_at, 'T', ' ') > ? ORDER BY id LIMIT 30`,
    [seit.replace("T", " ").replace(/Z$/, "")]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    absender: (r.sender || "Unbekannt").trim(),
    betreff: (r.subject || "").trim(),
    kurz: (r.summary || "").trim(),
    aufgabe: (r.action || "").trim(),
    firma: (r.firma || "").trim(),
    frist: /^\d{4}-\d{2}-\d{2}$/.test(r.due_date || "") ? r.due_date : "",
  }));
}

/* ── Senden ─────────────────────────────────────────────── */

export async function mailSenden(d: DB, betreff: string, text: string, html?: string, an = ""): Promise<string> {
  an = (an || process.env.ARION_TAGESBERICHT_AN || STANDARD_AN).trim();
  const acc = await d.get<{ id: number }>(
    "SELECT id FROM mail_accounts WHERE LOWER(address) = LOWER(?) OR LOWER(username) = LOWER(?) ORDER BY id LIMIT 1",
    [STANDARD_AN, STANDARD_AN]
  );
  if (!acc) return "Postfach info@ fehlt";
  const row = await d.get<{ id: number }>(
    `INSERT INTO mail_drafts (account_id, to_addr, subject, body_text, source, note, status, notified_at)
     VALUES (?, ?, ?, ?, 'tagesbericht', 'Tagesbericht (automatisch)', 'entwurf', ?) RETURNING id`,
    [acc.id, an, betreff, text, new Date().toISOString()]
  );
  if (!row) return "Entwurf nicht angelegt";
  const res = await sendDraft(d, Number(row.id), { html });
  return res.ok ? "gesendet" : res.error || res.status;
}

export type TagesberichtErgebnis = { gesendet: boolean; grund?: string; push?: number; mail?: string };

/** Im Cron aufrufen: sendet einmal pro Tag ab 9 Uhr (Berlin). */
export async function tagesberichtFaellig(d: DB, now = new Date()): Promise<TagesberichtErgebnis> {
  if (/^(aus|off|0|false)$/i.test(process.env.ARION_TAGESBERICHT || "")) return { gesendet: false, grund: "abgeschaltet" };
  const { tag, stunde } = berlinJetzt(now);
  if (stunde < STUNDE) return { gesendet: false, grund: "vor 9 Uhr" };

  // Atomar beanspruchen: nur wer den Tag als Erster einträgt, sendet
  const claim = await d.all<{ value: string }>(
    `INSERT INTO app_config (key, value) VALUES ('tagesbericht_tag', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE app_config.value < excluded.value
     RETURNING value`,
    [tag]
  );
  if (claim[0]?.value !== tag) return { gesendet: false, grund: "heute schon gesendet" };

  const seitRow = await d.get<{ value: string }>("SELECT value FROM app_config WHERE key = 'tagesbericht_seit'");
  const seit = seitRow?.value || new Date(now.getTime() - DAY).toISOString();
  const daten = await berichtDaten(d, now, seit);
  const b = berichtText(daten);
  await d.run(
    "INSERT INTO app_config (key, value) VALUES ('tagesbericht_seit', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [now.toISOString()]
  );

  let push = 0;
  if (pushConfigured()) {
    push = (await sendPushToAll({ ...b.push, url: "/" }).catch(() => ({ sent: 0 }))).sent;
  }
  const mail = await mailSenden(d, b.betreff, b.text, berichtHtml(daten, b.betreff)).catch((e) => (e instanceof Error ? e.message : String(e)));
  return { gesendet: true, push, mail };
}
