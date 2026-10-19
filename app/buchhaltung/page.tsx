"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, PageHeader, Button, EmptyState, Row, Badge, Icon, ErrorNote, Segmented } from "@/components/ui";
import { fmtDate, todayIso } from "@/lib/client";

type Fehlt = { id: number; datum: string | null; empfaenger: string; zweck: string; betrag: number; hinweis: string };
type Eingang = {
  id: number;
  quelle: string;
  account: string;
  from_addr: string;
  subject: string;
  received_at: string | null;
  filename: string;
  mime: string;
  size: number;
  status: string;
  firma: string | null;
  notiz: string;
  auftraege: number;
};
type Ablage = {
  id: number;
  eingang_id: number;
  ziel_pfad: string;
  dateiname: string;
  lieferant: string;
  betrag: number | null;
  monat: string | null;
  status: string;
  drive_url: string;
  fehler: string;
  created_at: string;
  done_at: string | null;
};
type Frist = { id: number; titel: string; faellig: string | null; betrag: number | null; art: string; notiz: string };
type Mail = { id: number; account: string; from_addr: string; subject: string; summary: string; received_at: string; read: number };

type Overview = {
  monat: string;
  monate: string[];
  drive_verbunden: boolean;
  zusammenfassung: {
    anzahl: number;
    summe: number;
    kategorien: { kategorie: string; anzahl: number; summe: number }[];
    fehlt: Fehlt[];
    fehlt_anzahl: number;
    fehlt_summe: number;
    belegt_prozent: number | null;
  };
  eingang: Eingang[];
  ablage: Ablage[];
  fristen: Frist[];
  kennzahlen: Record<string, { value: string; updated_at: string }>;
  mails: Mail[];
  zaehler: { eingang_neu: number; ablage_offen: number; ablage_fehler: number };
};

type RunResult =
  | {
      mail: { configured: boolean; neu: number; wichtig: number; belege: number; hinweise: string[] };
      ablage: { configured: boolean; erledigt: number; fehler: number; offen: number; hinweise: string[] };
      skipped?: undefined;
    }
  | { skipped: string };

type BackfillResult =
  | {
      fertig: boolean;
      belege_neu: number;
      belege_gesamt: number;
      konten: { label: string; verarbeitet: number; gesamt: number; fertig: boolean }[];
      hinweise: string[];
      skipped?: undefined;
    }
  | { skipped: string };

/** Vercel liefert höchstens ~4,5 MB pro Antwort – größere Belege nur über Drive. */
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

const eur = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "good" | "warn" | "bad" }> = {
  neu: { label: "Neu", tone: "accent" },
  in_pruefung: { label: "In Prüfung", tone: "warn" },
  abgelegt: { label: "Abgelegt", tone: "good" },
  ignoriert: { label: "Ignoriert", tone: "neutral" },
  fehler: { label: "Fehler", tone: "bad" },
  offen: { label: "Wartet", tone: "neutral" },
  in_arbeit: { label: "Läuft", tone: "warn" },
  erledigt: { label: "Abgelegt", tone: "good" },
};

const FIRMA: Record<string, string> = { arion: "Arion", kreativwerk: "Kreativwerk", fleetfix: "Fleetfix" };

const ART: Record<string, string> = { ust: "USt", lohnsteuer: "Lohnsteuer", bg: "BG", sonstiges: "Sonstiges" };

