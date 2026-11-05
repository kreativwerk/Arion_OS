import { vorgangStatus, wartetText, type VorgangStatus } from "@/lib/vorgang";
import type { DB } from "@/lib/db";
import { forwardFileNames } from "@/lib/mail-forward-names";
import { parseQontoEingang, parseQontoLastschrift } from "@/lib/home-widgets";
import { briefText, zahlungAus, type Zahlung } from "@/lib/zahlung";

/**
 * Daten für die neuen Startseiten-Widgets. Jede Funktion ist für sich
 * abgesichert: fehlt eine Tabelle oder Quelle, liefert sie einen leeren
 * Zustand mit Hinweis statt die ganze Startseite zu blockieren.
 */

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const diffDays = (dateIso: string, today: string) =>
  Math.round((new Date(`${dateIso}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / DAY);

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error("[home]", e instanceof Error ? e.message : e);
    return fallback;
  }
}

/* ── Wartet auf dich: Mail-Entwürfe ─────────────────────── */

export type WartetItem = {
  id: number;
  an: string;
  betreff: string;
  status: string;
  quelle: string;
  erstellt: string;
  /** Konto, von dem gesendet wird (Label oder Adresse) */
  von: string;
  /** Anfang des Mailtexts für die Vorschau im Widget */
  vorschau: string;
  anhaenge: string[];
};

export function wartetAufDich(d: DB): Promise<WartetItem[]> {
  return safe(async () => {
    const rows = await d.all<{
      id: number;
      to_addr: string;
      subject: string;
      status: string;
      source: string;
      created_at: string;
      body_text: string;
      forward_mail_id: number | null;
      von: string | null;
    }>(
      `SELECT m.id, m.to_addr, m.subject, m.status, m.source, m.created_at, m.body_text, m.forward_mail_id,
              COALESCE(NULLIF(a.username, ''), a.address, a.label) AS von
       FROM mail_drafts m LEFT JOIN mail_accounts a ON a.id = m.account_id
       WHERE m.status IN ('entwurf','fehler') ORDER BY m.id DESC LIMIT 8`
    );
    const files = rows.length
      ? await safe(
          () =>
            d.all<{ draft_id: number; filename: string }>(
              `SELECT draft_id, filename FROM mail_draft_files WHERE draft_id IN (${rows.map(() => "?").join(",")}) ORDER BY id`,
              rows.map((r) => Number(r.id))
            ),
          []
        )
      : [];
    const fwd = await safe(() => forwardFileNames(d, rows), new Map<number, string[]>());
    return rows.map((r) => ({
      id: Number(r.id),
      an: r.to_addr,
      betreff: r.subject,
      status: r.status,
      quelle: r.source,
      erstellt: r.created_at,
      von: r.von ?? "",
      vorschau: entwurfVorschau(r.body_text ?? ""),
      anhaenge: [
        ...files.filter((f) => Number(f.draft_id) === Number(r.id)).map((f) => f.filename),
        ...(fwd.get(Number(r.id)) ?? []),
      ],
    }));
  }, []);
}

/** Erste Zeilen des Mailtexts, ohne Leerzeilen, gekürzt für die Karte. */
export function entwurfVorschau(text: string, max = 220): string {
  const flat = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/* ── Offene Fälle (mit Claude) ──────────────────────────── */

/**
 * Fälle, die Albert mit Claude bespricht, landen als Aufgabe mit
 * source = 'claude' in der Tabelle tasks (ohne Fälligkeit, damit sie
 * „Aufgaben heute“ nicht füllen). notes trägt den aktuellen Stand,
 * project den Bereich (Arion, Wohnwerk, …).
 */
export type FallItem = {
  id: number;
  titel: string;
  stand: string;
  bereich: string;
  erstellt: string;
  erledigtAm: string | null;
  prio: number;
  /** Stand beim Lohnbüro, aus der Zeile „SD Worx: …“ im Stand (null = betrifft SD Worx nicht). */
  sdworx: SdWorxStand | null;
  /** Frist aus der Zeile „Frist: TT.MM.JJJJ“ im Stand (YYYY-MM-DD), sonst null. */
  frist: string | null;
  /** Dokumente aus den Zeilen „Dokument: brief 37“ / „Dokument: mail 403/2“. */
  dokumente: FallDokument[];
  /** Vorgangsmodell (lib/vorgang.ts): ich · nachhaken · wartet · erledigt */
  status: VorgangStatus;
  /** „wartet auf SD Worx“ – leer, wenn Albert dran ist */
  wartet: string;
  naechsterSchritt: string;
  nachhakenAm: string | null;
};

/** Ein Dokument zum Fall: gescannter Brief oder Mail-Anhang, zum Öffnen und Herunterladen. */
export type FallDokument = { art: "brief" | "mail"; name: string; oeffnen: string; download: string };

/** weitergeleitet = liegt bei SD Worx · wartet = SD Worx wartet auf uns · offen = noch nicht weitergeleitet */
export type SdWorxStand = { status: "weitergeleitet" | "wartet" | "offen"; text: string };
export type Faelle = { offen: FallItem[]; erledigt: FallItem[] };

/** Erledigte Fälle bleiben so viele Tage sichtbar (zum Nachschauen/Zurückholen). */
export const FAELLE_ERLEDIGT_TAGE = 14;

export function faelle(d: DB, today: string): Promise<Faelle> {
  return safe(async () => {
    const seit = iso(new Date(new Date(`${today}T12:00:00Z`).getTime() - FAELLE_ERLEDIGT_TAGE * DAY));
    const [offen, erledigt] = await Promise.all([
      d.all<FallRow>(
        "SELECT id, title, notes, project, created_at, completed_at, priority, done, wer_dran, wartet_auf, naechster_schritt, nachhaken_am FROM tasks WHERE source = 'claude' AND accepted = 1 AND done = 0 ORDER BY priority ASC, id DESC LIMIT 40"
      ),
      d.all<FallRow>(
        "SELECT id, title, notes, project, created_at, completed_at, priority, done, wer_dran, wartet_auf, naechster_schritt, nachhaken_am FROM tasks WHERE source = 'claude' AND accepted = 1 AND done = 1 AND completed_at >= ? ORDER BY completed_at DESC LIMIT 20",
        [seit]
      ),
    ]);
    const rang: Record<VorgangStatus, number> = { nachhaken: 0, ich: 1, wartet: 2, erledigt: 3 };
    const offenItems = offen
      .map((r) => fallItem(r, today))
      .sort((a, b) => rang[a.status] - rang[b.status] || a.prio - b.prio || (a.frist ?? "9999").localeCompare(b.frist ?? "9999"));
    const result = { offen: offenItems, erledigt: erledigt.map((r) => fallItem(r, today)) };
    await safe(() => dokumentNamen(d, [...result.offen, ...result.erledigt]), undefined);
    return result;
  }, { offen: [], erledigt: [] });
}

/** Fehlende Dokumentnamen aus Betreff des Briefs bzw. Dateiname des Anhangs ergänzen. */
async function dokumentNamen(d: DB, items: FallItem[]): Promise<void> {
  const offen = items.flatMap((f) => f.dokumente).filter((x) => x.name === "");
  if (!offen.length) return;
  const briefIds = [...new Set(offen.filter((x) => x.art === "brief").map((x) => dokRef(x.oeffnen).id))];
  const mailIds = [...new Set(offen.filter((x) => x.art === "mail").map((x) => dokRef(x.oeffnen).id))];
  const [briefe, anhaenge] = await Promise.all([
    briefIds.length
      ? d.all<{ id: number; subject: string | null; file_ref: string | null }>(
          `SELECT id, subject, file_ref FROM letters WHERE id IN (${briefIds.map(() => "?").join(",")})`,
          briefIds
        )
      : [],
    mailIds.length
      ? d.all<{ mail_id: number; part: string; filename: string | null }>(
          `SELECT mail_id, part, filename FROM mail_attachment_blobs WHERE mail_id IN (${mailIds.map(() => "?").join(",")})`,
          mailIds
        )
      : [],
  ]);
  for (const x of offen) {
    const r = dokRef(x.oeffnen);
    if (x.art === "brief") {
      const b = briefe.find((b) => Number(b.id) === r.id);
      x.name = (b?.subject || b?.file_ref || "").trim() || `Brief ${r.id}`;
    } else {
      const a = anhaenge.find((a) => Number(a.mail_id) === r.id && a.part === r.part);
      x.name = (a?.filename ?? "").trim() || "Mail-Anhang";
    }
  }
}

function dokRef(url: string): { id: number; part: string } {
  const m = url.match(/(?:letters\/|id=)(\d+)(?:&part=([0-9.]+))?/);
  return { id: Number(m?.[1] ?? 0), part: m?.[2] ?? "" };
}

/**
 * Zeilen „Dokument: brief 37“ oder „Dokument: mail 403/2“ (Mail-ID/Anhang-Teil),
 * optional mit Namen: „Dokument: brief 37 – Zahlungserinnerung“. Mehrere Zeilen
 * erlaubt; sie verschwinden aus dem Stand.
 */
export function dokumenteAusStand(notes: string): { stand: string; dokumente: FallDokument[] } {
  const re = /^[ \t]*Dokument:[ \t]*(brief|mail)[ \t]+(\d+)(?:\/([0-9.]+))?(?:[ \t]+[–-][ \t]+(.+?))?[ \t]*$\r?\n?/gim;
  const dokumente: FallDokument[] = [];
  const stand = notes.replace(re, (_z, art: string, id: string, part: string | undefined, name: string | undefined) => {
    const a = art.toLowerCase();
    if (a === "brief") {
      dokumente.push({ art: "brief", name: name ?? "", oeffnen: `/api/letters/${id}`, download: `/api/letters/${id}?download=1` });
    } else if (part) {
      const q = `id=${id}&part=${part}`;
      dokumente.push({ art: "mail", name: name ?? "", oeffnen: `/api/mail/attachment?${q}&inline=1`, download: `/api/mail/attachment?${q}` });
    }
    return "";
  });
  return { stand: dokumente.length ? stand.replace(/\n{3,}/g, "\n\n").trim() : notes, dokumente };
}

type FallRow = {
  id: number;
  title: string;
  notes: string | null;
  project: string | null;
  created_at: string | null;
  completed_at: string | null;
  priority: number | null;
  done?: number | null;
  wer_dran?: string | null;
  wartet_auf?: string | null;
  naechster_schritt?: string | null;
  nachhaken_am?: string | null;
};

/**
 * Zeile „SD Worx: …“ im Stand eines Falls lesen, z. B.
 * „SD Worx: weitergeleitet 22.10.“, „SD Worx: wartet auf Wochenstunden“,
 * „SD Worx: nicht weitergeleitet“. Die Zeile verschwindet aus dem Stand.
 */
export function sdworxAusStand(notes: string): { stand: string; sdworx: SdWorxStand | null } {
  const m = notes.match(/^[ \t]*SD Worx:[ \t]*(.+?)[ \t]*$/im);
  if (!m) return { stand: notes.trim(), sdworx: null };
  const text = m[1];
  const low = text.toLowerCase();
  const status: SdWorxStand["status"] = /nicht|offen|noch nicht/.test(low)
    ? "offen"
    : /wartet|braucht|fehlt/.test(low)
      ? "wartet"
      : "weitergeleitet";
  return { stand: notes.replace(m[0], "").replace(/\n{3,}/g, "\n\n").trim(), sdworx: { status, text } };
}

/**
 * Zeile „Frist: TT.MM.JJJJ“ (auch „Frist: TT.MM.“ = laufendes Jahr) im Stand lesen.
 * Die Zeile verschwindet aus dem Stand; die Frist steht als Badge neben „dringend“.
 */
export function fristAusStand(notes: string, jahr = new Date().getFullYear()): { stand: string; frist: string | null } {
  const m = notes.match(/^[ \t]*Frist:[ \t]*(\d{1,2})\.(\d{1,2})\.(\d{4})?[ \t]*$/im);
  if (!m) return { stand: notes, frist: null };
  const frist = `${m[3] ?? jahr}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return { stand: notes.replace(m[0], "").replace(/\n{3,}/g, "\n\n").trim(), frist };
}

export function fallItem(r: FallRow, today = new Date().toISOString().slice(0, 10)): FallItem {
  const dok = dokumenteAusStand(r.notes ?? "");
  const f = fristAusStand(dok.stand);
  const { stand, sdworx } = sdworxAusStand(f.stand);
  return {
    id: Number(r.id),
    titel: r.title,
    stand,
    sdworx,
    frist: f.frist,
    dokumente: dok.dokumente,
    bereich: (r.project ?? "").trim(),
    erstellt: (r.created_at ?? "").slice(0, 10),
    erledigtAm: r.completed_at ? r.completed_at.slice(0, 10) : null,
    prio: Number(r.priority ?? 2),
    status: vorgangStatus(r, today),
    wartet: wartetText(r.wer_dran, r.wartet_auf),
    naechsterSchritt: (r.naechster_schritt ?? "").trim(),
    nachhakenAm: /^\d{4}-\d{2}-\d{2}/.test(r.nachhaken_am ?? "") ? String(r.nachhaken_am).slice(0, 10) : null,
  };
}

/* ── Fristen-Ampel ──────────────────────────────────────── */

export type Frist = {
  titel: string;
  datum: string;
  tage: number;
  art: "buchhaltung" | "aufgabe" | "vertrag" | "termin";
  href: string;
  /** Erstes Dokument zum Vorgang (Brief oder Mail-Anhang) zum direkten Öffnen */
  dokument?: { name: string; oeffnen: string };
};

export function fristen(d: DB, today: string): Promise<Frist[]> {
  return safe(async () => {
    const bis = iso(new Date(new Date(`${today}T12:00:00Z`).getTime() + 45 * DAY));
    const [buch, tasks, contracts, events] = await Promise.all([
      safe(
        () =>
          d.all<{ titel: string; faellig: string }>(
            "SELECT titel, faellig FROM buch_fristen WHERE status = 'offen' AND faellig IS NOT NULL AND faellig <= ? ORDER BY faellig LIMIT 10",
            [bis]
          ),
        []
      ),
      safe(
        () =>
          d.all<{ id: number; title: string; due_date: string; notes: string | null }>(
            "SELECT id, title, due_date, notes FROM tasks WHERE done = 0 AND accepted = 1 AND due_date IS NOT NULL AND due_date <= ? AND (recurrence IS NULL OR recurrence <> 'daily') ORDER BY due_date LIMIT 10",
            [bis]
          ),
        []
      ),
      safe(
        () =>
          d.all<{ name: string; end_date: string; cancel_period_days: number }>(
            "SELECT name, end_date, cancel_period_days FROM contracts WHERE end_date IS NOT NULL"
          ),
        []
      ),
      safe(
        () =>
          d.all<{ title: string; date: string }>(
            "SELECT title, date FROM calendar_events WHERE date >= ? AND date <= ? ORDER BY date LIMIT 5",
            [today, iso(new Date(new Date(`${today}T12:00:00Z`).getTime() + 7 * DAY))]
          ),
        []
      ),
    ]);
    const out: Frist[] = [];
    for (const b of buch) out.push({ titel: b.titel, datum: b.faellig, tage: diffDays(b.faellig, today), art: "buchhaltung", href: "/buchhaltung" });
    const verknuepft = tasks.length
      ? await safe(
          () =>
            d.all<{ id: number; task_id: number; subject: string | null }>(
              `SELECT id, task_id, subject FROM letters WHERE task_id IN (${tasks.map(() => "?").join(",")}) ORDER BY id DESC`,
              tasks.map((t) => Number(t.id))
            ),
          []
        )
      : [];
    for (const t of tasks) {
      const ausStand = dokumenteAusStand(t.notes ?? "").dokumente;
      const brief = verknuepft.find((b) => Number(b.task_id) === Number(t.id));
      const dok = ausStand[ausStand.length - 1] ?? (brief ? { name: brief.subject ?? "", oeffnen: `/api/letters/${brief.id}` } : undefined);
      out.push({
        titel: t.title,
        datum: t.due_date,
        tage: diffDays(t.due_date, today),
        art: "aufgabe",
        href: "/aufgaben",
        ...(dok ? { dokument: { name: dok.name || "Dokument", oeffnen: dok.oeffnen } } : {}),
      });
    }
    for (const c of contracts) {
      const kuendbar = iso(new Date(new Date(`${c.end_date.slice(0, 10)}T12:00:00Z`).getTime() - Number(c.cancel_period_days || 0) * DAY));
      const tage = diffDays(kuendbar, today);
      if (tage >= -7 && tage <= 45) out.push({ titel: `Kündigen bis: ${c.name}`, datum: kuendbar, tage, art: "vertrag", href: "/vertraege" });
    }
    for (const e of events) out.push({ titel: e.title, datum: e.date, tage: diffDays(e.date, today), art: "termin", href: "/kalender" });
    return out.sort((a, b) => a.tage - b.tage).slice(0, 10);
  }, []);
}

/* ── Konto: Qonto-Stand und angekündigte Lastschriften ──── */

export type Konto = {
  saldo: number | null;
  stand: string | null;
  lastschriften: { an: string; datum: string; betrag: number | null; tage: number }[];
  summe7: number;
};

export function konto(d: DB, today: string): Promise<Konto> {
  return safe(async () => {
    const [kz, mails] = await Promise.all([
      safe(
        () =>
          d.all<{ key: string; value: string; updated_at: string }>(
            "SELECT key, value, updated_at FROM buch_kennzahlen WHERE key IN ('qonto_saldo','qonto_stand')"
          ),
        []
      ),
      d.all<{ subject: string; body_text: string }>(
        "SELECT subject, body_text FROM mails WHERE from_addr LIKE '%qonto%' AND subject LIKE '%belasten%' AND date >= ? ORDER BY date DESC LIMIT 60",
        [iso(new Date(Date.now() - 20 * DAY))]
      ),
    ]);
    const map = Object.fromEntries(kz.map((k) => [k.key, k]));
    const saldo = map.qonto_saldo ? Number(String(map.qonto_saldo.value).replace(",", ".")) : null;
    const seen = new Set<string>();
    const lastschriften: Konto["lastschriften"] = [];
    for (const m of mails) {
      const p = parseQontoLastschrift(m.subject || "", m.body_text || "");
      if (!p) continue;
      const tage = diffDays(p.datum, today);
      const key = `${p.an}|${p.datum}|${p.betrag}`;
      if (tage < 0 || seen.has(key)) continue;
      seen.add(key);
      lastschriften.push({ ...p, tage });
    }
    lastschriften.sort((a, b) => a.tage - b.tage);
    const summe7 = lastschriften.filter((l) => l.tage <= 7).reduce((s, l) => s + (l.betrag ?? 0), 0);
    return {
      saldo: saldo !== null && Number.isFinite(saldo) ? saldo : null,
      stand: map.qonto_stand?.value || map.qonto_saldo?.updated_at || null,
      lastschriften: lastschriften.slice(0, 6),
      summe7,
    };
  }, { saldo: null, stand: null, lastschriften: [], summe7: 0 });
}

/* ── Wohnwerk: Mieteingänge des Monats ──────────────────── */

export type Wohnwerk = { monat: string; summe: number; anzahl: number; eingaenge: { von: string; betrag: number; datum: string }[] };

export function wohnwerk(d: DB, today: string): Promise<Wohnwerk> {
  const monat = today.slice(0, 7);
  return safe(async () => {
    const rows = await d.all<{ date: string; body_text: string }>(
      "SELECT date, body_text FROM mails WHERE account = 'WOHNWERK' AND from_addr LIKE '%qonto%' AND subject LIKE '%berweisung erhalten%' AND date >= ? ORDER BY date DESC LIMIT 200",
      [`${monat}-01`]
    );
    const eingaenge = rows
      .map((r) => {
        const p = parseQontoEingang(r.body_text || "");
        return p ? { ...p, datum: String(r.date).slice(0, 10) } : null;
      })
      .filter((x): x is { von: string; betrag: number; datum: string } => Boolean(x));
    return { monat, summe: eingaenge.reduce((s, e) => s + e.betrag, 0), anzahl: eingaenge.length, eingaenge: eingaenge.slice(0, 8) };
  }, { monat, summe: 0, anzahl: 0, eingaenge: [] });
}

/* ── Codriver: Station und Flotte ───────────────────────── */

type Doc = Record<string, unknown>;

async function codriverDocs(d: DB, collection: string): Promise<Doc[] | null> {
  const exists =
    d.dialect === "postgres"
      ? await d.get<{ t: string | null }>("SELECT to_regclass('codriver_docs')::text AS t")
      : await d.get<{ t: string | null }>("SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name = 'codriver_docs'");
  if (!exists?.t) return null;
  const rows = await d.all<{ data: string }>(
    "SELECT data FROM codriver_docs WHERE collection = ? AND removed_at IS NULL",
    [collection]
  );
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.data) as Doc;
      } catch {
        return null;
      }
    })
    .filter((x): x is Doc => Boolean(x));
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export type Station = {
  verbunden: boolean;
  abwesend: { name: string; art: string }[];
  offeneAntraege: number;
  vorfaelle: { datum: string; kennzeichen: string; schaden: string; fahrer: string; stillgelegt: boolean }[];
};

