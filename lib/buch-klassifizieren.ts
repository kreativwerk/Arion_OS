import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { getConfig, nowExpr, type DB } from "@/lib/db";
import { parsePageRanges } from "@/lib/buch-pages";
import { pfadOk, zielFuer, type DokFakten } from "@/lib/beleg-regeln";

/**
 * Automatische Belegablage: neue Einträge im Buchhaltungs-Eingang (Mail-Anhänge,
 * Drucker-Scans) liest Claude, trennt Stapel in einzelne Dokumente und liefert
 * strukturierte Fakten. Zielordner und Dateinamen baut lib/beleg-regeln.ts;
 * daraus entstehen Ablage-Aufträge (buch_ablage), die lib/buch-ablage.ts nach
 * Google Drive hochlädt.
 *
 * Sicherheitsnetz: Unsicheres → Archiv/_Unklar, mutmaßliche Doppel →
 * Archiv/_Duplikate prüfen, Seiten ohne Zuordnung → Archiv/_Unklar. Gelöscht
 * wird nie etwas; Werbung/Logos werden nur als „ignoriert“ markiert.
 */

const MAX_PER_RUN = 4;
/** Ein Eingang wird nur begonnen, wenn noch so viel Budget bleibt (Modellaufruf). */
const ITEM_MIN_MS = 30_000;
const MAX_BYTES_FOR_MODEL = 25 * 1024 * 1024;
const DEFAULT_MODEL = "claude-opus-5-5";

const DOC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "seiten", "firma", "art", "kategorie", "lieferant", "betrag", "belegdatum", "kurzinhalt", "rg_nr",
    "kennzeichen", "fahrzeug_ordner", "person", "objekt", "objekt_ordner", "einnahme", "bar", "sicherheit",
  ],
  properties: {
    seiten: { type: "string", description: "Seiten dieses Dokuments in Lesereihenfolge, 1-basiert, z. B. \"1-3\" oder \"4,6,5\"" },
    firma: { type: "string", enum: ["arion", "wohnwerk", "kreativwerk", "fleetfix", "nicht_arion", "unklar"] },
    art: { type: "string", enum: ["beleg", "gutschrift", "mahnung", "lieferschein", "dokument"] },
    kategorie: {
      type: "string",
      enum: ["fahrzeug", "personal", "vertrag", "versicherung", "behoerde", "firma", "objekt", "kunde", "sonstiges"],
    },
    lieferant: { type: "string", description: "Absender/Lieferant kurz, z. B. \"Aral\", \"Autohaus Pickel\", \"Allianz\"" },
    betrag: { type: "number", description: "Bruttobetrag/Endbetrag in EUR; 0, wenn das Dokument keinen Betrag hat" },
    belegdatum: { type: "string", description: "Rechnungs-/Dokumentdatum YYYY-MM-DD, sonst leer" },
    kurzinhalt: { type: "string", description: "Inhalt in wenigen Wörtern, z. B. \"Inspektion\", \"Kfz-Steuerbescheid\"" },
    rg_nr: { type: "string", description: "Rechnungs-/Belegnummer, sonst leer" },
    kennzeichen: { type: "string", description: "Kfz-Kennzeichen, wenn fahrzeugbezogen, sonst leer" },
    fahrzeug_ordner: {
      type: "string",
      enum: ["", "Zulassung & Fahrzeugschein", "Leasing & Miete", "Versicherung", "Wartung & TÜV", "Schäden & Unfälle", "Bußgelder"],
    },
    person: { type: "string", description: "Mitarbeiter als \"Nachname, Vorname\" (Personalunterlagen) bzw. Kunde (Kreativwerk), sonst leer" },
    objekt: { type: "string", description: "Wohnwerk-Objekt (Adresse), sonst leer" },
    objekt_ordner: { type: "string", enum: ["", "Kauf & Grundbuch", "Mietverträge", "Nebenkosten", "Handwerker & Wartung", "Schriftverkehr"] },
    einnahme: { type: "boolean", description: "true bei Einnahmen (z. B. Mieteinnahme, Erstattung an uns)" },
    bar: { type: "boolean", description: "true, wenn bar bezahlt" },
    sicherheit: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ignorieren", "grund", "dokumente"],
  properties: {
    ignorieren: { type: "boolean", description: "true bei Werbung, Logos, Signaturbildern, AGB ohne Bezug, leeren Seiten" },
    grund: { type: "string" },
    dokumente: { type: "array", items: DOC_SCHEMA },
  },
};

