"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, PageHeader, Button, Input, TextArea, EmptyState, Badge, ErrorNote, Icon, Segmented } from "@/components/ui";
import { fmtDate } from "@/lib/client";
import type { Feld, Vorlage } from "@/lib/bescheinigung-vorlage";

/* Bescheinigungen für Arbeitsagentur und Krankenkassen selbst vorbereiten
 * (lib/bescheinigung.ts). Abgegeben wird im SV-Meldeportal – hier steht, was
 * dort einzutragen ist, Feld für Feld zum Kopieren. */

type Status = "offen" | "sdworx" | "gesendet" | "erledigt";
type Art = "arbeitsbescheinigung" | "nebeneinkommen" | "entgeltbescheinigung" | "deuev" | "sonstiges";

type Vorgang = {
  id: number;
  art: Art;
  person: string;
  stelle: string;
  zeichen: string;
  von: string;
  bis: string;
  frist: string;
  status: Status;
  fehlend: number;
  warnungen: number;
  zettel: number;
  gesendet_am: string;
};

type Detail = Vorgang & {
  rvnr: string;
  geb: string;
  notiz: string;
  angaben: Record<string, unknown> & { wochen?: Record<string, string> };
  vorlage: Vorlage;
  briefe: { id: number; subject: string; sender: string; received_date: string }[];
};

const ART: Record<Art, { label: string; icon: string }> = {
  arbeitsbescheinigung: { label: "Arbeitsbescheinigung", icon: "work_history" },
  nebeneinkommen: { label: "Nebeneinkommen", icon: "schedule" },
  entgeltbescheinigung: { label: "Entgeltbescheinigung Krankengeld", icon: "medical_information" },
  deuev: { label: "DEÜV-Meldung", icon: "badge" },
  sonstiges: { label: "Bescheinigung", icon: "description" },
};

const STATUS_LABEL: Record<Status, string> = { offen: "Offen", sdworx: "Bei SD Worx", gesendet: "Gesendet", erledigt: "Erledigt" };
const PORTAL = "https://www.sv-meldeportal.de";

function tageBis(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + "T00:00:00").getTime() - heute.getTime()) / 86400000);
}

