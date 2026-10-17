import { runMailFetch, type MailFetchResult } from "@/lib/mail-fetch";
import { runAblage, type AblageResult } from "@/lib/buch-ablage";

/** Gesamtbudget eines Laufs – bleibt unter Vercels 60-s-Limit (maxDuration). */
const RUN_BUDGET_MS = 52_000;
const MAIL_BUDGET_MS = 32_000;

export type BuchRunResult = { mail: MailFetchResult; ablage: AblageResult; dauer_ms: number };

/** Ein Buchhaltungs-Lauf: Postfächer abrufen (inkl. Belege) und danach offene
 *  Ablage-Aufträge nach Google Drive ausführen. Genutzt von Cron und „Jetzt abrufen“. */
export async function runBuchhaltung(opts: { push?: boolean } = {}): Promise<BuchRunResult> {
  const start = Date.now();
  const mail = await runMailFetch({ deadline: start + MAIL_BUDGET_MS, push: opts.push });
  const ablage = await runAblage({ deadline: start + RUN_BUDGET_MS });
  return { mail, ablage, dauer_ms: Date.now() - start };
}