function system(karten: string): string {
  return `Du sortierst eingehende Firmenunterlagen von Albert Dobra. Teile die Datei in einzelne Dokumente (neues Dokument = neuer Briefkopf/neue Rechnung; Anlagen und Folgeseiten gehören zum Dokument davor) und liefere je Dokument nur Fakten. Erfinde nichts.

Firmen (nach Rechnungsempfänger/Adressat):
- arion: Arion Logistics GmbH, Industriestr. 12a, 91325 Adelsdorf (früher Gustav-Weißkopf-Str. 12, 90768 Fürth); auch Fahrzeuge, Fahrer, Mitarbeiter, Behörden-/Krankenkassenpost dazu.
- wohnwerk: Wohnwerk Immobilien eGbR / Wohnwerk GbR, Noethestraße 61, 91058 Erlangen; Objekte z. B. Sankt Michael 27 Erlangen, Dechsendorfer Straße 6 Erlangen.
- kreativwerk: Albert Dobra Web-/Grafikdesign (Kreativwerk, kw-agentur).
- fleetfix: Fleetfix.
- nicht_arion: privat, oder Barzahlung ohne Firmenempfänger.
- unklar: nicht sicher zuzuordnen.
Kassenbons ohne Empfänger gehören nur zu Arion, wenn mit einer Arion-Karte bezahlt (Endziffern ${karten}); bar = nicht_arion.

art: beleg (Rechnung/Quittung/Bon mit Zahlbetrag), gutschrift, mahnung (Zahlungserinnerung/Mahnung/Vollstreckungsankündigung), lieferschein (ohne Endbetrag), dokument (Brief, Bescheid, Vertrag, Police ohne Zahlung).
kategorie: fahrzeug (Kennzeichen/FIN), personal (Mitarbeiter-bezogen: Krankenkasse zu Person, Arbeitsagentur, Kündigung, Pfändung), vertrag, versicherung, behoerde, firma, objekt (Wohnwerk-Immobilie), kunde, sonstiges.
Kennzeichen-Schreibweise: "ERH-AL 339", "M-AZ 6358E", "FÜ-BB 362". Beträge immer am Dokument prüfen (Endbetrag brutto). sicherheit "niedrig", wenn Betrag, Empfänger oder Zuordnung nicht eindeutig lesbar sind.`;
}

type Eingang = { id: number; filename: string; mime: string; subject: string; from_addr: string; account: string };

async function pageCount(data: Buffer, mime: string): Promise<number> {
  if (mime !== "application/pdf") return 1;
  const pdf = await PDFDocument.load(data, { ignoreEncryption: true });
  return pdf.getPageCount();
}

function fileBlock(data: Buffer, mime: string): Anthropic.Beta.BetaContentBlockParam {
  const b64 = data.toString("base64");
  return mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: mime as "image/jpeg" | "image/png", data: b64 } };
}

/** Doppelte Zahlungsbelege erkennen: gleicher Lieferant + Betrag + Monat bereits abgelegt/geplant. */
async function istDuplikat(d: DB, eingangId: number, lieferant: string, betrag: number | null, belegdatum: string) {
  if (betrag == null || !lieferant || !/^\d{4}-\d{2}/.test(belegdatum)) return false;
  const row = await d.get<{ id: number }>(
    `SELECT id FROM buch_ablage WHERE eingang_id <> ? AND lower(lieferant) = lower(?) AND betrag = ? AND monat = ?
       AND status IN ('offen','in_arbeit','erledigt') AND ziel_pfad LIKE 'Ausgaben/%' LIMIT 1`,
    [eingangId, lieferant, betrag, belegdatum.slice(0, 7)]
  );
  return Boolean(row);
}