export function station(d: DB, today: string): Promise<Station> {
  const leer: Station = { verbunden: false, abwesend: [], offeneAntraege: 0, vorfaelle: [] };
  return safe(async () => {
    const [abs, inc] = await Promise.all([codriverDocs(d, "absence_requests"), codriverDocs(d, "incident_reports")]);
    if (!abs || !inc) return leer;
    const ART: Record<string, string> = { vacation: "Urlaub", sick_leave: "Krank", special_leave: "Sonderurlaub" };
    const abwesend = abs
      .filter((a) => str(a.status) === "approved" && !a.isDeleted && !a.deleted)
      .filter((a) => {
        // Codriver speichert Tage als Mitternacht Berlin in UTC (z. B. 2026-03-12T23:00Z = 13.03.)
        const von = new Date(new Date(str(a.fromDate)).getTime() + 2 * 3600_000).toISOString().slice(0, 10);
        const bis = new Date(new Date(str(a.toDate)).getTime() + 2 * 3600_000).toISOString().slice(0, 10);
        return von <= today && today <= bis;
      })
      .map((a) => ({ name: str(a.driverName), art: ART[str(a.type)] || str(a.type) }));
    const offeneAntraege = abs.filter((a) => str(a.status) === "pending" && !a.isDeleted).length;
    const seit = iso(new Date(new Date(`${today}T12:00:00Z`).getTime() - 7 * DAY));
    const vorfaelle = inc
      .map((i) => ({
        datum: (str(i.occurredAt) || str(i.createdAt)).slice(0, 10),
        kennzeichen: str(i.plate) || str(i.plateRaw),
        schaden: str(i.damage) || str(i.incidentType) || str(i.category),
        fahrer: str(i.driverName) || str(i.driverNameRaw),
        stillgelegt: str(i.grounding) === "yes",
      }))
      .filter((v) => v.datum >= seit)
      .sort((a, b) => b.datum.localeCompare(a.datum))
      .slice(0, 6);
    return { verbunden: true, abwesend, offeneAntraege, vorfaelle };
  }, leer);
}

