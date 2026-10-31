import type { DB } from "@/lib/db";

/**
 * Fälligkeiten aus Codriver für den Tagesbericht: TÜV/HU und andere
 * Fahrzeugdokumente, Miet-/Leasingende, Vertragsende der Fahrer,
 * ablaufende Führerscheine und Ausweise/Aufenthaltstitel.
 *
 * Quelle ist der Spiegel `codriver_docs` (lib/codriver-sync.ts):
 *   vehicles, vehicle_documents (Unterordner vehicles/{id}/documents), drivers.
 * Die Auswertung selbst ist eine reine Funktion (tests/tagesbericht.test.mjs).
 */

const DAY = 86_400_000;
/** So weit voraus wird gemeldet */
export const CODRIVER_TAGE_VORAUS = 30;
/** So lange bleibt eine überfällige Frist im Bericht */
export const CODRIVER_TAGE_ZURUECK = 60;

export type CodriverFrist = {
  bereich: "fahrzeug" | "fahrer";
  /** z. B. „MAZ6416 – TÜV/HU“ oder „Max Muster – Vertrag endet“ */
  titel: string;
  /** z. B. „Mercedes-Benz Sprinter · DBY5“ */
  detail: string;
  datum: string;
  tage: number;
};

type Doc = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const obj = (v: unknown): Doc => (v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : {});

