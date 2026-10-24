import Anthropic from "@anthropic-ai/sdk";
import type { DB } from "@/lib/db";
import { driveConfigured, listFilesUnder, resolveFolderPath, uploadFile, type DriveTreeFile } from "@/lib/google-drive";
import { dateiname1590, monatAusPfad, monatsOrdner, ordneZu, schluessel1590, type Zeile1590 } from "@/lib/abgleich-regeln";

/**
 * Konto 1590 („Durchlaufende Posten“): Das Steuerbüro schickt eine Liste der
 * Buchungen ohne Beleg. Albert lädt sie hoch (PDF/Foto) → Claude liest die Zeilen →
 * buch_1590. „Abgleichen“ sucht passende Belege im Drive (1590-Ordner und
 * Monatsordner), pro Zeile kann ein Beleg hochgeladen werden (→ Drive
 * „1590/<Jahr>/Belege“). Status: offen | gefunden | erledigt.
 */

const DEFAULT_MODEL = "claude-opus-5-5";
export const MAX_1590_BYTES = 4 * 1024 * 1024;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["jahr", "zeilen"],
  properties: {
    jahr: { type: "string", description: "Wirtschaftsjahr der Liste, z. B. 2026" },
    zeilen: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["datum", "text", "betrag", "belegnr"],
        properties: {
          datum: { type: "string", description: "YYYY-MM-DD" },
          text: { type: "string", description: "Buchungstext genau wie in der Liste" },
          betrag: { type: "number", description: "Betrag in Euro, immer positiv" },
          belegnr: { type: "string", description: "Belegfeld 1 (Rechnungsnummer) oder leer" },
        },
      },
    },
  },
} as const;

export type ListeResult = { jahr: string; liste: string; zeilen: number; neu: number; uebernommen: number; nicht_mehr: number };

/** Liste lesen und speichern. Status bekannter Zeilen bleibt erhalten. */
export async function importiere1590(d: DB, data: Buffer, mime: string, name: string): Promise<ListeResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY fehlt – die Liste kann nicht gelesen werden.");
  if (!/^(application\/pdf|image\/(jpeg|png))$/.test(mime)) throw new Error("Bitte die Liste als PDF oder Foto (JPG/PNG) hochladen.");
  const model = process.env.BELEG_MODEL || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const b64 = data.toString("base64");
  const block: Anthropic.Beta.BetaContentBlockParam =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: mime as "image/jpeg" | "image/png", data: b64 } };

  const response = await new Anthropic().beta.messages.create({
    model,
    ...(model === DEFAULT_MODEL ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    max_tokens: 16000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system:
      "Du liest eine Kontenliste (DATEV „Jahreskonto“) des Kontos 1590 aus. Gib JEDE Buchungszeile genau einmal zurück, " +
      "auch doppelte Zeilen mit gleichem Betrag. Datum als YYYY-MM-DD, Betrag positiv in Euro, Buchungstext wörtlich, " +
      "Belegfeld 1 als belegnr (sonst leer). Summen-, Saldo- und Kopfzeilen weglassen.",
    messages: [{ role: "user", content: [block, { type: "text", text: `Datei „${name}“.` }] }],
  });
  if (response.stop_reason === "refusal") throw new Error("Die Liste konnte nicht gelesen werden.");
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const out = JSON.parse(text) as { jahr: string; zeilen: Zeile1590[] };
  const zeilen = out.zeilen.filter((z) => /^\d{4}-\d{2}-\d{2}$/.test(z.datum) && Number(z.betrag) > 0);
  if (!zeilen.length) throw new Error("In der Datei wurden keine Buchungszeilen gefunden.");
  const jahr = /^\d{4}$/.test(out.jahr) ? out.jahr : zeilen[0]!.datum.slice(0, 4);
  const liste = name.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 120);
  const keys = schluessel1590(zeilen);

  const alt = await d.all<{ id: number; schluessel: string; status: string }>("SELECT id, schluessel, status FROM buch_1590 WHERE jahr = ?", [jahr]);
  const altMap = new Map(alt.map((r) => [r.schluessel, r]));
  const now = new Date().toISOString();
  const res: ListeResult = { jahr, liste, zeilen: zeilen.length, neu: 0, uebernommen: 0, nicht_mehr: 0 };
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i]!;
    const key = keys[i]!;
    const vorhanden = altMap.get(key);
    if (vorhanden) {
      await d.run("UPDATE buch_1590 SET liste = ?, text = ?, updated_at = ? WHERE id = ?", [liste, z.text.slice(0, 300), now, vorhanden.id]);
      altMap.delete(key);
      res.uebernommen++;
    } else {
      await d.insert(
        "INSERT INTO buch_1590 (jahr, liste, schluessel, datum, text, betrag, belegnr, status) VALUES (?,?,?,?,?,?,?,'offen')",
        [jahr, liste, key, z.datum, z.text.slice(0, 300), Math.round(Number(z.betrag) * 100) / 100, (z.belegnr || "").slice(0, 60)]
      );
      res.neu++;
    }
  }
  // Zeilen, die auf der neuen Liste fehlen, hat das Steuerbüro erledigt
  for (const r of altMap.values()) {
    if (r.status === "erledigt") continue;
    await d.run("UPDATE buch_1590 SET status = 'erledigt', notiz = ?, updated_at = ? WHERE id = ?", [
      `nicht mehr auf Liste „${liste}“`,
      now,
      r.id,
    ]);
    res.nicht_mehr++;
  }
  return res;
}

type Posten1590 = { id: number; datum: string; text: string; betrag: number; belegnr: string; status: string };

