"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, Badge, EmptyState, Icon, PageHeader, Row } from "@/components/ui";
import type { AmazonAvis, Ampel, Bereich } from "@/lib/leitstand";

type Daten = {
  today: string;
  kopf: { rot: number; gelb: number; gruen: number; grau: number; satz: string };
  bereiche: Bereich[];
  amazon: AmazonAvis[];
  eigeneStationen: string[];
  lastschriften: { an: string; datum: string; betrag: number | null; tage: number }[];
};

const AMPEL: Record<Ampel, { label: string; punkt: string; rand: string; badge: "bad" | "warn" | "good" | "neutral" }> = {
  rot: { label: "Handeln", punkt: "bg-bad", rand: "border-bad/40", badge: "bad" },
  gelb: { label: "Ansehen", punkt: "bg-warn", rand: "border-warn/30", badge: "warn" },
  gruen: { label: "Läuft", punkt: "bg-good", rand: "border-line", badge: "good" },
  grau: { label: "Keine Daten", punkt: "bg-ink-3", rand: "border-line", badge: "neutral" },
};

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const tt = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : "–");

/**
 * Leitstand: alle Bereiche mit Ampel auf einer Seite (lib/leitstand.ts).
 * Rot = jetzt handeln, Gelb = ansehen, Grün = läuft, Grau = Quelle fehlt.
 */
export default function LeitstandPage() {
  const [daten, setDaten] = useState<Daten | null>(null);
  const [fehler, setFehler] = useState("");

  const laden = useCallback(() => {
    fetch("/api/leitstand", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `Server-Fehler ${res.status}`);
        setDaten(body);
        setFehler("");
      })
      .catch((e) => setFehler(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    laden();
  }, [laden]);

  if (fehler)
    return (
      <div className="bg-bad/10 border border-bad/30 rounded-card p-5">
        <div className="flex items-center gap-2 text-bad font-semibold text-[14px]">
          <Icon name="error" size={20} /> Leitstand konnte nicht geladen werden
        </div>
        <p className="text-[13px] text-ink-2 mt-2 break-words">{fehler}</p>
        <button onClick={laden} className="mt-3 text-[13px] text-accent font-medium">
          Erneut versuchen
        </button>
      </div>
    );
  if (!daten) return <p className="text-ink-3 text-[13px]">Lade …</p>;

  const sortiert = [...daten.bereiche].sort((a, b) => rang(a.ampel) - rang(b.ampel));
  const stand = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <PageHeader
        title="Leitstand"
        subtitle={daten.kopf.satz}
        action={
          <button
            onClick={laden}
            aria-label="Neu laden"
            className="w-10 h-10 rounded-full flex items-center justify-center text-ink-3 hover:text-accent hover:bg-inset"
          >
            <Icon name="refresh" size={20} />
          </button>
        }
      />

      {/* Zählung je Ampel */}
      <div className="flex flex-wrap items-center gap-2 mb-5 -mt-3">
        {(["rot", "gelb", "gruen", "grau"] as const)
          .filter((a) => daten.kopf[a] > 0)
          .map((a) => (
            <span key={a} className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-card border border-line text-[12px] text-ink-2">
              <span className={`w-2 h-2 rounded-full ${AMPEL[a].punkt}`} />
              {daten.kopf[a]} {AMPEL[a].label}
            </span>
          ))}
        <span className="text-[11px] text-ink-3 ml-auto">Stand {stand} Uhr</span>
      </div>

      {/* Bereiche: Rot zuerst */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {sortiert.map((b) => (
          <BereichKarte key={b.id} b={b} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <AmazonKarte avis={daten.amazon} eigene={daten.eigeneStationen} today={daten.today} />
        <Card>
          <CardHeader title="Angekündigte Lastschriften" subtitle="aus den Qonto-Mails" />
          {daten.lastschriften.length === 0 && <EmptyState text="Keine Lastschriften angekündigt." />}
          {daten.lastschriften.map((l, i) => (
            <Row key={`${l.an}-${l.datum}-${i}`}>
              <div className="text-[12px] text-ink-2 w-[52px] shrink-0">{tt(l.datum)}</div>
              <div className="flex-1 min-w-0 text-[13px] font-medium truncate">{l.an}</div>
              <div className="text-[13px] tabular-nums">{l.betrag !== null ? eur(l.betrag) : "–"}</div>
            </Row>
          ))}
        </Card>
      </div>
    </div>
  );
}

function rang(a: Ampel): number {
  return { rot: 0, gelb: 1, gruen: 2, grau: 3 }[a];
}

function BereichKarte({ b }: { b: Bereich }) {
  const a = AMPEL[b.ampel];
  return (
    <Link href={b.href} className="block group">
      <Card className={`h-full p-4 transition-all group-hover:border-accent/40 ${a.rand}`}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-[11px] bg-inset flex items-center justify-center shrink-0">
            <Icon name={b.icon} size={19} className="text-ink-2" />
          </div>
          <div className="flex-1 min-w-0 text-[15px] font-semibold tracking-tight truncate">{b.titel}</div>
          <Badge tone={a.badge}>
            <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${a.punkt}`} />
            {a.label}
          </Badge>
        </div>
        <div className="mt-3 flex items-baseline gap-2 min-w-0">
          <span className={`text-[26px] font-bold leading-none tabular-nums ${b.ampel === "grau" ? "text-ink-3" : ""}`}>{b.kennzahl}</span>
          <span className="text-[12px] text-ink-3 truncate">{b.zeile}</span>
        </div>
        {b.punkte.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {b.punkte.slice(0, 4).map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-snug min-w-0">
                <span
                  className={`mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 ${p.ton === "bad" ? "bg-bad" : p.ton === "warn" ? "bg-warn" : "bg-ink-3"}`}
                />
                <span className={`min-w-0 break-words ${p.ton === "bad" ? "text-ink" : "text-ink-2"}`}>{p.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Link>
  );
}

function AmazonKarte({ avis, eigene, today }: { avis: AmazonAvis[]; eigene: string[]; today: string }) {
  const kommend = avis.filter((a) => a.zahlungsdatum >= today);
  return (
    <Card>
      <CardHeader
        title="Amazon-Zahlungen"
        subtitle={kommend.length ? `${eur(kommend.reduce((s, a) => s + a.summe, 0))} angekündigt` : "aus den Zahlungsavisen der letzten 14 Tage"}
      />
      {avis.length === 0 && <EmptyState text="Keine Zahlungsavise in den letzten 14 Tagen." />}
      {avis.map((a) => {
        const stationen = [...new Set(a.posten.map((p) => p.station))];
        const fremd = stationen.filter((s) => !eigene.includes(s));
        return (
          <Row key={a.nummer}>
            <div className="text-[12px] text-ink-2 w-[52px] shrink-0">{tt(a.zahlungsdatum)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                {stationen.map((s) => (
                  <Badge key={s} tone={fremd.includes(s) ? "warn" : "neutral"}>
                    {s}
                  </Badge>
                ))}
                {a.zahlungsdatum >= today && <Badge tone="accent">kommt</Badge>}
              </div>
              <div className="text-[11px] text-ink-3 mt-1 truncate">
                Zahlung {a.nummer} · {a.posten.length} {a.posten.length === 1 ? "Rechnung" : "Rechnungen"}
                {fremd.length ? " · fremde Station prüfen" : ""}
              </div>
            </div>
            <div className="text-[13px] font-medium tabular-nums">{eur(a.summe)}</div>
          </Row>
        );
      })}
    </Card>
  );
}
