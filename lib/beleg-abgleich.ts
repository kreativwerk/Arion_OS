import type { DB } from "@/lib/db";
import { driveConfigured, listFilesUnder, type DriveTreeFile } from "@/lib/google-drive";
import { qontoAbbuchungen, qontoConfigured } from "@/lib/qonto";
import { KAT, monatAusPfad, monatsOrdner, nachbarMonat, ohneBelegGrund, ordneZu, type Datei } from "@/lib/abgleich-regeln";

/**
 * Monatsabgleich auf /buchhaltung („Abgleichen“):
 * 1. Abbuchungen des Monats aus Qonto holen (nur lesend) → buch_ausgaben
 * 2. Belege im Drive suchen (Monatsordner, Vor-/Folgemonat, Konto-1590-Ordner)
 * 3. Jede Abbuchung bekommt „Beleg gefunden“, „FEHLT“, „Beleg in Qonto“ oder
 *    „Kein Beleg nötig“. Von Albert gesetztes „Kein Beleg nötig“ bleibt stehen.
 * Es wird nichts im Drive verändert.
 */

export type AbgleichResult = {
  monat: string;
  importiert: number;
  geprueft: number;
  gefunden: number;
  fehlt: number;
  ohne: number;
  hinweise: string[];
};

const GEMERKT_KEY = "ohne_beleg_empfaenger";

