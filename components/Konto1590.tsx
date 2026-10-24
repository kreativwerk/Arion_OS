"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardHeader, Button, Badge, Icon, EmptyState, Row } from "@/components/ui";
import { fmtDate } from "@/lib/client";

type Posten = {
  id: number;
  datum: string | null;
  text: string;
  betrag: number;
  belegnr: string;
  status: "offen" | "gefunden" | "erledigt";
  datei: string;
  datei_url: string;
  notiz: string;
};
type Daten = {
  jahr: string | null;
  jahre: string[];
  liste: string;
  zaehler: { offen: number; gefunden: number; erledigt: number; offen_summe: number };
  posten: Posten[];
};

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const STATUS = {
  offen: { label: "Fehlt", tone: "bad" as const },
  gefunden: { label: "Gefunden", tone: "good" as const },
  erledigt: { label: "Erledigt", tone: "neutral" as const },
};

/**
 * Konto 1590 (Durchlaufende Posten): Liste vom Steuerbüro hochladen, gegen die
 * Belege im Drive abgleichen, fehlende Belege je Zeile nachreichen.
 */
export default function Konto1590() {
  const [jahr, setJahr] = useState<string | null>(null);
  const [daten, setDaten] = useState<Daten | null>(null);
  const [busy, setBusy] = useState<"" | "liste" | "abgleich" | `beleg-${number}`>("");
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<"offen" | "alle">("offen");
  const listeRef = useRef<HTMLInputElement>(null);
  const belegRef = useRef<HTMLInputElement>(null);
  const belegFuer = useRef<number | null>(null);

  const load = useCallback(async (j: string | null) => {
    const res = await fetch(`/api/buchhaltung/1590${j ? `?jahr=${j}` : ""}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (res.ok && body) setDaten(body as Daten);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/buchhaltung/1590${jahr ? `?jahr=${jahr}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => !cancelled && b && !b.error && setDaten(b as Daten))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jahr]);

  const call = async (url: string, init: RequestInit) => {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? `Server-Fehler ${res.status}`);
    return body;
  };

  const abgleichen = async (j: string) => {
    setBusy("abgleich");
    setMeldung(null);
    try {
      const r = await call("/api/buchhaltung/1590/abgleich", { method: "POST", body: JSON.stringify({ jahr: j }) });
      setMeldung({
        ok: true,
        text: `Abgleich ${j}: ${r.gefunden} neu gefunden · ${r.offen} fehlen noch${r.hinweise?.length ? ` · ${r.hinweise.join(" ")}` : ""}`,
      });
      await load(j);
    } catch (e) {
      setMeldung({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  };

  const listeHochladen = async (file: File) => {
    setBusy("liste");
    setMeldung({ ok: true, text: "Liste wird gelesen …" });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await call("/api/buchhaltung/1590", { method: "POST", body: fd });
      setJahr(r.jahr);
      await load(r.jahr);
      setMeldung({
        ok: true,
        text: `Liste ${r.jahr} gelesen: ${r.zeilen} Posten (${r.neu} neu${r.nicht_mehr ? `, ${r.nicht_mehr} nicht mehr drauf` : ""}). Suche Belege …`,
      });
      setBusy("");
      await abgleichen(r.jahr);
    } catch (e) {
      setMeldung({ ok: false, text: e instanceof Error ? e.message : String(e) });
      setBusy("");
    }
  };

  const belegHochladen = async (id: number, file: File) => {
    setBusy(`beleg-${id}`);
    setMeldung(null);
    try {
      const fd = new FormData();
      fd.append("id", String(id));
      fd.append("file", file);
      const r = await call("/api/buchhaltung/1590/beleg", { method: "POST", body: fd });
      setMeldung({ ok: true, text: `Abgelegt als „${r.datei}“.` });
      await load(daten?.jahr ?? null);
    } catch (e) {
      setMeldung({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  };

  const setStatus = async (id: number, status: "offen" | "erledigt", notiz: string) => {
    try {
      await call("/api/buchhaltung/1590", { method: "PATCH", body: JSON.stringify({ id, status, notiz }) });
      await load(daten?.jahr ?? null);
    } catch (e) {
      setMeldung({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const z = daten?.zaehler;
  const posten = (daten?.posten ?? []).filter((p) => filter === "alle" || p.status === "offen");

  return (
    <Card>
      <CardHeader
        title="Konto 1590"
        subtitle={
          daten?.jahr && z
            ? `${daten.jahr} · ${z.offen} fehlen (${eur(z.offen_summe)}) · ${z.gefunden} gefunden · ${z.erledigt} erledigt`
            : "Liste „Beleg fehlt“ vom Steuerbüro hochladen und abgleichen"
        }
        action={
          <Button variant="ghost" onClick={() => listeRef.current?.click()} disabled={Boolean(busy)} className="shrink-0 whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="upload_file" size={16} />
              {busy === "liste" ? "Lese …" : "Liste hochladen"}
            </span>
          </Button>
        }
      />
      <input
        ref={listeRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) listeHochladen(f);
        }}
      />
      <input
        ref={belegRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          const id = belegFuer.current;
          e.target.value = "";
          if (f && id) belegHochladen(id, f);
        }}
      />

      {daten?.jahr && (
        <div className="px-5 pb-3 flex flex-wrap items-center gap-2">
          {daten.jahre.length > 1 &&
            daten.jahre.map((j) => (
              <button
                key={j}
                onClick={() => setJahr(j)}
                className={`h-8 px-3 rounded-full border text-[12px] font-medium transition-all ${
                  j === daten.jahr ? "bg-accent-soft border-accent/40 text-ink" : "bg-inset border-line text-ink-2 hover:text-ink"
                }`}
              >
                {j}
              </button>
            ))}
          <button
            onClick={() => setFilter(filter === "offen" ? "alle" : "offen")}
            className="h-8 px-3 rounded-full border border-line bg-inset text-[12px] text-ink-2 hover:text-ink transition-all"
          >
            {filter === "offen" ? "Alle zeigen" : "Nur fehlende"}
          </button>
          <div className="flex-1" />
          <Button onClick={() => daten.jahr && abgleichen(daten.jahr)} disabled={Boolean(busy)} className="whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="rule" size={16} className={busy === "abgleich" ? "animate-pulse" : ""} />
              {busy === "abgleich" ? "Gleiche ab …" : "Abgleichen"}
            </span>
          </Button>
        </div>
      )}

      {meldung && (
        <p className={`mx-5 mb-3 text-[12px] break-words ${meldung.ok ? "text-ink-2" : "text-bad"}`}>{meldung.text}</p>
      )}

      {!daten?.jahr && <EmptyState text="Noch keine 1590-Liste – lade das PDF vom Steuerbüro hoch." />}
      {daten?.jahr && posten.length === 0 && <EmptyState text="Alle Posten sind belegt oder erledigt." />}

      {posten.length > 0 && (
        <div className="max-h-[520px] overflow-y-auto">
          {posten.map((p) => (
            <Row key={p.id} className="items-start">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium [overflow-wrap:anywhere]">{p.text}</span>
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                </div>
                <div className="text-[11px] text-ink-3 mt-0.5">
                  {fmtDate(p.datum)}
                  {p.belegnr ? ` · Nr. ${p.belegnr}` : ""}
                </div>
                {p.datei && (
                  <a
                    href={p.datei_url || undefined}
                    target="_blank"
                    rel="noopener"
                    className="text-[11px] text-accent mt-0.5 inline-flex items-center gap-1 max-w-full"
                  >
                    <Icon name="description" size={13} />
                    <span className="truncate">{p.datei.split("/").pop()}</span>
                  </a>
                )}
                {p.notiz && <div className="text-[11px] text-ink-3 mt-0.5 [overflow-wrap:anywhere]">{p.notiz}</div>}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px]">
                  {p.status === "offen" && (
                    <>
                      <button
                        onClick={() => {
                          belegFuer.current = p.id;
                          belegRef.current?.click();
                        }}
                        disabled={Boolean(busy)}
                        className="text-accent hover:underline disabled:opacity-40"
                      >
                        {busy === `beleg-${p.id}` ? "Lade hoch …" : "Beleg hochladen"}
                      </button>
                      <button onClick={() => setStatus(p.id, "erledigt", "Eigenbeleg / Erklärung")} className="text-ink-3 hover:text-ink">
                        Eigenbeleg
                      </button>
                      <button
                        onClick={() => setStatus(p.id, "offen", `angefragt am ${new Date().toLocaleDateString("de-DE")}`)}
                        className="text-ink-3 hover:text-ink"
                      >
                        Angefragt
                      </button>
                    </>
                  )}
                  {p.status !== "offen" && (
                    <button onClick={() => setStatus(p.id, "offen", "")} className="text-ink-3 hover:text-ink">
                      Wieder offen
                    </button>
                  )}
                </div>
              </div>
              <div className="text-[13px] font-semibold whitespace-nowrap">{eur(p.betrag)}</div>
            </Row>
          ))}
        </div>
      )}
    </Card>
  );
}