export type Auftrag = {
  seiten: string;
  ziel_pfad: string;
  dateiname: string;
  lieferant: string;
  betrag: number | null;
  belegdatum: string;
  /** Zahlungsbeleg (für die Doppel-Prüfung) */
  zahlung: boolean;
  /** Zusatzkopie (z. B. Fahrzeugakte) */
  kopie: boolean;
};

/** Aus den Modell-Fakten Ablage-Aufträge bauen (rein, testbar). Seiten ohne
 *  Zuordnung landen gesammelt in Archiv/_Unklar; ungültige Seitenangaben → ganze Datei, unsicher. */
export function planeAuftraege(dokumente: DokFakten[], n: number, filename: string, jetzt = new Date()) {
  const used = new Set<number>();
  const orders: Auftrag[] = [];
  let firma = "";
  for (const f of dokumente) {
    if (!f.betrag && f.art !== "beleg" && f.art !== "gutschrift") f.betrag = null;
    let seiten = f.seiten || "";
    try {
      parsePageRanges(seiten, n).forEach((p) => used.add(p));
    } catch {
      seiten = "";
      f.sicherheit = "niedrig";
      for (let p = 0; p < n; p++) used.add(p);
    }
    if (!firma && f.firma !== "unklar") firma = f.firma;
    const zahlung = (f.art === "beleg" || f.art === "gutschrift") && f.firma !== "unklar" && f.sicherheit !== "niedrig";
    zielFuer(f, jetzt).forEach((z, i) => {
      if (!pfadOk(z.ziel_pfad)) return;
      orders.push({
        seiten,
        ...z,
        lieferant: f.lieferant || "",
        betrag: f.betrag ?? null,
        belegdatum: /^\d{4}-\d{2}-\d{2}$/.test(f.belegdatum) ? f.belegdatum : "",
        zahlung: zahlung && i === 0,
        kopie: i > 0,
      });
    });
  }
  const rest = Array.from({ length: n }, (_, i) => i).filter((p) => !used.has(p));
  if (rest.length) {
    orders.push({
      seiten: rest.map((p) => p + 1).join(","),
      ziel_pfad: "Archiv/_Unklar",
      dateiname: `${(filename || "Datei").replace(/\.[^.]+$/, "")} – nicht zugeordnete Seiten.pdf`,
      lieferant: "",
      betrag: null,
      belegdatum: "",
      zahlung: false,
      kopie: false,
    });
  }
  return { orders, firma };
}

export type KlassifizierResult = { bearbeitet: number; auftraege: number; ignoriert: number; hinweise: string[] };