export type Abgleich1590Result = { jahr: string; geprueft: number; gefunden: number; offen: number; hinweise: string[] };

/** Belege für offene Zeilen im Drive suchen (1590-Ordner zuerst, dann Monatsordner). */
export async function abgleich1590(d: DB, jahr: string, deadline: number): Promise<Abgleich1590Result> {
  const res: Abgleich1590Result = { jahr, geprueft: 0, gefunden: 0, offen: 0, hinweise: [] };
  if (!(await driveConfigured())) {
    res.hinweise.push("Google Drive ist nicht verbunden.");
    return res;
  }
  const offen = await d.all<Posten1590>("SELECT id, datum, text, betrag, belegnr, status FROM buch_1590 WHERE jahr = ? AND status = 'offen'", [jahr]);
  res.geprueft = offen.length;
  if (offen.length) {
    const monate = [...new Set(offen.map((p) => (p.datum ?? "").slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort();
    const pfade = [`1590/${jahr}`, ...monate.map(monatsOrdner)];
    const dateien: DriveTreeFile[] = [];
    for (const p of pfade) {
      if (deadline - Date.now() < 5_000) {
        res.hinweise.push("Zeit knapp – nicht alle Monatsordner durchsucht, bitte noch einmal abgleichen.");
        break;
      }
      dateien.push(...(await listFilesUnder(p, 3, { deadline })));
    }
    const vergeben = new Set(
      (await d.all<{ datei: string }>("SELECT datei FROM buch_1590 WHERE datei <> '' AND status <> 'offen'")).map((r) => r.datei)
    );
    const pool = dateien
      .filter((f) => !vergeben.has(`${f.pfad}/${f.name}`) && !/\.(txt|json)$/i.test(f.name))
      .map((f) => ({ name: f.name, url: f.url, pfad: f.pfad }));
    const treffer = ordneZu(
      offen.map((p) => ({ key: p.id, betrag: Number(p.betrag), text: p.text, belegnr: p.belegnr, monat: (p.datum ?? "").slice(0, 7) })),
      pool,
      (f) => (f.pfad.startsWith("1590/") ? null : monatAusPfad(f.pfad))
    );
    const now = new Date().toISOString();
    for (const p of offen) {
      const t = treffer.get(p.id);
      if (!t) continue;
      await d.run("UPDATE buch_1590 SET status = 'gefunden', datei = ?, datei_url = ?, updated_at = ? WHERE id = ?", [
        `${t.pfad}/${t.name}`,
        t.url,
        now,
        p.id,
      ]);
      res.gefunden++;
    }
  }
  const o = await d.get<{ n: number }>("SELECT COUNT(*) AS n FROM buch_1590 WHERE jahr = ? AND status = 'offen'", [jahr]);
  res.offen = Number(o?.n ?? 0);
  return res;
}

/** Beleg zu einer Zeile hochladen → Drive „1590/<Jahr>/Belege“, Zeile wird „gefunden“. */
export async function belegHochladen1590(d: DB, id: number, data: Buffer, mime: string, origName: string) {
  const p = await d.get<Posten1590 & { jahr: string }>("SELECT id, jahr, datum, text, betrag, belegnr, status FROM buch_1590 WHERE id = ?", [id]);
  if (!p) throw new Error("Zeile nicht gefunden.");
  if (!(await driveConfigured())) throw new Error("Google Drive ist nicht verbunden.");
  const ext = (origName.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? (mime === "application/pdf" ? "pdf" : "jpg")).toLowerCase();
  const pfad = `1590/${p.jahr}/Belege`;
  const folder = await resolveFolderPath(pfad, true);
  if (!folder) throw new Error("Ordner im Drive konnte nicht angelegt werden.");
  const up = await uploadFile(folder, dateiname1590(p.text, Number(p.betrag), p.belegnr ?? "", ext), new Uint8Array(data), mime);
  await d.run("UPDATE buch_1590 SET status = 'gefunden', datei = ?, datei_url = ?, updated_at = ? WHERE id = ?", [
    `${pfad}/${up.name}`,
    up.url,
    new Date().toISOString(),
    id,
  ]);
  return up;
}

/** Übersicht für /buchhaltung: Jahre, Zähler, Zeilen des gewählten Jahres. */
export async function overview1590(d: DB, jahrParam: string | null) {
  const jahre = (await d.all<{ jahr: string }>("SELECT DISTINCT jahr FROM buch_1590 ORDER BY jahr DESC")).map((r) => r.jahr);
  const jahr = jahrParam && jahre.includes(jahrParam) ? jahrParam : jahre[0] ?? null;
  if (!jahr) return { jahr: null, jahre, liste: "", zaehler: { offen: 0, gefunden: 0, erledigt: 0, offen_summe: 0 }, posten: [] };
  const posten = await d.all<Record<string, unknown>>(
    "SELECT id, datum, text, betrag, belegnr, status, datei, datei_url, notiz, liste FROM buch_1590 WHERE jahr = ? ORDER BY datum ASC, id ASC",
    [jahr]
  );
  const z = { offen: 0, gefunden: 0, erledigt: 0, offen_summe: 0 };
  for (const p of posten) {
    const s = String(p.status) as "offen" | "gefunden" | "erledigt";
    if (s in z) z[s]++;
    if (s === "offen") z.offen_summe += Number(p.betrag) || 0;
  }
  z.offen_summe = Math.round(z.offen_summe * 100) / 100;
  const liste = String(posten.find((p) => p.status !== "erledigt")?.liste ?? posten[0]?.liste ?? "");
  return { jahr, jahre, liste, zaehler: z, posten: posten.map((p) => ({ ...p, betrag: Number(p.betrag) })) };
}