export type Flotte = {
  verbunden: boolean;
  gesamt: number;
  nachStatus: { status: string; anzahl: number }[];
  ausgefallen: { kennzeichen: string; modell: string; status: string; grund: string }[];
};

const STATUS_DE: Record<string, string> = {
  ACTIVE: "Aktiv",
  OPERATIONAL: "Einsatzbereit",
  GROUNDED_DEFECT: "Defekt",
  IN_SERVICE: "Werkstatt",
  INACTIVE: "Inaktiv",
};

export function flotte(d: DB): Promise<Flotte> {
  const leer: Flotte = { verbunden: false, gesamt: 0, nachStatus: [], ausgefallen: [] };
  return safe(async () => {
    const veh = await codriverDocs(d, "vehicles");
    if (!veh) return leer;
    const aktiv = veh.filter((v) => !v.isDeleted && str(v.status) !== "DEFLEETED");
    const count = new Map<string, number>();
    for (const v of aktiv) {
      const s = STATUS_DE[str(v.status)] || str(v.status) || "unbekannt";
      count.set(s, (count.get(s) ?? 0) + 1);
    }
    const ausgefallen = aktiv
      .filter((v) => ["GROUNDED_DEFECT", "IN_SERVICE"].includes(str(v.status)))
      .map((v) => {
        const cortex = (v.cortex ?? {}) as Doc;
        return {
          kennzeichen: str(v.plateNumber),
          modell: [str(v.brand), str(v.model)].filter(Boolean).join(" "),
          status: STATUS_DE[str(v.status)] || str(v.status),
          grund: str(cortex.statusReasonMessage),
        };
      })
      .slice(0, 8);
    return {
      verbunden: true,
      gesamt: aktiv.length,
      nachStatus: [...count.entries()].map(([status, anzahl]) => ({ status, anzahl })).sort((a, b) => b.anzahl - a.anzahl),
      ausgefallen,
    };
  }, leer);
}