function FristBadge({ frist, status }: { frist: string; status: Status }) {
  const t = tageBis(frist);
  if (t === null) return null;
  if (status === "gesendet" || status === "erledigt") return <Badge>Frist {fmtDate(frist)}</Badge>;
  if (t < 0) return <Badge tone="bad">{-t} Tage überfällig</Badge>;
  if (t <= 7) return <Badge tone="warn">{t === 0 ? "heute fällig" : `noch ${t} Tage`}</Badge>;
  return <Badge>bis {fmtDate(frist)}</Badge>;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Fehler ${res.status}`);
  return data as T;
}

function CopyValue({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  if (!value) return null;
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        });
      }}
      className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-ink-3 hover:text-ink hover:bg-inset"
      aria-label="Kopieren"
      title="Kopieren"
    >
      <Icon name={ok ? "check" : "content_copy"} size={16} className={ok ? "text-accent" : ""} />
    </button>
  );
}

function FeldZeile({ f, onSave }: { f: Feld; onSave: (f: Feld, wert: string) => void }) {
  // Neuer Wert vom Server → Komponente wird über `key` neu aufgebaut
  const [wert, setWert] = useState(f.wert);
  const editierbar = Boolean(f.angabe);
  return (
    <div className="flex items-center gap-3 py-2 border-t border-line first:border-t-0">
      <div className="w-[42%] sm:w-[38%] shrink-0 text-[12px] text-ink-2">{f.label}</div>
      <div className="flex-1 min-w-0">
        {editierbar ? (
          <Input
            value={wert}
            placeholder={f.fehlt ? "fehlt noch" : ""}
            onChange={(e) => setWert(e.target.value)}
            onBlur={() => wert !== f.wert && onSave(f, wert)}
            className={f.fehlt ? "ring-1 ring-warn/60" : ""}
          />
        ) : (
          <div className={`text-[13px] break-words ${f.fehlt ? "text-warn" : ""}`}>{f.wert || "fehlt"}</div>
        )}
        {f.hinweis && <div className="text-[11px] text-ink-3 mt-1">{f.hinweis}</div>}
      </div>
      <CopyValue value={wert} />
    </div>
  );
}

function DetailView({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [notiz, setNotiz] = useState("");

  const load = useCallback(() => {
    api<Detail>(`/api/bescheinigungen/${id}`)
      .then((x) => {
        setD(x);
        setNotiz(x.notiz ?? "");
      })
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api(`/api/bescheinigungen/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveFeld = (f: Feld, wert: string) => {
    if (!f.angabe) return;
    if (f.angabe === "wochen" && f.woche) patch({ angaben: { wochen: { [f.woche]: wert } } });
    else patch({ angaben: { [f.angabe]: wert } });
  };

  if (error) return <div className="px-5 pb-4"><ErrorNote error={error} /></div>;
  if (!d) return <div className="px-5 pb-4 text-[12px] text-ink-3">Lädt …</div>;
  const v = d.vorlage;

  return (
    <div className="px-4 sm:px-5 pb-5 space-y-4">
      <div className="rounded-[10px] bg-inset p-3.5 text-[12px] text-ink-2 leading-relaxed">
        <div className="text-[13px] text-ink font-medium mb-1">{v.titel}</div>
        Abgeben im SV-Meldeportal: einloggen, Formular „{ART[d.art].label}“ öffnen und die Werte unten übernehmen.
        {v.fehlend.length === 0 ? " Alle Angaben sind vollständig." : ` Es fehlen noch ${v.fehlend.length} Angaben.`}
        <div className="mt-2">
          <a href={PORTAL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            <Icon name="open_in_new" size={14} /> SV-Meldeportal öffnen
          </a>
        </div>
      </div>

      {v.warnungen.length > 0 && (
        <div className="rounded-[10px] border border-warn/40 bg-[rgba(245,166,35,0.08)] p-3 space-y-1.5">
          {v.warnungen.map((w) => (
            <div key={w} className="flex gap-2 text-[12px] text-ink">
              <Icon name="warning" size={16} className="text-warn mt-[1px]" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {v.abschnitte.map((a) => (
        <div key={a.titel}>
          <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-1">{a.titel}</div>
          {a.felder.length > 0 && (
            <div className="rounded-[10px] bg-inset px-3">
              {a.felder.map((f) => (
                <FeldZeile key={`${f.label}|${f.wert}`} f={f} onSave={saveFeld} />
              ))}
            </div>
          )}
          {a.tabelle && a.tabelle.zeilen.length > 0 && (
            <div className="overflow-x-auto mt-2 rounded-[10px] bg-inset">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-ink-3 text-left">
                    {a.tabelle.kopf.map((k) => (
                      <th key={k} className="font-medium px-3 py-2 whitespace-nowrap">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.tabelle.zeilen.map((z, i) => (
                    <tr key={i} className="border-t border-line">
                      {z.map((c, j) => (
                        <td key={j} className={`px-3 py-2 ${j === 0 ? "whitespace-nowrap" : ""}`}>{c}</td>
                      ))}
                    </tr>
                  ))}
                  {a.tabelle.summe && (
                    <tr className="border-t border-line font-semibold">
                      {a.tabelle.summe.map((c, j) => (
                        <td key={j} className="px-3 py-2 whitespace-nowrap">{c}</td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {a.hinweis && <div className="text-[11px] text-ink-3 mt-1.5">{a.hinweis}</div>}
        </div>
      ))}

      {d.briefe.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-1">Briefe</div>
          <div className="space-y-1">
            {d.briefe.map((b) => (
              <a key={b.id} href={`/api/letters/${b.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[12px] text-ink-2 hover:text-ink">
                <Icon name="description" size={16} />
                <span className="truncate">{fmtDate(b.received_date)} · {b.subject}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-[11px] uppercase tracking-wide text-ink-3 mb-1">Notiz</div>
        <TextArea rows={2} value={notiz} onChange={(e) => setNotiz(e.target.value)} onBlur={() => notiz !== (d.notiz ?? "") && patch({ notiz })} />
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {d.status !== "gesendet" && <Button onClick={() => patch({ status: "gesendet" })}>Im Portal gesendet</Button>}
        {d.status !== "sdworx" && d.status !== "gesendet" && (
          <Button variant="ghost" onClick={() => patch({ status: "sdworx" })}>An SD Worx gegeben</Button>
        )}
        {d.status !== "erledigt" && <Button variant="ghost" onClick={() => patch({ status: "erledigt" })}>Erledigt</Button>}
        {d.status !== "offen" && <Button variant="ghost" onClick={() => patch({ status: "offen" })}>Wieder offen</Button>}
      </div>
    </div>
  );
}

type View = "offen" | "erledigt" | "alle";

export default function BescheinigungenPage() {
  const [data, setData] = useState<{ vorgaenge: Vorgang[]; lohn: { dateien: number; von: string; bis: string } } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [info, setInfo] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [view, setView] = useState<View>("offen");

  const load = useCallback(() => {
    api<typeof data>("/api/bescheinigungen").then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const aktion = async (aktion: "erkennen" | "lohn") => {
    setBusy(aktion);
    setInfo("");
    try {
      const r = await api<Record<string, number>>("/api/bescheinigungen", { method: "POST", body: JSON.stringify({ aktion }) });
      setInfo(
        aktion === "erkennen"
          ? `${r.neu ?? 0} neue Vorgänge, ${r.erinnerungen ?? 0} Erinnerungen zugeordnet.`
          : `${r.dateien ?? 0} Abrechnungen gelesen (${r.zettel ?? 0} Zettel)${r.offen ? `, ${r.offen} folgen beim nächsten Lauf` : ""}.`
      );
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const rows = (data?.vorgaenge ?? []).filter((r) =>
    view === "alle" ? true : view === "offen" ? r.status === "offen" || r.status === "sdworx" : r.status === "gesendet" || r.status === "erledigt"
  );
  const offen = (data?.vorgaenge ?? []).filter((r) => r.status === "offen").length;
  const monat = (m: string) => (m ? `${m.slice(5)}.${m.slice(0, 4)}` : "");

  return (
    <div>
      <PageHeader
        title="Bescheinigungen"
        subtitle={
          data
            ? `${offen} offen · ${data.lohn.dateien ? `Abrechnungen ${monat(data.lohn.von)}–${monat(data.lohn.bis)} gelesen` : "noch keine Abrechnungen gelesen"}`
            : "Lädt …"
        }
      />
      <ErrorNote error={error} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "offen", label: "Offen" },
            { value: "erledigt", label: "Erledigt" },
            { value: "alle", label: "Alle" },
          ]}
        />
        <div className="flex-1" />
        <Button variant="ghost" disabled={!!busy} onClick={() => aktion("erkennen")}>
          {busy === "erkennen" ? "Prüft …" : "Briefpost prüfen"}
        </Button>
        <Button variant="ghost" disabled={!!busy} onClick={() => aktion("lohn")}>
          {busy === "lohn" ? "Liest …" : "Abrechnungen lesen"}
        </Button>
      </div>
      {info && <p className="text-[12px] text-ink-2 mb-3 px-1">{info}</p>}

      <Card>
        {data && rows.length === 0 && <EmptyState text={view === "offen" ? "Keine offenen Bescheinigungen." : "Noch nichts erledigt."} />}
        {rows.map((r) => (
          <div key={r.id} className="border-t border-line first:border-t-0">
            <button onClick={() => setOpen(open === r.id ? null : r.id)} className="w-full text-left px-4 sm:px-5 py-3.5 flex items-start gap-3">
              <span className="w-9 h-9 rounded-[11px] bg-accent-soft text-accent flex items-center justify-center shrink-0">
                <Icon name={ART[r.art]?.icon ?? "description"} size={19} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-medium truncate">{r.person || "Unbekannt"}</span>
                <span className="block text-[12px] text-ink-2 truncate">
                  {ART[r.art]?.label ?? r.art}
                  {r.von ? ` · ${r.von}${r.bis ? ` – ${r.bis}` : ""}` : ""}
                </span>
                <span className="block text-[11px] text-ink-3 truncate">
                  {r.stelle}
                  {r.zeichen ? ` · ${r.zeichen}` : ""}
                </span>
                <span className="flex flex-wrap gap-1.5 mt-1.5">
                  <Badge tone={r.status === "offen" ? "accent" : r.status === "erledigt" ? "neutral" : "good"}>{STATUS_LABEL[r.status]}</Badge>
                  <FristBadge frist={r.frist} status={r.status} />
                  {r.status !== "erledigt" && r.fehlend > 0 && <Badge tone="warn">{r.fehlend === 1 ? "1 Angabe fehlt" : `${r.fehlend} Angaben fehlen`}</Badge>}
                  {r.status !== "erledigt" && r.warnungen > 0 && <Badge tone="warn">{r.warnungen} prüfen</Badge>}
                  {r.status !== "erledigt" && r.zettel === 0 && <Badge tone="bad">keine Abrechnung</Badge>}
                </span>
              </span>
              <Icon name={open === r.id ? "expand_less" : "expand_more"} size={20} className="text-ink-3 mt-2" />
            </button>
            {open === r.id && <DetailView id={r.id} onChanged={load} />}
          </div>
        ))}
      </Card>
      <p className="text-[12px] text-ink-3 mt-3 px-1">
        Arbeitsagentur und Krankenkassen nehmen Bescheinigungen nur elektronisch an. Hier steht, was im SV-Meldeportal einzutragen ist –
        abgeschickt wird dort. Neue Anforderungen aus der Briefpost und neue SD-Worx-Abrechnungen kommen automatisch dazu.
      </p>
    </div>
  );
}