export async function runKlassifizieren(d: DB, opts: { deadline: number }): Promise<KlassifizierResult> {
  const res: KlassifizierResult = { bearbeitet: 0, auftraege: 0, ignoriert: 0, hinweise: [] };
  if (!process.env.ANTHROPIC_API_KEY) {
    res.hinweise.push("ANTHROPIC_API_KEY fehlt – Belege bleiben im Eingang und werden nicht automatisch abgelegt.");
    return res;
  }
  const cfg = await getConfig();
  if (cfg.beleg_autoablage === "0") return res;
  const karten = cfg.arion_karten || "9138, 9779, 4152, 3753";
  const model = process.env.BELEG_MODEL || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const neu = await d.all<Eingang>(
    "SELECT id, filename, mime, subject, from_addr, account FROM buch_eingang WHERE status = 'neu' ORDER BY id LIMIT ?",
    [MAX_PER_RUN]
  );
  for (const e of neu) {
    if (opts.deadline - Date.now() < ITEM_MIN_MS) break;
    // Beanspruchen (verhindert Doppelbearbeitung paralleler Läufe)
    const claimed = await d.all<{ id: number }>(
      `UPDATE buch_eingang SET status = 'in_pruefung', notiz = 'automatische Ablage läuft', updated_at = ${nowExpr(d)}
       WHERE id = ? AND status = 'neu' RETURNING id`,
      [e.id]
    );
    if (!claimed.length) continue;
    try {
      const blob = await d.get<{ data: Buffer | Uint8Array }>("SELECT data FROM buch_eingang_blobs WHERE eingang_id = ?", [e.id]);
      if (!blob) throw new Error("Datei fehlt im Eingang");
      const data = Buffer.from(blob.data);
      if (data.length > MAX_BYTES_FOR_MODEL) throw new Error("Datei zu groß für die automatische Erkennung");
      if (!/^(application\/pdf|image\/(jpeg|png))$/.test(e.mime)) throw new Error(`Dateityp ${e.mime} wird nicht automatisch erkannt`);
      const n = await pageCount(data, e.mime);

      const response = await new Anthropic().beta.messages.create({
        model,
        ...(model === DEFAULT_MODEL ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        max_tokens: 8000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        system: system(karten),
        messages: [
          {
            role: "user",
            content: [
              fileBlock(data, e.mime),
              {
                type: "text",
                text: `Datei „${e.filename}“ (${n} Seite${n === 1 ? "" : "n"}) aus ${e.account || "Upload"}, Mail von ${e.from_addr || "-"}, Betreff „${e.subject || "-"}“.`,
              },
            ],
          },
        ],
      });
      if (response.stop_reason === "refusal") throw new Error("vom Modell abgelehnt");
      const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const out = JSON.parse(text) as { ignorieren: boolean; grund: string; dokumente: DokFakten[] };

      if (out.ignorieren || !out.dokumente.length) {
        await d.run(`UPDATE buch_eingang SET status = 'ignoriert', notiz = ?, updated_at = ${nowExpr(d)} WHERE id = ?`, [
          `automatisch: ${out.grund || "kein Beleg"}`.slice(0, 500),
          e.id,
        ]);
        res.ignoriert++;
        res.bearbeitet++;
        continue;
      }

      const plan = planeAuftraege(out.dokumente, n, e.filename);
      const orders: Auftrag[] = [];
      let letzteDoppelt = false;
      for (const o of plan.orders) {
        if (o.kopie) {
          if (!letzteDoppelt) orders.push(o); // Kopie (Fahrzeugakte) nur, wenn der Beleg selbst neu ist
          continue;
        }
        letzteDoppelt = o.zahlung && (await istDuplikat(d, e.id, o.lieferant, o.betrag, o.belegdatum));
        orders.push(letzteDoppelt ? { ...o, ziel_pfad: "Archiv/_Duplikate prüfen" } : o);
      }
      const firma = plan.firma;
      for (const o of orders) {
        await d.run(
          "INSERT INTO buch_ablage (eingang_id, seiten, ziel_pfad, dateiname, lieferant, betrag, belegdatum, monat) VALUES (?,?,?,?,?,?,?,?)",
          [e.id, o.seiten, o.ziel_pfad, o.dateiname, o.lieferant, o.betrag, o.belegdatum || null, o.belegdatum ? o.belegdatum.slice(0, 7) : null]
        );
      }
      await d.run(`UPDATE buch_eingang SET firma = ?, notiz = ?, updated_at = ${nowExpr(d)} WHERE id = ?`, [
        firma || null,
        `automatisch: ${orders.map((o) => (o.seiten ? `S. ${o.seiten} ` : "") + o.dateiname).join(" · ")}`.slice(0, 1000),
        e.id,
      ]);
      res.auftraege += orders.length;
      res.bearbeitet++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Zurück auf „neu“ nur bei vorübergehenden Fehlern (Netz/Überlast); sonst zur Handprüfung stehen lassen
      const temporaer = /timeout|overloaded|529|rate|ECONN|fetch failed/i.test(msg);
      await d.run(`UPDATE buch_eingang SET status = ?, notiz = ?, updated_at = ${nowExpr(d)} WHERE id = ?`, [
        temporaer ? "neu" : "in_pruefung",
        `automatische Ablage fehlgeschlagen: ${msg}`.slice(0, 500),
        e.id,
      ]);
      res.hinweise.push(`${e.filename}: ${msg}`);
    }
  }
  return res;
}
