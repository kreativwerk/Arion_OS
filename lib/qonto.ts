/**
 * Qonto Business API (nur lesend) für den Belegabgleich.
 *
 * Env (in Vercel, von Albert gesetzt – nie im Code):
 *   QONTO_LOGIN        Organisations-Login (Qonto → Einstellungen → Integrationen → API-Schlüssel)
 *   QONTO_SECRET_KEY   geheimer Schlüssel dazu
 *   QONTO_IBAN         optional: welches Konto (sonst das Hauptkonto)
 */

const BASE = "https://thirdparty.qonto.com/v2";

export function qontoConfigured(): boolean {
  return Boolean(process.env.QONTO_LOGIN && process.env.QONTO_SECRET_KEY);
}

export type QontoTx = {
  id: string;
  amount: number;
  side: "credit" | "debit";
  operation_type: string;
  label: string;
  settled_at: string | null;
  emitted_at: string;
  status: string;
  note: string | null;
  reference: string | null;
  attachment_ids: string[];
  cashflow_category: { name?: string } | null;
  transfer?: { reference?: string | null } | null;
};

async function qonto<T>(path: string, deadline: number): Promise<T> {
  const left = Math.max(2_000, Math.min(20_000, deadline - Date.now()));
  const res = await fetch(`${BASE}${path}`, {
    headers: { authorization: `${process.env.QONTO_LOGIN}:${process.env.QONTO_SECRET_KEY}`, accept: "application/json" },
    signal: AbortSignal.timeout(left),
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Qonto ${res.status}: ${t.slice(0, 160) || res.statusText}`);
  }
  return (await res.json()) as T;
}

async function bankAccountId(deadline: number): Promise<string> {
  const org = await qonto<{ organization: { bank_accounts: { id: string; iban: string; main?: boolean; status?: string }[] } }>(
    "/organization",
    deadline
  );
  const accs = org.organization.bank_accounts ?? [];
  const iban = (process.env.QONTO_IBAN ?? "").replace(/\s/g, "").toUpperCase();
  const acc = (iban && accs.find((a) => a.iban.replace(/\s/g, "").toUpperCase() === iban)) || accs.find((a) => a.main) || accs[0];
  if (!acc) throw new Error("Qonto: kein Konto gefunden.");
  return acc.id;
}

/** Alle abgeschlossenen Abbuchungen eines Monats (YYYY-MM). */
export async function qontoAbbuchungen(monat: string, deadline: number): Promise<QontoTx[]> {
  const id = await bankAccountId(deadline);
  const [j, m] = monat.split("-").map(Number);
  const von = new Date(Date.UTC(j!, m! - 1, 1)).toISOString();
  const bis = new Date(Date.UTC(j!, m!, 1) - 1).toISOString();
  const out: QontoTx[] = [];
  for (let page = 1; page <= 20; page++) {
    const params = new URLSearchParams({
      bank_account_id: id,
      side: "debit",
      settled_at_from: von,
      settled_at_to: bis,
      per_page: "100",
      page: String(page),
    });
    params.append("status[]", "completed");
    const data = await qonto<{ transactions: QontoTx[]; meta?: { next_page?: number | null } }>(`/transactions?${params}`, deadline);
    out.push(...(data.transactions ?? []));
    if (!data.meta?.next_page) break;
  }
  return out;
}