/* ── Heute: Jetzt dran · Wartet auf andere · Eingang (docs/VORGAENGE.md) ── */

export type JetztItem = {
  id: number;
  titel: string;
  schritt: string;
  projekt: string;
  frist: string | null;
  tage: number | null;
  dringend: boolean;
  status: VorgangStatus;
  /** „wartet auf SD Worx“ – nur bei nachhaken/wartet */
  wartet: string;
  nachhakenAm: string | null;
  /** Dokumente zum Vorgang: Zeilen „Dokument: …“ im Stand und Briefe mit letters.task_id */
  dokumente: FallDokument[];
  /** Überweisungsdaten, wenn der Vorgang eine Zahlung ist (lib/zahlung.ts) */
  zahlung: Zahlung | null;
};
export type Routine = { id: number; titel: string };
export type Jetzt = { items: JetztItem[]; gesamt: number; wartet: JetztItem[]; wartetGesamt: number; routinen: Routine[] };

type VorgangRow = {
  id: number;
  title: string;
  notes: string | null;
  project: string | null;
  due_date: string | null;
  priority: number | null;
  recurrence: string | null;
  horizon: string | null;
  wer_dran: string | null;
  wartet_auf: string | null;
  naechster_schritt: string | null;
  nachhaken_am: string | null;
};

