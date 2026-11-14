import { codriverFaelligkeiten, CODRIVER_TAGE_VORAUS } from "@/lib/codriver-faelligkeiten";

/**
 * Codriver-MCP für Arion: Claude (oder ein anderer MCP-Client) liest die
 * Arion-Daten aus Codriver – ohne Mac, nur lesend.
 *
 * Quelle ist ausschließlich der redigierte Spiegel `codriver_docs`
 * (lib/codriver-sync.ts). Bank-, Steuer-, Ausweis- und Gesundheitsdaten
 * sind dort bereits geschwärzt. Es gibt kein Werkzeug, das schreibt.
 *
 * Protokoll: MCP „Streamable HTTP“, zustandslos, JSON-Antworten
 * (JSON-RPC 2.0). Die Logik hier ist rein – die Route in
 * app/api/external/mcp/[token]/route.ts liefert nur den Datenzugriff.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const MCP_SERVER_INFO = { name: "arion-codriver", title: "Codriver (Arion)", version: "1.0.0" };

type Doc = Record<string, unknown>;
export type MirrorDoc = { collection: string; id: string; data: Doc; updated: string };

/** Datenzugriff – in der Route aus der DB, in Tests aus einem Array. */
export type MirrorSource = {
  docs(collection: string): Promise<MirrorDoc[]>;
  /** Datei aus dem Codriver-Speicher laden (nur Fahrzeugdaten). */
  datei?(ref: string): Promise<{ bytes: Uint8Array; mime: string; name: string }>;
  /** Text aus einem PDF (für den Fahrzeugschein) */
  pdfText?(bytes: Uint8Array): Promise<string>;
  stats(): Promise<{ collection: string; anzahl: number; letzterSync: string }[]>;
  lastSync(): Promise<string>;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const obj = (v: unknown): Doc => (v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : {});

/** Vergleichsform für Kennzeichen: Großbuchstaben, ohne Trenner, Umlaute als Grundbuchstabe.
 *  „FÜ-AL 158“, „fü al158“, „FU AL 158“ → „FUAL158“. */
export function normPlate(raw: unknown): string {
  return str(raw)
    .toUpperCase()
    .replace(/Ä/g, "A")
    .replace(/Ö/g, "O")
    .replace(/Ü/g, "U")
    .replace(/[^A-Z0-9]/g, "");
}

/** Suchvarianten für eine Eingabe – „FUE“/„FUE“ kann auch „FÜ“ meinen (Uelzen „UE“ bleibt erhalten). */
export function plateVarianten(raw: unknown): string[] {
  const a = normPlate(raw);
  const b = normPlate(str(raw).toUpperCase().replace(/([A-Z])UE/g, "$1Ü").replace(/([A-Z])OE/g, "$1Ö").replace(/([A-Z])AE/g, "$1Ä"));
  return [...new Set([a, b])].filter(Boolean);
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

const FILE_REF = /^(gs:\/\/|https:\/\/[^/]*(firebasestorage\.googleapis\.com|storage\.googleapis\.com|firebasestorage\.app)\/)/i;

/** Alle Datei-Links in einem Dokument mit ihrem Feldpfad, z. B. „files.0.url“. */
export function dateiLinks(v: unknown, pfad = ""): { feld: string; ref: string }[] {
  if (typeof v === "string") return FILE_REF.test(v) ? [{ feld: pfad, ref: v }] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => dateiLinks(x, pfad ? `${pfad}.${i}` : String(i)));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => dateiLinks(x, pfad ? `${pfad}.${k}` : k));
  return [];
}

/** Datei-Links durch einen Hinweis ersetzen – die Links selbst verlassen Arion OS nie. */
export function ohneLinks<T>(v: T): T {
  if (typeof v === "string") return (FILE_REF.test(v) ? "[Datei – mit codriver_datei abrufen]" : v) as T;
  if (Array.isArray(v)) return v.map(ohneLinks) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ohneLinks(x)])) as T;
  return v;
}

const SCHEIN = /fahrzeugschein|zulassungsbescheinigung|registration|zulassung|schein|zb1|zb_1|zb i/i;