function daysUntil(iso: string): number {
  const a = new Date(`${todayIso()}T12:00:00`).getTime();
  const b = new Date(`${iso.slice(0, 10)}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function fmtSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

async function fetchOverview(m: string | null): Promise<{ data?: Overview; error?: string }> {
  try {
    const res = await fetch(`/api/buchhaltung/overview${m ? `?monat=${m}` : ""}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: body?.error ?? `Server-Fehler ${res.status}` };
    return { data: body as Overview };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export default function BuchhaltungPage() {
  const [monat, setMonat] = useState<string | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [filter, setFilter] = useState<"offen" | "alle">("offen");

  const apply = useCallback((r: { data?: Overview; error?: string }) => {
    if (r.data) setData(r.data);
    setError(r.error ?? "");
  }, []);
  const load = useCallback(async (m: string | null) => apply(await fetchOverview(m)), [apply]);

  useEffect(() => {
    let cancelled = false;
    fetchOverview(monat).then((r) => {
      if (!cancelled) apply(r);
    });
    return () => {
      cancelled = true;
    };
  }, [apply, monat]);

  const runNow = async () => {
    if (running) return;
    setRunning(true);
    setResult(null);
    setError("");
    try {
      const res = await fetch("/api/buchhaltung/abrufen", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Server-Fehler ${res.status}`);
      setResult(body as RunResult);
      await load(monat);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  // Einmaliges Nachholen der Anhänge der letzten 30 Tage – ruft den Endpunkt in Etappen auf
  const [backfill, setBackfill] = useState<{ running: boolean; text: string; hints: string[] } | null>(null);
  const runBackfill = async () => {
    if (backfill?.running) return;
    setBackfill({ running: true, text: "Starte …", hints: [] });
    let neustart = true;
    let stalled = 0;
    let last = -1;
    try {
      for (let round = 0; round < 40; round++) {
        const res = await fetch(`/api/buchhaltung/nachholen?tage=30${neustart ? "&neustart=1" : ""}`, { method: "POST" });
        neustart = false;
        const body = (await res.json().catch(() => null)) as BackfillResult | { error?: string } | null;
        if (!res.ok || !body || "error" in body) throw new Error((body as { error?: string })?.error ?? `Server-Fehler ${res.status}`);
        if ("skipped" in body && body.skipped) {
          setBackfill({ running: false, text: `Nachholen ${body.skipped}.`, hints: [] });
          return;
        }
        const r = body as Exclude<BackfillResult, { skipped: string }>;
        const done = r.konten.reduce((a, k) => a + k.verarbeitet, 0);
        const total = r.konten.reduce((a, k) => a + k.gesamt, 0);
        setBackfill({
          running: !r.fertig,
          text: `${r.fertig ? "Fertig" : "Läuft"}: ${done} von ${total} Mails geprüft · ${r.belege_gesamt} ${r.belege_gesamt === 1 ? "Beleg" : "Belege"} nachgeholt`,
          hints: r.hinweise,
        });
        if (r.fertig) break;
        stalled = done === last ? stalled + 1 : 0;
        last = done;
        if (stalled >= 2) {
          setBackfill((b) => (b ? { ...b, running: false, text: `${b.text} – angehalten (kein Fortschritt, siehe Hinweise)` } : b));
          break;
        }
      }
      await load(monat);
    } catch (e) {
      setBackfill({ running: false, text: e instanceof Error ? e.message : String(e), hints: [] });
    }
  };

  const setEingangStatus = async (id: number, status: "neu" | "ignoriert") => {
    const res = await fetch(`/api/buchhaltung/eingang/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? `Server-Fehler ${res.status}`);
      return;
    }
    await load(monat);
  };

  const retryAblage = async (id: number) => {
    const res = await fetch(`/api/buchhaltung/ablage/${id}`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? `Server-Fehler ${res.status}`);
      return;
    }
    await load(monat);
  };

  const markPaid = async (id: number) => {
    const res = await fetch("/api/data/buch_fristen", { method: "PATCH", body: JSON.stringify({ id, status: "bezahlt" }) });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? `Server-Fehler ${res.status}`);
      return;
    }
    await load(monat);
  };

  const header = (
    <PageHeader
      title="Buchhaltung"
      subtitle="Belege, Bank-Abgleich und Fristen – läuft automatisch im Hintergrund"
      action={
        <Button onClick={runNow} disabled={running} className="shrink-0 whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="sync" size={16} className={running ? "animate-spin" : ""} />
            {running ? "Rufe ab …" : "Abrufen"}
          </span>
        </Button>
      }
    />
  );

  if (!data) {
    return (
      <div>
        {header}
        <ErrorNote error={error} />
        {!error && <p className="text-ink-3 text-[13px]">Lade …</p>}
      </div>
    );
  }

  const z = data.zusammenfassung;
  const idx = data.monate.indexOf(data.monat);
  const older = idx >= 0 && idx < data.monate.length - 1 ? data.monate[idx + 1] : null;
  const newer = idx > 0 ? data.monate[idx - 1] : null;
  const saldo = data.kennzahlen.qonto_saldo;
  const saldoStand = data.kennzahlen.qonto_stand?.value || saldo?.updated_at;
  const eingang = filter === "offen" ? data.eingang.filter((e) => ["neu", "in_pruefung", "fehler"].includes(e.status)) : data.eingang;

  const tiles = [
    { icon: "payments", label: "Ausgaben gesamt", value: eur(z.summe), meta: `${z.anzahl} ${z.anzahl === 1 ? "Buchung" : "Buchungen"}`, active: z.anzahl > 0 },
    {
      icon: "task_alt",
      label: "Belegt",
      value: z.belegt_prozent === null ? "–" : `${z.belegt_prozent.toLocaleString("de-DE")} %`,
      meta: "nach Betrag",
      active: z.belegt_prozent !== null,
    },
    {
      icon: "receipt_long",
      label: "Fehlende Belege",
      value: String(z.fehlt_anzahl),
      meta: eur(z.fehlt_summe),
      active: z.fehlt_anzahl > 0,
    },
    {
      icon: "account_balance",
      label: "Qonto-Saldo",
      value: saldo ? eur(Number(saldo.value)) : "–",
      meta: saldoStand ? `Stand ${fmtDate(saldoStand)}` : "noch kein Stand",
      active: Boolean(saldo),
    },
  ];

  return (
    <div>
      {header}
      <ErrorNote error={error} />

      {result && "skipped" in result && result.skipped && (
        <div className="bg-inset border border-line rounded-[12px] px-4 py-3 mb-4 text-[13px] text-ink-2">
          Ein Abruf läuft bereits – bitte gleich noch einmal laden.
        </div>
      )}
      {result && "mail" in result && (
        <div className="bg-accent-soft border border-accent/25 rounded-[12px] px-4 py-3 mb-4 text-[13px]">
          <p>
            <span className="font-semibold text-accent">Abruf fertig:</span> {result.mail.neu}{" "}
            {result.mail.neu === 1 ? "neue Mail" : "neue Mails"} · {result.mail.belege ?? 0}{" "}
            {result.mail.belege === 1 ? "neuer Beleg" : "neue Belege"} · {result.ablage.erledigt} abgelegt
            {result.ablage.fehler > 0 ? ` · ${result.ablage.fehler} Fehler` : ""}
          </p>
          {[...result.mail.hinweise, ...result.ablage.hinweise].map((h, i) => (
            <p key={i} className="text-[12px] text-ink-2 mt-1.5 break-words">
              {h}
            </p>
          ))}
        </div>
      )}

      {/* Monatswahl */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="inline-flex items-center bg-inset border border-line rounded-full p-0.5">
          <button
            onClick={() => older && setMonat(older)}
            disabled={!older}
            aria-label="Vorheriger Monat"
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-2 hover:text-ink disabled:opacity-30 transition-all"
          >
            <Icon name="chevron_left" size={20} />
          </button>
          <span className="px-2 text-[13px] font-semibold min-w-[132px] text-center">{monthLabel(data.monat)}</span>
          <button
            onClick={() => newer && setMonat(newer)}
            disabled={!newer}
            aria-label="Nächster Monat"
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-2 hover:text-ink disabled:opacity-30 transition-all"
          >
            <Icon name="chevron_right" size={20} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
          {data.zaehler.ablage_offen > 0 && <Badge>{data.zaehler.ablage_offen} in Ablage</Badge>}
          {data.zaehler.ablage_fehler > 0 && <Badge tone="bad">{data.zaehler.ablage_fehler} Fehler</Badge>}
        </div>
      </div>

      {/* Kennzahlen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-5">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={`bg-card border border-line rounded-card px-4 py-3.5 min-w-0 ${t.active ? "" : "opacity-60"}`}
          >
            <div className="flex items-center gap-2 text-[12px] text-ink-2">
              <span className="w-7 h-7 rounded-[11px] bg-accent-soft flex items-center justify-center shrink-0">
                <Icon name={t.icon} size={16} className={t.active ? "text-accent" : "text-ink-3"} />
              </span>
              <span className="truncate">{t.label}</span>
            </div>
            <div className={`text-[22px] font-bold tracking-tight mt-2 truncate ${t.active ? "" : "text-ink-3"}`}>{t.value}</div>
            <div className="text-[11px] text-ink-3 mt-0.5 truncate">{t.meta}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          {/* Fehlende Belege */}
          <Card>
            <CardHeader
              title="Fehlende Belege"
              subtitle={
                z.fehlt_anzahl > 0
                  ? `${z.fehlt_anzahl} ${z.fehlt_anzahl === 1 ? "Abbuchung" : "Abbuchungen"} ohne Beleg · ${eur(z.fehlt_summe)}`
                  : monthLabel(data.monat)
              }
            />
            {z.anzahl === 0 && <EmptyState text="Für diesen Monat liegt noch kein Bank-Abgleich vor." />}
            {z.anzahl > 0 && z.fehlt.length === 0 && <EmptyState text="Alles belegt – keine offenen Abbuchungen." />}
            {/* Mobil: Liste, ab sm: Tabelle */}
            {z.fehlt.length > 0 && (
              <div className="sm:hidden">
                {z.fehlt.map((f) => (
                  <Row key={f.id} className="items-start">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium [overflow-wrap:anywhere]">{f.empfaenger || "–"}</div>
                      <div className="text-[12px] text-ink-2 mt-0.5 line-clamp-2 [overflow-wrap:anywhere]">{f.zweck}</div>
                      {f.hinweis && <div className="text-[11px] text-warn mt-0.5">{f.hinweis}</div>}
                      <div className="text-[11px] text-ink-3 mt-0.5">{fmtDate(f.datum)}</div>
                    </div>
                    <div className="text-[13px] font-semibold whitespace-nowrap">{eur(f.betrag)}</div>
                  </Row>
                ))}
              </div>
            )}
            {z.fehlt.length > 0 && (
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-[13px] min-w-[520px]">
                  <thead>
                    <tr className="text-[11px] text-ink-3 text-left">
                      <th className="font-medium px-5 py-2">Datum</th>
                      <th className="font-medium px-2 py-2">Empfänger</th>
                      <th className="font-medium px-2 py-2">Zweck</th>
                      <th className="font-medium px-5 py-2 text-right">Betrag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {z.fehlt.map((f) => (
                      <tr key={f.id} className="border-t border-line align-top">
                        <td className="px-5 py-2.5 text-ink-2 whitespace-nowrap">{fmtDate(f.datum)}</td>
                        <td className="px-2 py-2.5 font-medium">{f.empfaenger || "–"}</td>
                        <td className="px-2 py-2.5 text-ink-2">
                          <div className="line-clamp-2 [overflow-wrap:anywhere]">{f.zweck}</div>
                          {f.hinweis && <div className="text-[11px] text-warn mt-0.5">{f.hinweis}</div>}
                        </td>
                        <td className="px-5 py-2.5 text-right font-semibold whitespace-nowrap">{eur(f.betrag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {z.kategorien.length > 0 && (
              <div className="px-5 py-3 border-t border-line flex flex-wrap gap-1.5">
                {z.kategorien.map((k) => (
                  <Badge key={k.kategorie} tone={k.kategorie === "FEHLT" ? "bad" : k.kategorie === "Beleg gefunden" ? "good" : "neutral"}>
                    {k.kategorie} · {k.anzahl} · {eur(k.summe)}
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          {/* Eingang */}
          <Card>
            <CardHeader
              title="Eingang"
              subtitle={`${data.zaehler.eingang_neu} neu · Anhänge aus Mails und Scans`}
              action={
                <Segmented
                  options={[
                    { value: "offen", label: "Offen" },
                    { value: "alle", label: "Alle" },
                  ]}
                  value={filter}
                  onChange={setFilter}
                />
              }
            />
            {eingang.length === 0 && (
              <EmptyState text={filter === "offen" ? "Keine offenen Belege im Eingang." : "Noch keine Belege eingegangen."} />
            )}
            {eingang.map((e) => {
              const st = STATUS[e.status] ?? { label: e.status, tone: "neutral" as const };
              return (
                <Row key={e.id} className="group items-start">
                  <Icon
                    name={e.mime === "application/pdf" ? "picture_as_pdf" : "image"}
                    size={20}
                    className="text-ink-3 mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium [overflow-wrap:anywhere]">{e.filename}</div>
                    <div className="text-[12px] text-ink-2 mt-0.5 truncate">{e.subject || "(ohne Betreff)"}</div>
                    <div className="text-[11px] text-ink-3 mt-0.5 [overflow-wrap:anywhere]">
                      {e.from_addr} · {fmtDate(e.received_at)} · {fmtSize(e.size)}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {e.quelle === "scan" && <Badge>Scan</Badge>}
                      {e.firma && <Badge>{FIRMA[e.firma] ?? e.firma}</Badge>}
                      {e.auftraege > 0 && <Badge>{e.auftraege} {e.auftraege === 1 ? "Dokument" : "Dokumente"}</Badge>}
                    </div>
                    {e.notiz && <div className="text-[11px] text-ink-3 mt-1 [overflow-wrap:anywhere]">{e.notiz}</div>}
                    {e.size > MAX_PREVIEW_BYTES && (
                      <div className="text-[11px] text-ink-3 mt-1">
                        Zu groß für die Vorschau – nach der Ablage über Google Drive öffnen
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {e.size > MAX_PREVIEW_BYTES ? (
                      <span
                        title="Zu groß für die Vorschau – nach der Ablage über Google Drive öffnen"
                        aria-label="Zu groß für die Vorschau – nach der Ablage über Google Drive öffnen"
                        className="w-9 h-9 rounded-full flex items-center justify-center text-ink-3 opacity-50"
                      >
                        <Icon name="visibility_off" size={19} />
                      </span>
                    ) : (
                      <a
                        href={`/api/buchhaltung/eingang/${e.id}/datei`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Vorschau"
                        title="Vorschau"
                        className="w-9 h-9 rounded-full flex items-center justify-center text-ink-3 hover:text-accent hover:bg-inset transition-all"
                      >
                        <Icon name="visibility" size={19} />
                      </a>
                    )}
                    {(e.status === "neu" || e.status === "fehler") && (
                      <button
                        onClick={() => setEingangStatus(e.id, "ignoriert")}
                        aria-label="Ignorieren"
                        title="Ignorieren (kein Beleg)"
                        className="w-9 h-9 rounded-full flex items-center justify-center text-ink-3 hover:text-bad hover:bg-inset transition-all"
                      >
                        <Icon name="block" size={18} />
                      </button>
                    )}
                    {e.status === "ignoriert" && (
                      <button
                        onClick={() => setEingangStatus(e.id, "neu")}
                        aria-label="Wiederherstellen"
                        title="Wiederherstellen"
                        className="w-9 h-9 rounded-full flex items-center justify-center text-ink-3 hover:text-accent hover:bg-inset transition-all"
                      >
                        <Icon name="undo" size={18} />
                      </button>
                    )}
                  </div>
                </Row>
              );
            })}
          </Card>

          {/* Nachholen: Anhänge, die vor Einführung des Moduls schon abgerufen waren */}
          <div className="-mt-3 px-1 text-[12px]">
            <button
              onClick={runBackfill}
              disabled={backfill?.running}
              className="inline-flex items-center gap-1.5 text-accent font-medium disabled:opacity-50"
            >
              <Icon name="history" size={16} className={backfill?.running ? "animate-spin" : ""} />
              Anhänge der letzten 30 Tage nachholen
            </button>
            {backfill && <p className="text-ink-2 mt-1">{backfill.text}</p>}
            {backfill?.hints.map((h, i) => (
              <p key={i} className="text-ink-3 mt-0.5 break-words">
                {h}
              </p>
            ))}
          </div>

          {/* Abgelegt */}
          <Card>
            <CardHeader title="Abgelegt" subtitle="Zuletzt nach Google Drive abgelegte Belege" />
            {!data.drive_verbunden && (
              <div className="mx-5 mb-2 flex items-start gap-2 bg-warn/10 border border-warn/30 rounded-[10px] px-3 py-2 text-[12px] text-warn">
                <Icon name="cloud_off" size={16} className="mt-0.5" />
                <span>Google Drive ist noch nicht verbunden – Aufträge warten, bis der Service-Account eingerichtet ist.</span>
              </div>
            )}
            {data.ablage.length === 0 && <EmptyState text="Noch nichts abgelegt." />}
            {data.ablage.map((a) => {
              const st = STATUS[a.status] ?? { label: a.status, tone: "neutral" as const };
              return (
                <Row key={a.id} className="items-start">
                  <Icon name="description" size={19} className="text-ink-3 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium [overflow-wrap:anywhere]">{a.dateiname}</div>
                    <div className="text-[11px] text-ink-3 mt-0.5 [overflow-wrap:anywhere]">{a.ziel_pfad}</div>
                    {a.fehler && <div className="text-[11px] text-bad mt-0.5 [overflow-wrap:anywhere]">{a.fehler}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {a.status === "fehler" && (
                      <button onClick={() => retryAblage(a.id)} className="text-[12px] text-accent">
                        Erneut versuchen
                      </button>
                    )}
                    {a.drive_url && (
                      <a
                        href={a.drive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] text-accent inline-flex items-center gap-1"
                      >
                        Drive <Icon name="open_in_new" size={13} />
                      </a>
                    )}
                  </div>
                </Row>
              );
            })}
          </Card>
        </div>

        <div className="space-y-5 min-w-0">
          {/* Fristen & Steuern */}
          <Card>
            <CardHeader title="Fristen & Steuern" subtitle="USt, Lohnsteuer, BG und Co." />
            {data.fristen.length === 0 && <EmptyState text="Keine offenen Fristen." />}
            {data.fristen.map((f) => {
              const days = f.faellig ? daysUntil(f.faellig) : null;
              return (
                <Row key={f.id} className="group items-start">
                  <div className="text-[12px] text-ink-2 w-[74px] shrink-0">
                    {fmtDate(f.faellig)}
                    {days !== null && (
                      <div className={days < 0 ? "text-bad" : days <= 7 ? "text-warn" : "text-ink-3"}>
                        {days < 0 ? `${-days} T. überfällig` : days === 0 ? "heute" : `in ${days} T.`}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium [overflow-wrap:anywhere]">{f.titel}</div>
                    <div className="text-[11px] text-ink-3 mt-0.5">
                      {ART[f.art] ?? f.art}
                      {f.betrag !== null ? ` · ${eur(f.betrag)}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => markPaid(f.id)}
                    title="Als bezahlt markieren"
                    className="text-[12px] text-ink-3 hover:text-accent px-2 h-8 rounded-full hover:bg-inset transition-all shrink-0"
                  >
                    Bezahlt
                  </button>
                </Row>
              );
            })}
          </Card>

          {/* Wichtige Mails */}
          <Card>
            <CardHeader title="Wichtige Mails" subtitle="Finanzamt, Steuerbüro, Kassen, Mahnungen" />
            {data.mails.length === 0 && <EmptyState text="Keine wichtigen Mails." />}
            {data.mails.map((m) => (
              <Row key={m.id} className={`items-start ${m.read ? "opacity-60" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium [overflow-wrap:anywhere]">{m.subject}</div>
                  {m.summary && <div className="text-[12px] text-ink-2 mt-0.5 line-clamp-2 [overflow-wrap:anywhere]">{m.summary}</div>}
                  <div className="text-[11px] text-ink-3 mt-0.5 [overflow-wrap:anywhere]">
                    {m.from_addr} · {fmtDate(m.received_at)}
                  </div>
                </div>
              </Row>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
