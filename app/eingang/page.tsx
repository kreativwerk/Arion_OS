"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, ErrorNote, Icon, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/client";

/**
 * Eingang (docs/VORGAENGE.md): alles Neue an einer Stelle, einmal klären.
 * Brief/Mail → „Vorgang“ (landet in Vorgänge) oder „Erledigt“. Mitarbeiter-
 * Aufgaben → annehmen oder ablehnen. Ziel: abends auf null.
 */

type Brief = { id: number; subject: string; sender: string; summary: string; action: string; due_date: string; firma: string; received_date: string };
type Mail = { id: number; account: string; from_addr: string; subject: string; summary: string; received_at: string };
type MaAufgabe = { id: number; title: string; notes: string; due_date: string | null; submitted_by: string; source: string };
type Daten = { briefe: Brief[]; mails: Mail[]; mailGesamt: number; mitarbeiter: MaAufgabe[] };

const absender = (s: string) => s.replace(/<[^>]*>/g, "").replace(/"/g, "").trim() || s;

export default function EingangPage() {
  const [daten, setDaten] = useState<Daten | null>(null);
  const [fehler, setFehler] = useState("");
  const [weg, setWeg] = useState<Set<string>>(new Set());
  const [meldung, setMeldung] = useState("");

  const laden = useCallback(async () => {
    try {
      const res = await fetch("/api/eingang", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `Server-Fehler ${res.status}`);
      setDaten(j);
      setWeg(new Set());
      setFehler("");
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(laden, 0);
    return () => clearTimeout(t);
  }, [laden]);

  const aktion = async (art: string, id: number | undefined, was: string, extra: Record<string, unknown> = {}) => {
    const key = `${art}-${id ?? "alle"}`;
    setWeg((s) => new Set(s).add(key));
    try {
      const res = await fetch("/api/eingang", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ art, id, aktion: was, ...extra }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? `Server-Fehler ${res.status}`);
      setMeldung(was === "vorgang" ? "Als Vorgang angelegt – steht jetzt unter Vorgänge." : "");
      if (art === "mails") await laden();
    } catch (e) {
      setWeg((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
      setFehler(e instanceof Error ? e.message : String(e));
    }
  };

  if (!daten) return fehler ? <ErrorNote error={fehler} /> : <p className="text-ink-3 text-[13px]">Lade …</p>;

  const briefe = daten.briefe.filter((b) => !weg.has(`brief-${b.id}`));
  const mails = daten.mails.filter((m) => !weg.has(`mail-${m.id}`));
  const ma = daten.mitarbeiter.filter((t) => !weg.has(`mitarbeiter-${t.id}`));
  const mailRest = Math.max(0, daten.mailGesamt - daten.mails.length);
  const gesamt = briefe.length + mails.length + mailRest + ma.length;

  const knopf = "inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-medium transition-all";
  const zeile = "px-5 py-3.5 border-t border-line first:border-t-0";

  return (
    <div>
      <PageHeader title="Eingang" subtitle={gesamt ? `${gesamt} zu klären – einmal entscheiden, dann ist es weg` : "Alles geklärt"} />
      <ErrorNote error={fehler} />
      {meldung && (
        <p className="mb-4 text-[13px] text-accent flex items-center gap-1.5">
          <Icon name="check_circle" size={16} /> {meldung}{" "}
          <Link href="/aufgaben" className="underline">
            Zu den Vorgängen
          </Link>
        </p>
      )}
      {gesamt === 0 && (
        <Card>
          <EmptyState text="Eingang ist leer. Neue Briefe, wichtige Mails und Aufgaben von Mitarbeitern landen hier." />
        </Card>
      )}

      <div className="space-y-5">
        {ma.length > 0 && (
          <Card>
            <CardHeader title="Von Mitarbeitern" subtitle={`${ma.length} neue Aufgaben`} />
            {ma.map((t) => (
              <div key={t.id} className={zeile}>
                <div className="text-[14px] font-medium">{t.title}</div>
                <div className="text-[12px] text-ink-3 mt-0.5">
                  von {t.submitted_by || t.source}
                  {t.due_date ? ` · fällig ${fmtDate(t.due_date)}` : ""}
                </div>
                {t.notes && <div className="text-[12px] text-ink-2 mt-1 line-clamp-3">{t.notes}</div>}
                <div className="flex flex-wrap gap-2 mt-2.5">
                  <button onClick={() => aktion("mitarbeiter", t.id, "annehmen")} className={`${knopf} bg-accent text-on-accent`}>
                    <Icon name="check" size={16} /> Annehmen
                  </button>
                  <button onClick={() => aktion("mitarbeiter", t.id, "ablehnen")} className={`${knopf} bg-inset text-ink-2 hover:text-ink`}>
                    Ablehnen
                  </button>
                </div>
              </div>
            ))}
          </Card>
        )}

        {briefe.length > 0 && (
          <Card>
            <CardHeader
              title="Neue Briefe"
              subtitle={`${briefe.length} aus Scanner und Briefkasten`}
              action={
                <Link href="/post" className="text-[12px] text-accent">
                  Briefpost →
                </Link>
              }
            />
            {briefe.map((b) => (
              <div key={b.id} className={zeile}>
                <div className="flex flex-wrap items-center gap-1.5 mb-1 empty:hidden">
                  {b.firma && <Badge>{b.firma}</Badge>}
                  {/^\d{4}-\d{2}-\d{2}$/.test(b.due_date ?? "") && <Badge tone="warn">Frist {fmtDate(b.due_date).slice(0, 6)}</Badge>}
                </div>
                <a href={`/api/letters/${b.id}`} target="_blank" rel="noopener" className="text-[14px] font-medium hover:text-accent">
                  {b.subject || "Brief"}
                </a>
                <div className="text-[12px] text-ink-3 mt-0.5">{b.sender}</div>
                {b.summary && <div className="text-[12px] text-ink-2 mt-1 line-clamp-3">{b.summary}</div>}
                {b.action && (
                  <div className="text-[12px] mt-1.5 px-2.5 py-1.5 rounded-[10px] bg-inset">
                    <span className="text-accent font-medium">To-do → </span>
                    {b.action}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-2.5">
                  <button onClick={() => aktion("brief", b.id, "vorgang")} className={`${knopf} bg-accent text-on-accent`}>
                    <Icon name="add_task" size={16} /> Vorgang
                  </button>
                  <button onClick={() => aktion("brief", b.id, "erledigt")} className={`${knopf} bg-inset text-ink-2 hover:text-ink`}>
                    <Icon name="done" size={16} /> Erledigt
                  </button>
                </div>
              </div>
            ))}
          </Card>
        )}

        {(mails.length > 0 || mailRest > 0) && (
          <Card>
            <CardHeader
              title="Wichtige Mails"
              subtitle={`${mails.length + mailRest} ungelesen im Mail-Digest`}
              action={
                <Link href="/postfach" className="text-[12px] text-accent">
                  Postfach →
                </Link>
              }
            />
            <div className="px-5 pb-3 -mt-1">
              <button
                onClick={() => aktion("mails", undefined, "alt_gelesen", { tage: 7 })}
                className="text-[12px] text-ink-3 hover:text-accent underline-offset-2 hover:underline"
              >
                Alles älter als 7 Tage als gelesen markieren
              </button>
            </div>
            {mails.map((m) => (
              <div key={m.id} className={zeile}>
                <div className="text-[14px] font-medium line-clamp-2">{m.subject}</div>
                <div className="text-[12px] text-ink-3 mt-0.5 truncate">
                  {absender(m.from_addr)} · {m.account} · {fmtDate(m.received_at.slice(0, 10))}
                </div>
                {m.summary && <div className="text-[12px] text-ink-2 mt-1 line-clamp-2">{m.summary}</div>}
                <div className="flex flex-wrap gap-2 mt-2.5">
                  <button onClick={() => aktion("mail", m.id, "vorgang")} className={`${knopf} bg-accent text-on-accent`}>
                    <Icon name="add_task" size={16} /> Vorgang
                  </button>
                  <button onClick={() => aktion("mail", m.id, "erledigt")} className={`${knopf} bg-inset text-ink-2 hover:text-ink`}>
                    <Icon name="done" size={16} /> Gelesen
                  </button>
                </div>
              </div>
            ))}
            {mailRest > 0 && <p className="px-5 py-3 border-t border-line text-[12px] text-ink-3">+ {mailRest} ältere – erscheinen, sobald oben Platz ist.</p>}
          </Card>
        )}
      </div>
    </div>
  );
}