/** Ist ein Fahrzeugdokument der Fahrzeugschein (Zulassungsbescheinigung Teil I)? */
export function istFahrzeugschein(d: Doc): boolean {
  const typ = str(d.documentType) || str(d.type) || str(d.category);
  if (/^(FAHRZEUGSCHEIN|REGISTRATION|REGISTRATION_CERTIFICATE|ZULASSUNG)/i.test(typ)) return true;
  return SCHEIN.test([typ, str(d.name), str(d.title), str(d.fileName)].join(" ")) && !/brief|teil ?ii|part ?2/i.test(str(d.name));
}

/** Ist das Dokument gelöscht/ausgemustert? */
const geloescht = (d: Doc) => Boolean(d.isDeleted || d.deleted);

/* ── Werkzeuge ───────────────────────────────────────────── */

type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Doc, src: MirrorSource, today: string): Promise<unknown>;
};

/** Rückgabe mit fertigen MCP-Inhalten (Bild/PDF) statt JSON-Text */
type Inhalte = { __inhalte: Record<string, unknown>[] };
const istInhalte = (x: unknown): x is Inhalte => Boolean(x && typeof x === "object" && "__inhalte" in x);

/** Fahrzeug zu Kennzeichen/VIN/ID finden – exakte Treffer, sonst ähnliche. */
function findeFahrzeuge(vehicles: MirrorDoc[], q: string): { treffer: MirrorDoc[]; aehnlich: MirrorDoc[] } {
  const varianten = plateVarianten(q);
  const np = varianten[0] || "";
  const treffer = vehicles.filter((v) => {
    const d = v.data;
    const c = obj(d.cortex);
    return (
      v.id === q ||
      varianten.includes(normPlate(d.plateNumber)) ||
      (q.length >= 6 && [str(d.vin), str(c.vin)].some((x) => x && x.toUpperCase().endsWith(q.toUpperCase())))
    );
  });
  const aehnlich = treffer.length || np.length < 3 ? [] : vehicles.filter((v) => varianten.some((x) => normPlate(v.data.plateNumber).includes(x))).slice(0, 10);
  return { treffer, aehnlich };
}

/** Gehört ein Dokument (Unterordner, Zusatzdaten, Ereignis) zu diesem Fahrzeug? */
function gehoertZu(v: MirrorDoc) {
  const plate = normPlate(v.data.plateNumber);
  return (d: MirrorDoc) =>
    d.id.startsWith(`${v.id}/`) || str(d.data.vehicleId) === v.id || Boolean(plate && normPlate(d.data.plateNumber) === plate);
}

async function dateiInhalt(src: MirrorSource, ref: string, titel: string): Promise<Record<string, unknown>[]> {
  if (!src.datei) throw new Error("Dateiabruf ist hier nicht verfügbar.");
  const f = await src.datei(ref);
  const b64 = Buffer.from(f.bytes).toString("base64");
  const out: Record<string, unknown>[] = [{ type: "text", text: `${titel} (${f.name}, ${f.mime}, ${Math.round(f.bytes.length / 1024)} KB)` }];
  if (f.mime.startsWith("image/")) {
    out.push({ type: "image", data: b64, mimeType: f.mime });
  } else if (f.mime === "application/pdf") {
    const text = src.pdfText ? await src.pdfText(f.bytes).catch(() => "") : "";
    out.push({ type: "text", text: text.trim() ? `Text aus dem PDF:\n${text.trim().slice(0, 20_000)}` : "Das PDF enthält keinen lesbaren Text (Scan) – Inhalt siehe angehängte Datei." });
    out.push({ type: "resource", resource: { uri: `codriver://datei/${encodeURIComponent(f.name)}`, mimeType: f.mime, blob: b64 } });
  } else {
    out.push({ type: "resource", resource: { uri: `codriver://datei/${encodeURIComponent(f.name)}`, mimeType: f.mime, blob: b64 } });
  }
  return out;
}

const LIMIT_MAX = 200;
const limitOf = (v: unknown, def: number) => Math.max(1, Math.min(LIMIT_MAX, Math.floor(Number(v) || def)));

function fahrerName(d: Doc): string {
  return str(d.driverName) || str(obj(d.onboarding).fullName) || [str(d.firstName), str(d.lastName)].filter(Boolean).join(" ");
}