/** „03/08/2031“, „03.08.2031“, „2031-08-03“ oder ISO-Zeitstempel → „2031-08-03“ (sonst ""). */
export function isoTag(raw: unknown): string {
  const s = str(raw);
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    // Zeitstempel um Mitternacht Berlin liegen in UTC am Vortag (z. B. 2026-10-31T23:00Z = 01.11.)
    if (/T(2[2-3]):00/.test(s)) {
      const d = new Date(new Date(s).getTime() + 3 * 3600_000);
      return d.toISOString().slice(0, 10);
    }
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

const tageBis = (tag: string, today: string) =>
  Math.round((new Date(`${tag}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / DAY);

const DOKUMENT: Record<string, string> = {
  HU_TUV_CERTIFICATE: "TÜV/HU",
  TUV: "TÜV/HU",
  HU: "TÜV/HU",
  AU: "Abgasuntersuchung",
  UVV: "UVV-Prüfung",
  UVV_CERTIFICATE: "UVV-Prüfung",
  SP_CERTIFICATE: "Sicherheitsprüfung",
  INSURANCE: "Versicherung",
  INSURANCE_CERTIFICATE: "Versicherung",
  FAHRZEUGSCHEIN: "Zulassung",
  REGISTRATION: "Zulassung",
  LEASING_CONTRACT: "Leasingvertrag",
  RENTAL_CONTRACT: "Mietvertrag",
  SERVICE: "Wartung",
  MAINTENANCE: "Wartung",
};

function dokumentName(typ: string): string {
  if (DOKUMENT[typ]) return DOKUMENT[typ];
  const t = typ.replace(/_/g, " ").toLowerCase().trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Dokument";
}

function imFenster(tage: number, voraus = CODRIVER_TAGE_VORAUS, zurueck = CODRIVER_TAGE_ZURUECK) {
  return tage <= voraus && tage >= -zurueck;
}

export type CodriverQuellen = { vehicles: Doc[]; vehicleDocuments: Doc[]; drivers: Doc[] };

/** Reine Auswertung: alle Codriver-Fälligkeiten im Fenster, früheste zuerst. */
export function codriverFaelligkeiten(q: CodriverQuellen, today: string): CodriverFrist[] {
  const out: CodriverFrist[] = [];

  // ── Fahrzeuge ──
  const fahrzeug = new Map<string, Doc>();
  for (const v of q.vehicles) {
    const plate = str(v.plateNumber);
    if (!plate || v.isDeleted || str(v.status) === "DEFLEETED") continue;
    fahrzeug.set(plate, v);
  }
  const beschreibung = (v: Doc) => {
    const cortex = obj(v.cortex);
    const modell = [str(v.brand), str(v.model)].filter(Boolean).join(" ");
    const station = str(cortex.stationCode) || str(v.station);
    return [modell, station].filter(Boolean).join(" · ");
  };

  // je Fahrzeug und Dokumenttyp nur das neueste Ablaufdatum (alte TÜV-Berichte überspringen)
  const neuestes = new Map<string, { plate: string; typ: string; datum: string }>();
  for (const d of q.vehicleDocuments) {
    if (d.isDeleted) continue;
    const plate = str(d.plateNumber);
    const datum = isoTag(d.expiryDate);
    if (!plate || !datum || !fahrzeug.has(plate)) continue;
    const typ = str(d.documentType) || "DOKUMENT";
    const key = `${plate}|${dokumentName(typ)}`;
    const alt = neuestes.get(key);
    if (!alt || alt.datum < datum) neuestes.set(key, { plate, typ, datum });
  }
  for (const n of neuestes.values()) {
    const tage = tageBis(n.datum, today);
    if (!imFenster(tage)) continue;
    out.push({ bereich: "fahrzeug", titel: `${n.plate} – ${dokumentName(n.typ)}`, detail: beschreibung(fahrzeug.get(n.plate)!), datum: n.datum, tage });
  }

  for (const [plate, v] of fahrzeug) {
    const cortex = obj(v.cortex);
    const reg = isoTag(cortex.registrationExpiry);
    if (reg) {
      const tage = tageBis(reg, today);
      if (imFenster(tage)) out.push({ bereich: "fahrzeug", titel: `${plate} – Zulassung läuft ab`, detail: beschreibung(v), datum: reg, tage });
    }
    const ende = isoTag(cortex.ownershipEnd) || isoTag(obj(v.metadata).contractEndDate);
    if (ende) {
      const tage = tageBis(ende, today);
      // Miet-/Leasingende nur nach vorn melden – danach ist das Fahrzeug weg
      if (tage >= 0 && tage <= CODRIVER_TAGE_VORAUS) {
        const art = /LEASE|LEASED/.test(str(cortex.ownershipType)) ? "Leasingende" : "Mietende";
        out.push({ bereich: "fahrzeug", titel: `${plate} – ${art}`, detail: beschreibung(v), datum: ende, tage });
      }
    }
  }

  // ── Fahrer ──
  for (const f of q.drivers) {
    if (f.isDeleted || f.deleted) continue;
    const name = str(f.driverName) || str(obj(f.onboarding).fullName);
    if (!name) continue;
    const perioden = (Array.isArray(f.employmentPeriods) ? f.employmentPeriods : [])
      .map((p) => obj(p))
      .map((p) => ({ start: isoTag(p.start), ende: isoTag(p.end) }))
      .filter((p) => p.start)
      .sort((a, b) => b.start.localeCompare(a.start));
    const aktuell = perioden.find((p) => p.start <= today && (!p.ende || p.ende >= today));
    if (!aktuell) continue; // nur aktive Fahrer
    const station = str(f.station);
    const detail = [str(f.employeeNumber) ? `MA ${str(f.employeeNumber)}` : "", station].filter(Boolean).join(" · ");

    if (aktuell.ende) {
      const tage = tageBis(aktuell.ende, today);
      if (tage >= 0 && tage <= CODRIVER_TAGE_VORAUS) out.push({ bereich: "fahrer", titel: `${name} – Vertrag endet`, detail, datum: aktuell.ende, tage });
    }
    const ob = obj(f.onboarding);
    const fs = isoTag(ob.licenseExpiry);
    if (fs) {
      const tage = tageBis(fs, today);
      if (imFenster(tage)) out.push({ bereich: "fahrer", titel: `${name} – Führerschein läuft ab`, detail, datum: fs, tage });
    }
    const ausweis = isoTag(ob.idDocExpiry);
    if (ausweis) {
      const tage = tageBis(ausweis, today);
      if (imFenster(tage)) out.push({ bereich: "fahrer", titel: `${name} – Ausweis/Aufenthaltstitel läuft ab`, detail, datum: ausweis, tage });
    }
  }

  return out.sort((a, b) => a.tage - b.tage || a.titel.localeCompare(b.titel));
}

/* ── Laden aus dem Spiegel ───────────────────────────────── */

export type CodriverStand = { verbunden: boolean; letzterSync: string; fristen: CodriverFrist[] };

async function docs(d: DB, collection: string): Promise<Doc[]> {
  const rows = await d.all<{ data: string }>("SELECT data FROM codriver_docs WHERE collection = ? AND removed_at IS NULL", [collection]);
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

export async function codriverStand(d: DB, today: string): Promise<CodriverStand> {
  const leer: CodriverStand = { verbunden: false, letzterSync: "", fristen: [] };
  try {
    const t =
      d.dialect === "postgres"
        ? await d.get<{ t: string | null }>("SELECT to_regclass('codriver_docs')::text AS t")
        : await d.get<{ t: string | null }>("SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name = 'codriver_docs'");
    if (!t?.t) return leer;
    const [vehicles, vehicleDocuments, drivers] = await Promise.all([docs(d, "vehicles"), docs(d, "vehicle_documents"), docs(d, "drivers")]);
    if (!vehicles.length && !drivers.length) return leer;
    const sync = await d.get<{ value: string }>("SELECT value FROM app_config WHERE key = 'codriver_last_sync'");
    return { verbunden: true, letzterSync: sync?.value || "", fristen: codriverFaelligkeiten({ vehicles, vehicleDocuments, drivers }, today) };
  } catch {
    return leer;
  }
}
