import { getDb } from "@/lib/db";
import { runMailFetch, type MailFetchResult } from "@/lib/mail-fetch";
import { runAblage, type AblageResult } from "@/lib/buch-ablage";
import { withLock } from "@/lib/run-lock";
import { runKlassifizieren, type KlassifizierResult } from "@/lib/buch-klassifizieren";

/** Gesamtbudget eines Laufs – bleibt unter Vercels 60-s-Limit (maxDuration). */
const RUN_BUDGET_MS = 55_000;
const MAIL_BUDGET_MS = 30_000;

export type BuchRunResult =
  | { mail?: MailFetchResult; einsortiert?: KlassifizierResult; ablage: AblageResult; dauer_ms: number }
  | { skipped: string };

/** Ein Buchhaltungs-Lauf: Postfächer abrufen (inkl. Belege) und danach offene
 *  Ablage-Aufträge nach Google Drive ausführen. Genutzt von Cron und „Jetzt abrufen“.
 *  Parallele Läufe (Cron + Button) werden per Sperre verhindert. */
export async function runBuchhaltung(opts: { push?: boolean } = {}): Promise<BuchRunResult> {
  const start = Date.now();
  const d = await getDb();
  const result = await withLock(d, "buchhaltung", async () => {
    const mail = await runMailFetch({ deadline: start + MAIL_BUDGET_MS, push: opts.push });
    const ablage = await runAblage({ deadline: start + RUN_BUDGET_MS });
    return { mail, ablage, dauer_ms: Date.now() - start };
  });
  return result ?? { skipped: "läuft bereits" };
}

/** Belege einsortieren: neue Eingänge von Claude lesen lassen (Ablage-Aufträge
 *  anlegen) und danach nach Google Drive ablegen. Eigener Lauf, weil das Lesen
 *  eines Belegs bis zu ~30 s dauert und neben dem Mail-Abruf nicht ins
 *  60-s-Limit passt. Auslöser: Cron `/api/cron/buchhaltung?modus=belege` und
 *  der Button „Einsortieren“ auf /buchhaltung. */
export async function runBelegeEinsortieren(): Promise<BuchRunResult> {
  const start = Date.now();
  const d = await getDb();
  const result = await withLock(d, "buchhaltung", async () => {
    const einsortiert = await runKlassifizieren(d, { deadline: start + 42_000 });
    const ablage = await runAblage({ deadline: start + RUN_BUDGET_MS });
    return { einsortiert, ablage, dauer_ms: Date.now() - start };
  });
  return result ?? { skipped: "läuft bereits" };
}
