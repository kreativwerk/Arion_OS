import type { DB } from "@/lib/db";
import { getDb } from "@/lib/db";
import { downloadFile, driveConfigured, searchPdfsByName } from "@/lib/google-drive";
import { pdfToLayoutText, parseSlips } from "@/lib/lohn-parse";
import { erkenneAnforderung, gleicherVorgang, normName, BESCHEINIGUNG_ARTEN, type Anforderung, type BescheinigungArt } from "@/lib/bescheinigung-erkennen";
import { baueVorlage, waehleQuellen, type Angaben, type Vorgang, type Vorlage, type Zettel } from "@/lib/bescheinigung-vorlage";
import { withLock } from "@/lib/run-lock";

/**
 * Bescheinigungen selbst erstellen statt auf SD Worx zu warten
 * (siehe docs/BESCHEINIGUNGEN.md):
 *
 * 1. Briefpost → Vorgang: Anforderungen der Arbeitsagentur und der Kassen
 *    werden aus den gelesenen Briefen erkannt (Erinnerungen hängen sich an den
 *    bestehenden Vorgang).
 * 2. Verdienstabrechnungen → lohn_zettel: Die SD-Worx-Sammel-PDFs aus dem Drive
 *    werden gelesen (nur lesend, im Drive ändert sich nichts).
 * 3. Vorgang + Zettel + Angaben → Ausfüllvorlage für das SV-Meldeportal.
 *
 * Abgegeben wird nur elektronisch im SV-Meldeportal – das macht ein Mensch.
 */

export const STATUS = ["offen", "sdworx", "gesendet", "erledigt"] as const;
export type Status = (typeof STATUS)[number];

/** Dateiname der SD-Worx-Sammelabrechnung. Duplikate werden übersprungen. */
const LOHN_PDF_FRAGMENT = "Verdienstabrechnung_40007";
const CURSOR_KEY = "bescheinigung_brief_cursor";

export type BescheinigungRow = {
  id: number;
  art: BescheinigungArt;
  person: string;
  geb: string;
  rvnr: string;
  stelle: string;
  zeichen: string;
  von: string;
  bis: string;
  frist: string;
  status: Status;
  letter_ids: string;
  angaben: string;
  notiz: string;
  gesendet_am: string;
  created_at: string;
  updated_at: string;
};

export function parseAngaben(raw: string | null | undefined): Angaben {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Angaben) : {};
  } catch {
    return {};
  }
}

/* ── 1. Briefpost → Vorgänge ───────────────────────────────────────────── */

type LetterRow = { id: number; subject: string; sender: string; summary: string; extracted: string; due_date: string; status: string };