export async function gemerkteEmpfaenger(d: DB): Promise<string[]> {
  const row = await d.get<{ value: string }>("SELECT value FROM buch_kennzahlen WHERE key = ?", [GEMERKT_KEY]);
  try {
    const v = JSON.parse(row?.value || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function merkeEmpfaenger(d: DB, empfaenger: string): Promise<void> {
  const name = empfaenger.trim().toLowerCase();
  if (!name) return;
  const list = await gemerkteEmpfaenger(d);
  if (list.includes(name)) return;
  list.push(name);
  const value = JSON.stringify(list.slice(-500));
  const now = new Date().toISOString();
  const exists = await d.get("SELECT key FROM buch_kennzahlen WHERE key = ?", [GEMERKT_KEY]);
  if (exists) await d.run("UPDATE buch_kennzahlen SET value = ?, updated_at = ? WHERE key = ?", [value, now, GEMERKT_KEY]);
  else await d.run("INSERT INTO buch_kennzahlen (key, value, updated_at) VALUES (?,?,?)", [GEMERKT_KEY, value, now]);
}

type AusgabeRow = { id: number; empfaenger: string; zweck: string; betrag: number; kategorie: string; beleg: string; hinweis: string; monat: string };

export async function runAbgleich(d: DB, monat: string, deadline: number): Promise<AbgleichResult> {
  const res: AbgleichResult = { monat, importiert: 0, geprueft: 0, gefunden: 0, fehlt: 0, ohne: 0, hinweise: [] };
  const gemerkt = await gemerkteEmpfaenger(d);

  // 1. Qonto
  if (qontoConfigured()) {
    const txs = await qontoAbbuchungen(monat, deadline);
    for (const t of txs) {
      const datum = (t.settled_at ?? t.emitted_at ?? "").slice(0, 10) || null;
      const zweck = [t.transfer?.reference, t.reference, t.note].filter(Boolean).join(" · ").slice(0, 500);
      const grund =
        t.attachment_ids?.length > 0
          ? "qonto"
          : ohneBelegGrund({
              operation_type: t.operation_type,
              label: t.label,
              kategorie: t.cashflow_category?.name ?? "",
              referenz: zweck,
              gemerkt,
            });
      const cur = await d.get<{ id: number; hinweis: string }>("SELECT id, hinweis FROM buch_ausgaben WHERE qonto_id = ?", [t.id]);
      if (cur) {
        await d.run("UPDATE buch_ausgaben SET monat = ?, datum = ?, empfaenger = ?, zweck = ?, betrag = ? WHERE id = ?", [
          monat,
          datum,
          t.label ?? "",
          zweck,
          Math.abs(Number(t.amount) || 0),
          cur.id,
        ]);
        if (grund && !String(cur.hinweis || "").startsWith("manuell")) {
          await d.run("UPDATE buch_ausgaben SET kategorie = ?, hinweis = ? WHERE id = ?", [
            grund === "qonto" ? KAT.qonto : KAT.ohne,
            grund === "qonto" ? "Beleg hängt in Qonto" : grund,
            cur.id,
          ]);
        }
      } else {
        await d.insert(
          "INSERT INTO buch_ausgaben (monat, datum, empfaenger, zweck, betrag, kategorie, beleg, hinweis, qonto_id) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            monat,
            datum,
            t.label ?? "",
            zweck,
            Math.abs(Number(t.amount) || 0),
            grund === "qonto" ? KAT.qonto : grund ? KAT.ohne : KAT.fehlt,
            "",
            grund === "qonto" ? "Beleg hängt in Qonto" : grund ?? "",
            t.id,
          ]
        );
        res.importiert++;
      }
    }
  } else {
    res.hinweise.push("Qonto ist noch nicht verbunden (QONTO_LOGIN / QONTO_SECRET_KEY in Vercel) – es werden nur vorhandene Buchungen abgeglichen.");
  }

  // 2. Belege im Drive
  const rows = await d.all<AusgabeRow>(
    "SELECT id, empfaenger, zweck, betrag, kategorie, beleg, hinweis, monat FROM buch_ausgaben WHERE monat = ?",
    [monat]
  );
  const offen = rows.filter((r) => r.kategorie === KAT.fehlt || r.kategorie === KAT.gefunden || !r.kategorie);
  res.geprueft = offen.length;
  if (!(await driveConfigured())) {
    res.hinweise.push("Google Drive ist nicht verbunden – Belege können nicht gesucht werden.");
  } else if (offen.length) {
    const jahr = monat.slice(0, 4);
    const pfade = [monatsOrdner(monat), monatsOrdner(nachbarMonat(monat, -1)), monatsOrdner(nachbarMonat(monat, 1)), `1590/${jahr}`];
    const dateien: DriveTreeFile[] = [];
    for (const p of pfade) {
      if (deadline - Date.now() < 6_000) {
        res.hinweise.push("Zeit knapp – nicht alle Ordner durchsucht, bitte noch einmal abgleichen.");
        break;
      }
      dateien.push(...(await listFilesUnder(p, 3, { deadline })));
    }
    // Belege, die schon einer Buchung eines anderen Monats gehören, nicht doppelt vergeben
    const belegt = new Set(
      (
        await d.all<{ beleg: string }>("SELECT beleg FROM buch_ausgaben WHERE monat <> ? AND kategorie = ? AND beleg <> ''", [
          monat,
          KAT.gefunden,
        ])
      ).map((r) => r.beleg)
    );
    const pool: Datei[] = dateien
      .filter((f) => !/gutschrift/i.test(f.name) && !belegt.has(`${f.pfad}/${f.name}`))
      .map((f) => ({ name: f.name, url: f.url, pfad: f.pfad }));
    const treffer = ordneZu(
      offen.map((r) => ({ key: r.id, betrag: Number(r.betrag), text: `${r.empfaenger} ${r.zweck}`, monat })),
      pool,
      (f) => monatAusPfad(f.pfad)
    );
    for (const r of offen) {
      const t = treffer.get(r.id);
      if (t) {
        await d.run("UPDATE buch_ausgaben SET kategorie = ?, beleg = ?, beleg_url = ?, hinweis = '' WHERE id = ?", [
          KAT.gefunden,
          `${t.pfad}/${t.name}`,
          t.url,
          r.id,
        ]);
      } else {
        await d.run("UPDATE buch_ausgaben SET kategorie = ?, beleg = '', beleg_url = '', hinweis = '' WHERE id = ?", [KAT.fehlt, r.id]);
      }
    }
  }

  const sum = await d.all<{ kategorie: string; n: number }>(
    "SELECT kategorie, COUNT(*) AS n FROM buch_ausgaben WHERE monat = ? GROUP BY kategorie",
    [monat]
  );
  for (const s of sum) {
    if (s.kategorie === KAT.gefunden) res.gefunden = Number(s.n);
    else if (s.kategorie === KAT.fehlt) res.fehlt = Number(s.n);
    else res.ohne += Number(s.n);
  }
  const now = new Date().toISOString();
  const key = `abgleich_${monat}`;
  const exists = await d.get("SELECT key FROM buch_kennzahlen WHERE key = ?", [key]);
  if (exists) await d.run("UPDATE buch_kennzahlen SET value = ?, updated_at = ? WHERE key = ?", [now, now, key]);
  else await d.run("INSERT INTO buch_kennzahlen (key, value, updated_at) VALUES (?,?,?)", [key, now, now]);
  return res;
}