function fahrerAktiv(d: Doc, today: string): boolean {
  const p = Array.isArray(d.employmentPeriods) ? d.employmentPeriods.map(obj) : [];
  if (!p.length) return !geloescht(d);
  return p.some((x) => {
    const s = str(x.start).slice(0, 10);
    const e = str(x.end).slice(0, 10);
    return s && s <= today && (!e || e >= today);
  });
}

function fahrzeugKurz(v: MirrorDoc) {
  const d = v.data;
  const c = obj(d.cortex);
  return {
    id: v.id,
    kennzeichen: str(d.plateNumber),
    marke: str(d.brand),
    modell: str(d.model),
    vin: str(d.vin) || str(c.vin),
    station: str(c.stationCode) || str(d.station),
    status: str(d.status) || str(c.status),
    eigentum: str(c.ownershipType),
    eigentumBis: str(c.ownershipEnd),
  };
}

function fahrerKurz(f: MirrorDoc, today: string) {
  const d = f.data;
  return {
    id: f.id,
    name: fahrerName(d),
    mitarbeiterNr: str(d.employeeNumber),
    station: str(d.station),
    transporterId: str(d.transporterId) || str(d.amazonId),
    aktiv: fahrerAktiv(d, today),
  };
}

const TOOLS: ToolDef[] = [
  {
    name: "codriver_status",
    title: "Codriver: Stand des Spiegels",
    description:
      "Zeigt, welche Codriver-Bereiche (Sammlungen) für Arion vorliegen, wie viele Einträge je Bereich und wann zuletzt abgeglichen wurde. Zuerst aufrufen, wenn unklar ist, welche Daten es gibt.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(_a, src) {
      const [stats, last] = await Promise.all([src.stats(), src.lastSync()]);
      return {
        letzterAbgleich: last || null,
        bereiche: stats,
        hinweis: stats.length
          ? "Daten sind redigiert (Bank, Steuer-ID, Ausweisnummern, Gesundheit geschwärzt). Nur lesend."
          : "Der Spiegel ist leer – der Codriver-Abgleich in Arion OS ist noch nicht eingerichtet oder noch nicht gelaufen.",
      };
    },
  },
  {
    name: "codriver_fahrzeug",
    title: "Codriver: Fahrzeug nachschlagen",
    description:
      "Sucht ein Fahrzeug über Kennzeichen (Schreibweise egal, z. B. „FÜ-AL 158“ oder „fual158“), VIN oder Codriver-ID und liefert Stammdaten, Cortex-Daten (Leasing/Miete, Station), Dokumente (TÜV/HU, UVV, Versicherung, Wartung …), Zusatzdaten und Flotten-Ereignisse.",
    inputSchema: {
      type: "object",
      properties: { suche: { type: "string", description: "Kennzeichen, VIN oder Fahrzeug-ID" } },
      required: ["suche"],
      additionalProperties: false,
    },
    async run(a, src) {
      const q = str(a.suche);
      if (!q) throw new Error("suche fehlt");
      const { treffer, aehnlich } = findeFahrzeuge(await src.docs("vehicles"), q);
      if (!treffer.length) {
        return aehnlich.length
          ? { gefunden: 0, aehnlich: aehnlich.map(fahrzeugKurz) }
          : { gefunden: 0, hinweis: `Kein Fahrzeug zu „${q}“ im Codriver-Spiegel.` };
      }
      const [dokumente, extras, events] = await Promise.all([
        src.docs("vehicle_documents"),
        src.docs("fleet_vehicle_extras"),
        src.docs("fleet_events"),
      ]);
      return {
        gefunden: treffer.length,
        fahrzeuge: treffer.map((v) => {
          const gehoert = gehoertZu(v);
          const docs = dokumente.filter((d) => gehoert(d) && !geloescht(d.data));
          return {
            ...fahrzeugKurz(v),
            fahrzeugschein: docs.some((d) => istFahrzeugschein(d.data)) || dateiLinks(v.data).some((l) => SCHEIN.test(l.feld))
              ? "vorhanden – mit codriver_fahrzeugschein abrufen"
              : "nicht in Codriver hinterlegt",
            daten: ohneLinks(v.data),
            dokumente: docs.map((d) => ({ id: d.id, fahrzeugschein: istFahrzeugschein(d.data) || undefined, ...ohneLinks(d.data) })),
            zusatz: extras.filter(gehoert).map((d) => ({ id: d.id, ...ohneLinks(d.data) })),
            ereignisse: events
              .filter(gehoert)
              .map((d) => ({ id: d.id, ...ohneLinks(d.data) }))
              .slice(0, 50),
          };
        }),
      };
    },
  },
  {
    name: "codriver_fahrzeugschein",
    title: "Codriver: Fahrzeugschein anzeigen",
    description:
      "Holt den Fahrzeugschein (Zulassungsbescheinigung Teil I) eines Fahrzeugs per Kennzeichen als Bild bzw. PDF – z. B. für FIN (Feld E), HSN/TSN (2.1/2.2), Erstzulassung (B) und Motor beim Teilebestellen. Dazu kommen die in Codriver gespeicherten Stammdaten (FIN, Marke, Modell).",
    inputSchema: {
      type: "object",
      properties: { kennzeichen: { type: "string", description: "Kennzeichen, VIN oder Fahrzeug-ID, Schreibweise egal" } },
      required: ["kennzeichen"],
      additionalProperties: false,
    },
    async run(a, src) {
      const q = str(a.kennzeichen);
      if (!q) throw new Error("kennzeichen fehlt");
      const { treffer, aehnlich } = findeFahrzeuge(await src.docs("vehicles"), q);
      if (treffer.length !== 1) {
        return treffer.length
          ? { hinweis: "Mehrere Fahrzeuge passen – bitte genauer angeben.", fahrzeuge: treffer.map(fahrzeugKurz) }
          : { hinweis: `Kein Fahrzeug zu „${q}“.`, aehnlich: aehnlich.map(fahrzeugKurz) };
      }
      const v = treffer[0];
      const k = fahrzeugKurz(v);
      const kopf = `Fahrzeug ${k.kennzeichen}: ${[k.marke, k.modell].filter(Boolean).join(" ")}${k.vin ? ` · FIN ${k.vin}` : ""}${k.station ? ` · ${k.station}` : ""}`;

      // 1. Fahrzeugdokument „Fahrzeugschein“ (neuestes zuerst)
      const docs = (await src.docs("vehicle_documents"))
        .filter((d) => gehoertZu(v)(d) && !geloescht(d.data) && istFahrzeugschein(d.data))
        .sort((x, y) => (str(y.data.uploadedAt) || y.updated).localeCompare(str(x.data.uploadedAt) || x.updated));
      const kandidaten = [
        ...docs.flatMap((d) => dateiLinks(d.data).map((l) => ({ ...l, quelle: `Dokument ${d.id}` }))),
        // 2. Datei-Felder direkt am Fahrzeug, die nach Fahrzeugschein klingen
        ...dateiLinks(v.data)
          .filter((l) => SCHEIN.test(l.feld))
          .map((l) => ({ ...l, quelle: "Fahrzeugdaten" })),
      ];
      if (!kandidaten.length) {
        return {
          __inhalte: [
            {
              type: "text",
              text: `${kopf}\nIn Codriver ist kein Fahrzeugschein hinterlegt.\nStammdaten: ${JSON.stringify(ohneLinks(v.data), null, 1).slice(0, 20_000)}`,
            },
          ],
        } satisfies Inhalte;
      }
      const inhalte: Record<string, unknown>[] = [{ type: "text", text: kopf }];
      for (const c of kandidaten.slice(0, 2)) {
        try {
          inhalte.push(...(await dateiInhalt(src, c.ref, `Fahrzeugschein aus ${c.quelle}`)));
        } catch (e) {
          inhalte.push({ type: "text", text: `Fahrzeugschein aus ${c.quelle} nicht abrufbar: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
      return { __inhalte: inhalte } satisfies Inhalte;
    },
  },
  {
    name: "codriver_datei",
    title: "Codriver: Fahrzeugdatei abrufen",
    description:
      "Lädt eine Datei zu einem Fahrzeug (z. B. TÜV-Bericht, Gutachten, Mietvertrag) als Bild/PDF. bereich = vehicles, vehicle_documents oder fleet_vehicle_extras; id aus codriver_fahrzeug; feld optional (sonst die erste Datei).",
    inputSchema: {
      type: "object",
      properties: { bereich: { type: "string" }, id: { type: "string" }, feld: { type: "string" } },
      required: ["bereich", "id"],
      additionalProperties: false,
    },
    async run(a, src) {
      const bereich = str(a.bereich);
      if (!["vehicles", "vehicle_documents", "fleet_vehicle_extras"].includes(bereich)) throw new Error("Nur Fahrzeugdateien sind abrufbar.");
      const d = (await src.docs(bereich)).find((x) => x.id === str(a.id));
      if (!d) throw new Error("Eintrag nicht gefunden.");
      const links = dateiLinks(d.data);
      const l = str(a.feld) ? links.find((x) => x.feld === str(a.feld)) : links[0];
      if (!l) return { hinweis: "Dieser Eintrag hat keine Datei.", felder: links.map((x) => x.feld) };
      return { __inhalte: await dateiInhalt(src, l.ref, `${bereich}/${d.id} – ${l.feld}`) } satisfies Inhalte;
    },
  },
  {
    name: "codriver_fahrzeuge",
    title: "Codriver: Fahrzeugliste",
    description:
      "Listet die Fahrzeuge von Arion (Kennzeichen, Modell, Station, Status, Leasing/Miete). Optional gefiltert nach Station (z. B. DBY5) oder Freitext. Ausgemusterte Fahrzeuge nur mit mitAusgemustert=true.",
    inputSchema: {
      type: "object",
      properties: {
        station: { type: "string" },
        text: { type: "string", description: "Freitext, z. B. Modell oder Teil des Kennzeichens" },
        mitAusgemustert: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: LIMIT_MAX },
      },
      additionalProperties: false,
    },
    async run(a, src) {
      const station = str(a.station).toUpperCase();
      const t = norm(str(a.text));
      const alle = (await src.docs("vehicles")).filter((v) => {
        if (!a.mitAusgemustert && (geloescht(v.data) || str(v.data.status) === "DEFLEETED")) return false;
        const k = fahrzeugKurz(v);
        if (station && k.station.toUpperCase() !== station) return false;
        if (t && !norm(JSON.stringify(k)).includes(t)) return false;
        return true;
      });
      const liste = alle.map(fahrzeugKurz).sort((x, y) => x.kennzeichen.localeCompare(y.kennzeichen));
      return { anzahl: liste.length, fahrzeuge: liste.slice(0, limitOf(a.limit, 100)) };
    },
  },
  {
    name: "codriver_fahrer",
    title: "Codriver: Fahrer suchen",
    description:
      "Sucht Fahrer nach Name, Mitarbeiternummer oder Transporter-ID. Ohne Suchbegriff: Liste der aktiven Fahrer. Mit genau einem Treffer kommen alle (redigierten) Stammdaten, Abwesenheiten, Unfallmeldungen und die letzten Scores mit.",
    inputSchema: {
      type: "object",
      properties: {
        suche: { type: "string" },
        mitInaktiven: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: LIMIT_MAX },
      },
      additionalProperties: false,
    },
    async run(a, src, today) {
      const q = norm(str(a.suche));
      const fahrer = (await src.docs("drivers")).filter((f) => !geloescht(f.data));
      const treffer = fahrer.filter((f) => {
        if (!a.mitInaktiven && !q && !fahrerAktiv(f.data, today)) return false;
        if (!q) return true;
        const k = fahrerKurz(f, today);
        return [k.name, k.mitarbeiterNr, k.transporterId, f.id].some((x) => x && norm(x).includes(q));
      });
      if (treffer.length !== 1 || !q) {
        const liste = treffer.map((f) => fahrerKurz(f, today)).sort((x, y) => x.name.localeCompare(y.name));
        return { anzahl: liste.length, fahrer: liste.slice(0, limitOf(a.limit, 100)) };
      }
      const f = treffer[0];
      const k = fahrerKurz(f, today);
      const zu = (d: MirrorDoc) =>
        str(d.data.driverId) === f.id ||
        str(d.data.userId) === f.id ||
        (k.transporterId && str(d.data.transporterId) === k.transporterId) ||
        (k.name && norm(str(d.data.driverName)) === norm(k.name));
      const [abw, unf, scores] = await Promise.all([src.docs("absence_requests"), src.docs("incident_reports"), src.docs("scores")]);
      return {
        ...k,
        daten: ohneLinks(f.data),
        abwesenheiten: abw.filter(zu).map((d) => ({ id: d.id, ...d.data })).slice(0, 30),
        unfallmeldungen: unf.filter(zu).map((d) => ({ id: d.id, ...d.data })).slice(0, 30),
        scores: scores
          .filter(zu)
          .sort((x, y) => y.id.localeCompare(x.id))
          .slice(0, 12)
          .map((d) => ({ id: d.id, ...d.data })),
      };
    },
  },
  {
    name: "codriver_fristen",
    title: "Codriver: ablaufende Fristen",
    description:
      "Fälligkeiten aus Codriver: TÜV/HU und andere Fahrzeugdokumente, Zulassung, Leasing-/Mietende, Vertragsende von Fahrern, ablaufende Führerscheine und Ausweise. Überfällige (bis 60 Tage) und kommende Fristen, früheste zuerst.",
    inputSchema: {
      type: "object",
      properties: {
        tage: { type: "integer", minimum: 1, maximum: 365, description: `Wie weit voraus (Standard ${CODRIVER_TAGE_VORAUS})` },
        bereich: { type: "string", enum: ["fahrzeug", "fahrer"] },
      },
      additionalProperties: false,
    },
    async run(a, src, today) {
      const [vehicles, vehicleDocuments, drivers] = await Promise.all([
        src.docs("vehicles"),
        src.docs("vehicle_documents"),
        src.docs("drivers"),
      ]);
      const tage = Math.max(1, Math.min(365, Number(a.tage) || CODRIVER_TAGE_VORAUS));
      const fristen = codriverFaelligkeiten(
        { vehicles: vehicles.map((v) => v.data), vehicleDocuments: vehicleDocuments.map((v) => v.data), drivers: drivers.map((v) => v.data) },
        today,
        tage
      ).filter((f) => !a.bereich || f.bereich === a.bereich);
      return { stichtag: today, tageVoraus: tage, anzahl: fristen.length, fristen };
    },
  },
  {
    name: "codriver_suche",
    title: "Codriver: Volltextsuche",
    description:
      "Durchsucht alle gespiegelten Codriver-Bereiche (oder nur die angegebenen) nach einem Begriff und liefert die passenden Einträge. Gut für alles, wofür es kein eigenes Werkzeug gibt, z. B. Kalendertermine, Schichtpläne, Berichte.",
    inputSchema: {
      type: "object",
      properties: {
        begriff: { type: "string" },
        bereiche: { type: "array", items: { type: "string" }, description: "Standard: alle gespiegelten Bereiche (siehe codriver_status)" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["begriff"],
      additionalProperties: false,
    },
    async run(a, src) {
      const q = norm(str(a.begriff));
      if (q.length < 2) throw new Error("begriff zu kurz (mindestens 2 Zeichen)");
      const np = normPlate(a.begriff);
      const bereiche = Array.isArray(a.bereiche) && a.bereiche.length ? a.bereiche.map(String) : (await src.stats()).map((x) => x.collection);
      const limit = Math.max(1, Math.min(50, Number(a.limit) || 20));
      const treffer: { bereich: string; id: string; daten: Doc }[] = [];
      for (const b of bereiche) {
        for (const d of await src.docs(b)) {
          const s = JSON.stringify(d.data);
          if (norm(s).includes(q) || (np.length >= 5 && normPlate(s).includes(np))) {
            treffer.push({ bereich: b, id: d.id, daten: ohneLinks(d.data) });
            if (treffer.length >= limit) return { anzahl: treffer.length, abgeschnitten: true, treffer };
          }
        }
      }
      return { anzahl: treffer.length, treffer };
    },
  },
  {
    name: "codriver_liste",
    title: "Codriver: Bereich auflisten",
    description:
      "Gibt Einträge eines Codriver-Bereichs roh (redigiert) zurück, neueste IDs zuerst, mit Blättern über offset. Bereiche siehe codriver_status, z. B. shift_plans, calendar_events, reports, scores.",
    inputSchema: {
      type: "object",
      properties: {
        bereich: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: LIMIT_MAX },
        offset: { type: "integer", minimum: 0 },
      },
      required: ["bereich"],
      additionalProperties: false,
    },
    async run(a, src) {
      const b = str(a.bereich);
      if (!b) throw new Error("bereich fehlt");
      const alle = (await src.docs(b)).sort((x, y) => y.id.localeCompare(x.id));
      const off = Math.max(0, Math.floor(Number(a.offset) || 0));
      const lim = limitOf(a.limit, 50);
      return {
        bereich: b,
        gesamt: alle.length,
        offset: off,
        eintraege: alle.slice(off, off + lim).map((d) => ({ id: d.id, aktualisiert: d.updated, ...ohneLinks(d.data) })),
      };
    },
  },
  {
    name: "codriver_eintrag",
    title: "Codriver: einzelner Eintrag",
    description: "Holt einen Eintrag eines Bereichs über seine ID (aus einem anderen Werkzeug).",
    inputSchema: {
      type: "object",
      properties: { bereich: { type: "string" }, id: { type: "string" } },
      required: ["bereich", "id"],
      additionalProperties: false,
    },
    async run(a, src) {
      const d = (await src.docs(str(a.bereich))).find((x) => x.id === str(a.id));
      if (!d) return { gefunden: false };
      return { gefunden: true, bereich: d.collection, id: d.id, aktualisiert: d.updated, daten: ohneLinks(d.data) };
    },
  },
];

export const MCP_TOOL_NAMES = TOOLS.map((t) => t.name);

/* ── JSON-RPC ────────────────────────────────────────────── */

type RpcReq = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Doc };
type RpcRes = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: RpcReq["id"], result: unknown): RpcRes => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: RpcReq["id"], code: number, message: string): RpcRes => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

const MAX_TEXT = 200_000;

async function handleOne(m: RpcReq, src: MirrorSource, today: string): Promise<RpcRes | null> {
  if (!m || typeof m !== "object" || typeof m.method !== "string") return err(m?.id, -32600, "Invalid Request");
  const isNotification = m.id === undefined || m.id === null;
  const p = obj(m.params);
  switch (m.method) {
    case "initialize": {
      const wanted = str(p.protocolVersion);
      return ok(m.id, {
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(wanted) ? wanted : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          "Codriver-Daten von Arion Logistics (Fahrer, Fahrzeuge, Fahrzeugdokumente, Fristen, Abwesenheiten, Unfallmeldungen, Schichtpläne, Scores). Nur lesend; sensible Felder sind geschwärzt. Bei leeren Ergebnissen zuerst codriver_status prüfen.",
      });
    }
    case "ping":
      return isNotification ? null : ok(m.id, {});
    case "tools/list":
      return ok(m.id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === str(p.name));
      if (!tool) return err(m.id, -32602, `Unbekanntes Werkzeug: ${str(p.name)}`);
      try {
        const out = await tool.run(obj(p.arguments), src, today);
        if (istInhalte(out)) return ok(m.id, { content: out.__inhalte, isError: false });
        let text = JSON.stringify(out, null, 1);
        if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n… (gekürzt – limit/offset oder genauere Suche nutzen)";
        return ok(m.id, { content: [{ type: "text", text }], isError: false });
      } catch (e) {
        return ok(m.id, { content: [{ type: "text", text: `Fehler: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
      }
    }
    case "resources/list":
      return ok(m.id, { resources: [] });
    case "prompts/list":
      return ok(m.id, { prompts: [] });
    default:
      if (m.method.startsWith("notifications/")) return null;
      return isNotification ? null : err(m.id, -32601, `Methode nicht unterstützt: ${m.method}`);
  }
}

/** Verarbeitet eine JSON-RPC-Nachricht oder einen Batch. `null` = nur Benachrichtigungen (HTTP 202). */
export async function handleMcp(body: unknown, src: MirrorSource, today: string): Promise<RpcRes | RpcRes[] | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleOne(m as RpcReq, src, today)))).filter((x): x is RpcRes => x !== null);
    return out.length ? out : null;
  }
  return handleOne(body as RpcReq, src, today);
}