/** Briefe ab dem gespeicherten Stand prüfen. `alle` = von vorn (Nachholen). */
export async function erkenneAusBriefen(d: DB, alle = false): Promise<{ neu: number; erinnerungen: number }> {
  const cursor = alle ? 0 : Number((await d.get<{ value: string }>("SELECT value FROM app_config WHERE key = ?", [CURSOR_KEY]))?.value ?? 0);
  const letters = await d.all<LetterRow>(
    "SELECT id, subject, sender, summary, extracted, due_date, status FROM letters WHERE id > ? AND summary <> '' ORDER BY id",
    [cursor]
  );
  let neu = 0;
  let erinnerungen = 0;
  let max = cursor;
  const offen = await d.all<BescheinigungRow>("SELECT * FROM bescheinigungen");
  for (const l of letters) {
    max = Math.max(max, Number(l.id));
    const a = erkenneAnforderung(l);
    if (!a) continue;
    const dup = offen.find((o) => gleicherVorgang(o, a) && (!a.von || !o.von || o.von === a.von));
    if (dup) {
      const ids = dup.letter_ids.split(",").filter(Boolean);
      if (ids.includes(String(l.id))) continue;
      ids.push(String(l.id));
      const frist = a.frist && a.frist > (dup.frist || "") ? a.frist : dup.frist;
      await d.run(
        `UPDATE bescheinigungen SET letter_ids = ?, frist = ?, zeichen = COALESCE(NULLIF(zeichen, ''), ?), rvnr = COALESCE(NULLIF(rvnr, ''), ?),
         geb = COALESCE(NULLIF(geb, ''), ?), von = COALESCE(NULLIF(von, ''), ?), bis = COALESCE(NULLIF(bis, ''), ?), updated_at = ? WHERE id = ?`,
        [ids.join(","), frist, a.zeichen, a.rvnr, a.geb, a.von, a.bis, new Date().toISOString(), dup.id]
      );
      Object.assign(dup, { letter_ids: ids.join(","), frist });
      erinnerungen++;
      continue;
    }
    const status: Status = l.status === "erledigt" ? "erledigt" : l.status === "sdworx" ? "sdworx" : "offen";
    const id = await d.insert(
      `INSERT INTO bescheinigungen (art, person, geb, rvnr, stelle, zeichen, von, bis, frist, status, letter_ids, angaben)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [a.art, a.person, a.geb, a.rvnr, a.stelle, a.zeichen, a.von, a.bis, a.frist, status, String(l.id), "{}"]
    );
    offen.push({ id, ...a, status, letter_ids: String(l.id) } as unknown as BescheinigungRow);
    neu++;
  }
  await d.run("INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [CURSOR_KEY, String(max)]);
  return { neu, erinnerungen };
}

/** Von Hand angelegter Vorgang (z. B. Anforderung kam per Telefon). */
export async function legeAn(d: DB, a: Partial<Anforderung>): Promise<number> {
  const art = BESCHEINIGUNG_ARTEN.includes(a.art as BescheinigungArt) ? (a.art as BescheinigungArt) : "sonstiges";
  return d.insert(
    "INSERT INTO bescheinigungen (art, person, geb, rvnr, stelle, zeichen, von, bis, frist, status, letter_ids, angaben) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [art, s(a.person, 120), s(a.geb, 10), s(a.rvnr, 12), s(a.stelle, 200), s(a.zeichen, 60), s(a.von, 10), s(a.bis, 10), s(a.frist, 10), "offen", "", "{}"]
  );
}

function s(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

/* ── 2. Verdienstabrechnungen einlesen ─────────────────────────────────── */

export async function importiereLohnPdf(d: DB, quelleId: string, name: string, data: Uint8Array): Promise<number> {
  const zettel = parseSlips(await pdfToLayoutText(data));
  let nr = 0;
  for (const z of zettel) {
    nr++;
    await d.run(
      `INSERT INTO lohn_zettel (quelle_id, nr, pn, monat, lauf, art, name, geb, rvnr, eintritt, austritt, kk, bgrs, pgr, sv_tage,
        brutto_ct, sv_lfd_ct, sv_eb_ct, netto_ct, auszahlung_ct, lohnarten)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (quelle_id, nr) DO NOTHING`,
      [quelleId, nr, z.pn, z.monat, z.lauf, z.art, z.name, z.geb, z.rvnr, z.eintritt, z.austritt, z.kk, z.bgrs, z.pgr, z.svTage,
        z.bruttoCt, z.svLfdCt, z.svEbCt, z.nettoCt, z.auszahlungCt, JSON.stringify(z.lohnarten)]
    );
  }
  const monat = zettel.map((z) => z.monat).sort().pop() ?? "";
  await d.run(
    "INSERT INTO lohn_importe (quelle_id, name, monat, zettel, fehler) VALUES (?,?,?,?,'') ON CONFLICT (quelle_id) DO UPDATE SET zettel = excluded.zettel, fehler = ''",
    [quelleId, name.slice(0, 300), monat, zettel.length]
  );
  return zettel.length;
}

/** Neue Sammel-PDFs aus dem Drive lesen – neueste zuerst, so viele die Zeit erlaubt. */
export async function runLohnImport(d: DB, deadline: number): Promise<{ dateien: number; zettel: number; offen: number; hinweis?: string }> {
  if (!(await driveConfigured())) return { dateien: 0, zettel: 0, offen: 0, hinweis: "Google Drive ist nicht verbunden." };
  const known = new Set((await d.all<{ quelle_id: string }>("SELECT quelle_id FROM lohn_importe")).map((r) => r.quelle_id));
  const files = (await searchPdfsByName(LOHN_PDF_FRAGMENT, { deadline }))
    .filter((f) => !/duplikat/i.test(f.name) && /^\d{4}_\d{2}_Verdienstabrechnung/.test(f.name) && !known.has(f.id))
    .sort((a, b) => b.name.localeCompare(a.name));
  let dateien = 0;
  let zettel = 0;
  for (const f of files) {
    if (deadline - Date.now() < 40_000) break;
    try {
      zettel += await importiereLohnPdf(d, f.id, f.name, new Uint8Array(await downloadFile(f.id, { deadline })));
    } catch (e) {
      await d.run(
        "INSERT INTO lohn_importe (quelle_id, name, fehler) VALUES (?,?,?) ON CONFLICT (quelle_id) DO UPDATE SET fehler = excluded.fehler",
        [f.id, f.name.slice(0, 300), String((e as Error).message ?? e).slice(0, 300)]
      );
    }
    dateien++;
  }
  return { dateien, zettel, offen: files.length - dateien };
}

/* ── 3. Vorlage ────────────────────────────────────────────────────────── */

type ZettelRow = Omit<Zettel, "lohnarten"> & { lohnarten: string; quelle_id: string; quelle_name: string; nr: number };

/** Zettel einer Person: über RV-Nummer, sonst Geburtsdatum + Name. */
export async function zettelFuer(d: DB, v: Pick<Vorgang, "rvnr" | "geb" | "person">): Promise<Zettel[]> {
  const SEL = "SELECT z.*, i.name AS quelle_name FROM lohn_zettel z JOIN lohn_importe i ON i.quelle_id = z.quelle_id";
  let rows: ZettelRow[] = [];
  if (v.rvnr) rows = await d.all<ZettelRow>(`${SEL} WHERE z.rvnr = ? ORDER BY z.monat, z.nr`, [v.rvnr]);
  if (!rows.length && v.geb) {
    const kandidaten = await d.all<ZettelRow>(`${SEL} WHERE z.geb = ? ORDER BY z.monat, z.nr`, [v.geb]);
    const name = normName(v.person);
    rows = kandidaten.filter((z) => {
      const n = normName(z.name);
      return n === name || name.split(" ").filter((t) => n.includes(t)).length >= 2;
    });
  }
  return waehleQuellen(rows).map((z) => ({ ...z, lohnarten: JSON.parse(z.lohnarten || "[]") }));
}

export async function vorlageFuer(d: DB, row: BescheinigungRow): Promise<{ vorlage: Vorlage; zettel: number }> {
  const z = await zettelFuer(d, row);
  return { vorlage: baueVorlage(row, z, parseAngaben(row.angaben)), zettel: z.length };
}

/** Liste mit Kennzahlen für die Übersicht. */
export async function overview(d: DB) {
  const rows = await d.all<BescheinigungRow>(
    "SELECT * FROM bescheinigungen ORDER BY CASE status WHEN 'offen' THEN 0 WHEN 'sdworx' THEN 1 WHEN 'gesendet' THEN 2 ELSE 3 END, frist = '', frist, id DESC"
  );
  const out = [];
  for (const r of rows) {
    const { vorlage, zettel } = r.status === "erledigt" ? { vorlage: null, zettel: 0 } : await vorlageFuer(d, r);
    out.push({ ...r, fehlend: vorlage?.fehlend.length ?? 0, warnungen: vorlage?.warnungen.length ?? 0, zettel });
  }
  const lohn = await d.get<{ dateien: number; von: string; bis: string }>(
    "SELECT COUNT(*) AS dateien, MIN(monat) AS von, MAX(monat) AS bis FROM lohn_importe WHERE fehler = ''"
  );
  return { vorgaenge: out, lohn: { dateien: Number(lohn?.dateien ?? 0), von: lohn?.von ?? "", bis: lohn?.bis ?? "" } };
}

/** Cron-Schritt nach dem Briefkasten: Vorgänge erkennen, dann neue Abrechnungen lesen. */
export async function runBescheinigungen(deadline: number) {
  const d = await getDb();
  const res = await withLock(
    d,
    "bescheinigungen",
    async () => {
      const erkannt = await erkenneAusBriefen(d);
      const lohn = deadline - Date.now() > 60_000 ? await runLohnImport(d, deadline) : { dateien: 0, zettel: 0, offen: -1 };
      return { erkannt, lohn };
    },
    6 * 60_000
  );
  return res ?? { hinweis: "Läuft gerade schon." };
}