/** Reine Auswahl für die Heute-Seite – testbar. */
export function jetztAuswaehlen(rows: VorgangRow[], today: string, max = 7): Jetzt {
  const tagesDiff = (iso: string) =>
    Math.round((new Date(`${iso}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / DAY);
  const jahr = Number(today.slice(0, 4));
  const routinen: Routine[] = [];
  const alle: JetztItem[] = [];
  for (const r of rows) {
    if ((r.recurrence ?? "") !== "") {
      if (!r.due_date || r.due_date.slice(0, 10) <= today) routinen.push({ id: Number(r.id), titel: r.title });
      continue;
    }
    if (r.horizon === "long") continue;
    const due = /^\d{4}-\d{2}-\d{2}/.test(r.due_date ?? "") ? String(r.due_date).slice(0, 10) : null;
    const frist = due ?? fristAusStand(r.notes ?? "", jahr).frist;
    alle.push({
      id: Number(r.id),
      titel: r.title,
      schritt: (r.naechster_schritt ?? "").trim(),
      projekt: (r.project ?? "").trim(),
      frist,
      tage: frist ? tagesDiff(frist) : null,
      dringend: Number(r.priority ?? 2) === 1,
      status: vorgangStatus({ done: 0, wer_dran: r.wer_dran, nachhaken_am: r.nachhaken_am }, today),
      wartet: wartetText(r.wer_dran, r.wartet_auf),
      nachhakenAm: /^\d{4}-\d{2}-\d{2}/.test(r.nachhaken_am ?? "") ? String(r.nachhaken_am).slice(0, 10) : null,
      dokumente: dokumenteAusStand(r.notes ?? "").dokumente,
      zahlung: null,
    });
  }
  // Reihenfolge: Frist in ≤ 3 Tagen (auch überfällig) · Nachhaken fällig · dringend · Rest nach Frist
  const gruppe = (x: JetztItem) => (x.tage !== null && x.tage <= 3 ? 0 : x.status === "nachhaken" ? 1 : x.dringend ? 2 : 3);
  const bei = alle
    .filter((x) => x.status === "ich" || x.status === "nachhaken")
    .sort((a, b) => gruppe(a) - gruppe(b) || (a.frist ?? "9999").localeCompare(b.frist ?? "9999") || a.titel.localeCompare(b.titel));
  const wartend = alle
    .filter((x) => x.status === "wartet")
    .sort((a, b) => (a.nachhakenAm ?? "9999").localeCompare(b.nachhakenAm ?? "9999"));
  return { items: bei.slice(0, max), gesamt: bei.length, wartet: wartend.slice(0, 5), wartetGesamt: wartend.length, routinen };
}

export function jetzt(d: DB, today: string): Promise<Jetzt> {
  return safe(async () => {
    const rows = await d.all<VorgangRow>(
      `SELECT id, title, notes, project, due_date, priority, recurrence, horizon, wer_dran, wartet_auf, naechster_schritt, nachhaken_am
       FROM tasks WHERE done = 0 AND accepted = 1`
    );
    const j = jetztAuswaehlen(rows, today);
    const notes = new Map(rows.map((r) => [Number(r.id), r.notes ?? ""]));
    await safe(() => vorgangDokumente(d, [...j.items, ...j.wartet], notes), undefined);
    return j;
  }, { items: [], gesamt: 0, wartet: [], wartetGesamt: 0, routinen: [] });
}

type BriefRow = { id: number; task_id: number | null; subject: string | null; file_ref: string | null; sender: string | null; reference: string | null; extracted: string | null };

/**
 * Dokumente und Zahlungsdaten an die Vorgänge hängen: Briefe aus den Zeilen
 * „Dokument: brief N“ und Briefe mit letters.task_id = Vorgang. Mail-Anhänge
 * bekommen ihren Dateinamen.
 */
export async function vorgangDokumente(d: DB, items: JetztItem[], notes: Map<number, string>): Promise<void> {
  if (!items.length) return;
  const taskIds = [...new Set(items.map((x) => x.id))];
  const briefIds = [...new Set(items.flatMap((x) => x.dokumente.filter((k) => k.art === "brief").map((k) => dokRef(k.oeffnen).id)))];
  const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");
  const briefe = await d.all<BriefRow>(
    `SELECT id, task_id, subject, file_ref, sender, reference, extracted FROM letters WHERE task_id IN (${ph(taskIds.length)})${
      briefIds.length ? ` OR id IN (${ph(briefIds.length)})` : ""
    } ORDER BY id DESC LIMIT 200`,
    [...taskIds, ...briefIds]
  );
  const eigene = [process.env.QONTO_IBAN ?? ""].filter(Boolean);
  for (const x of items) {
    const ausStand = new Set(x.dokumente.filter((k) => k.art === "brief").map((k) => dokRef(k.oeffnen).id));
    const verknuepft = briefe.filter((b) => Number(b.task_id) === x.id && !ausStand.has(Number(b.id)));
    for (const b of verknuepft) {
      x.dokumente.push({ art: "brief", name: "", oeffnen: `/api/letters/${b.id}`, download: `/api/letters/${b.id}?download=1` });
    }
    // Neueste Briefe zuerst – die letzte Mahnung trägt den aktuellen Stand
    const zumVorgang = briefe.filter((b) => ausStand.has(Number(b.id)) || Number(b.task_id) === x.id).sort((a, b) => Number(b.id) - Number(a.id));
    for (const k of x.dokumente) {
      if (k.art !== "brief" || k.name) continue;
      const b = briefe.find((b) => Number(b.id) === dokRef(k.oeffnen).id);
      k.name = (b?.subject || b?.file_ref || "").trim() || `Brief ${dokRef(k.oeffnen).id}`;
    }
    x.zahlung = zahlungAus(
      { titel: x.titel, schritt: x.schritt, notes: notes.get(x.id) ?? "" },
      zumVorgang.map((b) => ({ sender: b.sender, reference: b.reference, text: briefText(b.extracted) })),
      eigene
    );
  }
  // Mail-Anhänge: Dateinamen nachtragen
  const mails = items.flatMap((x) => x.dokumente).filter((k) => k.art === "mail" && !k.name);
  if (mails.length) {
    const ids = [...new Set(mails.map((k) => dokRef(k.oeffnen).id))];
    const anh = await safe(
      () => d.all<{ mail_id: number; part: string; filename: string | null }>(`SELECT mail_id, part, filename FROM mail_attachment_blobs WHERE mail_id IN (${ph(ids.length)})`, ids),
      []
    );
    for (const k of mails) {
      const r = dokRef(k.oeffnen);
      k.name = (anh.find((a) => Number(a.mail_id) === r.id && a.part === r.part)?.filename ?? "").trim() || "Mail-Anhang";
    }
  }
}

export type EingangZahlen = { briefe: number; mails: number; mitarbeiter: number; gesamt: number };

export function eingangZahlen(d: DB): Promise<EingangZahlen> {
  return safe(async () => {
    const [b, m, t] = await Promise.all([
      d.get<{ n: number }>("SELECT COUNT(*) AS n FROM letters WHERE status = 'neu'"),
      d.get<{ n: number }>("SELECT COUNT(*) AS n FROM mail_digest WHERE read = 0 AND important = 1"),
      d.get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE done = 0 AND accepted = 0"),
    ]);
    const briefe = Number(b?.n ?? 0);
    const mails = Number(m?.n ?? 0);
    const mitarbeiter = Number(t?.n ?? 0);
    return { briefe, mails, mitarbeiter, gesamt: briefe + mails + mitarbeiter };
  }, { briefe: 0, mails: 0, mitarbeiter: 0, gesamt: 0 });
}
