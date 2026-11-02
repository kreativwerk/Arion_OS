"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, ErrorNote, PageHeader, Segmented } from "@/components/ui";
import { fmtDate } from "@/lib/client";

/** Pro Firma auf einen Blick: was bei dir liegt, worauf du wartest, welche Briefe offen sind, was zuletzt erledigt wurde. */

const FIRMEN = ["Arion", "Fleet Fix", "Wohnwerk", "Kreativwerk", "Privat"] as const;
type Firma = (typeof FIRMEN)[number];
type V = { id: number; titel: string; frist: string | null; dringend: boolean; schritt: string; status: string; wartet: string; nachhakenAm: string | null };
type Daten = {
  offen: V[];
  erledigt: { id: number; title: string; completed_at: string }[];
  briefe: { id: number; subject: string; sender: string; status: string; due_date: string }[];
  briefeGesamt: number;
};

export default function FirmenPage() {
  const [firma, setFirma] = useState<Firma>("Arion");
  const [daten, setDaten] = useState<Daten | null>(null);
  const [fehler, setFehler] = useState("");

  const laden = useCallback(async (f: Firma) => {
    try {
      const res = await fetch(`/api/firmen?f=${encodeURIComponent(f)}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `Server-Fehler ${res.status}`);
      setDaten(j);
      setFehler("");
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => laden(firma), 0);
    return () => clearTimeout(t);
  }, [firma, laden]);

  const bei = daten?.offen.filter((v) => v.status !== "wartet") ?? [];
  const wartet = daten?.offen.filter((v) => v.status === "wartet") ?? [];

  const zeile = (v: V) => (
    <Link key={v.id} href="/aufgaben" className="block px-5 py-3 border-t border-line first:border-t-0 hover:bg-inset/40">
      <div className="text-[14px] font-medium line-clamp-2">{v.titel}</div>
      {v.schritt && <div className="text-[12px] text-ink-2 mt-0.5 line-clamp-2">→ {v.schritt}</div>}
      <div className="flex flex-wrap gap-1.5 mt-1.5 empty:hidden">
        {v.status === "wartet" && (
          <Badge>
            {v.wartet}
            {v.nachhakenAm ? ` · ab ${fmtDate(v.nachhakenAm).slice(0, 6)}` : ""}
          </Badge>
        )}
        {v.status === "nachhaken" && <Badge tone="warn">nachhaken</Badge>}
        {v.frist && <Badge>{fmtDate(v.frist)}</Badge>}
        {v.dringend && <Badge tone="bad">dringend</Badge>}
      </div>
    </Link>
  );

  return (
    <div>
      <PageHeader title="Firmen" subtitle="Jede Firma auf einen Blick" />
      <div className="overflow-x-auto -mx-4 px-4 mb-4">
        <Segmented value={firma} onChange={setFirma} options={FIRMEN.map((f) => ({ value: f, label: f }))} />
      </div>
      <ErrorNote error={fehler} />
      {!daten && !fehler && <p className="text-ink-3 text-[13px]">Lade …</p>}
      {daten && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <Card>
            <CardHeader title="Bei dir" subtitle={`${bei.length} offen`} />
            {bei.length === 0 && <EmptyState text="Nichts offen." />}
            {bei.map(zeile)}
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Wartet auf andere" subtitle={`${wartet.length}`} />
              {wartet.length === 0 && <EmptyState text="Du wartest auf niemanden." />}
              {wartet.map(zeile)}
            </Card>
            <Card>
              <CardHeader
                title="Offene Briefe"
                subtitle={`${daten.briefe.length} offen · ${daten.briefeGesamt} insgesamt`}
                action={
                  <Link href="/post" className="text-[12px] text-accent">
                    Briefpost →
                  </Link>
                }
              />
              {daten.briefe.length === 0 && <EmptyState text="Keine offenen Briefe." />}
              {daten.briefe.map((b) => (
                <a key={b.id} href={`/api/letters/${b.id}`} target="_blank" rel="noopener" className="block px-5 py-2.5 border-t border-line first:border-t-0 hover:bg-inset/40">
                  <div className="text-[13px] font-medium line-clamp-1">{b.subject}</div>
                  <div className="text-[11px] text-ink-3">
                    {b.sender} · {b.status === "neu" ? "neu" : "in Arbeit"}
                  </div>
                </a>
              ))}
            </Card>
            <Card>
              <CardHeader title="Zuletzt erledigt" />
              {daten.erledigt.length === 0 && <EmptyState text="Noch nichts erledigt." />}
              {daten.erledigt.map((t) => (
                <div key={t.id} className="px-5 py-2 border-t border-line first:border-t-0 text-[12px] text-ink-3 flex justify-between gap-3">
                  <span className="line-clamp-1 line-through">{t.title}</span>
                  <span className="shrink-0">{t.completed_at ? fmtDate(t.completed_at.slice(0, 10)).slice(0, 6) : ""}</span>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
