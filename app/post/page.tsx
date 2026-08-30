"use client";

import { useState } from "react";
import { Card, PageHeader, Button, Input, TextArea, EmptyState, Badge , ErrorNote } from "@/components/ui";
import { useTable, fmtDate, todayIso } from "@/lib/client";

type Letter = {
  id: number;
  subject: string;
  sender: string;
  received_date: string;
  scanned_by: string;
  status: string;
  summary: string;
};

const STATUS_FLOW: Record<string, string> = { neu: "gelesen", gelesen: "aktion", aktion: "archiv", archiv: "neu" };
const STATUS_TONE: Record<string, "accent" | "neutral" | "warn" | "good"> = {
  neu: "accent",
  gelesen: "neutral",
  aktion: "warn",
  archiv: "good",
};

export default function PostPage() {
  const { rows, create, update, remove, error } = useTable<Letter>("letters");
  const [subject, setSubject] = useState("");
  const [sender, setSender] = useState("");
  const [summary, setSummary] = useState("");
  const [scannedBy, setScannedBy] = useState("");
  const [showForm, setShowForm] = useState(false);

  const active = rows.filter((l) => l.status !== "archiv");
  const archived = rows.filter((l) => l.status === "archiv");

  return (
    <div>
      <PageHeader
        title="Briefpost"
        subtitle="Von deinem Mitarbeiter gescannt, hier digital zugestellt"
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? "Schließen" : "Scan erfassen"}</Button>}
      />

      <ErrorNote error={error} />

      {showForm && (
        <Card className="mb-5">
          <div className="p-4 space-y-2.5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <Input placeholder="Betreff des Briefs" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <Input placeholder="Absender" value={sender} onChange={(e) => setSender(e.target.value)} />
            </div>
            <TextArea placeholder="Kurze Zusammenfassung des Inhalts …" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
            <div className="flex gap-2.5">
              <Input placeholder="Gescannt von" value={scannedBy} onChange={(e) => setScannedBy(e.target.value)} />
              <Button
                onClick={() => {
                  if (!subject.trim()) return;
                  create({
                    subject: subject.trim(),
                    sender,
                    summary,
                    scanned_by: scannedBy,
                    received_date: todayIso(),
                    status: "neu",
                  } as Partial<Letter>);
                  setSubject("");
                  setSender("");
                  setSummary("");
                  setShowForm(false);
                }}
              >
                Zustellen
              </Button>
            </div>
            <p className="text-[11px] text-ink-3">
              Ausbaustufe: eigener Upload-Link für den Mitarbeiter, PDF-Ablage + automatische Zusammenfassung per KI
              (siehe <code>docs/INTEGRATIONEN.md</code>).
            </p>
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {active.length === 0 && (
          <Card>
            <EmptyState text="Keine offene Post." />
          </Card>
        )}
        {active.map((l) => (
          <Card key={l.id}>
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">{l.subject}</div>
                  <div className="text-[12px] text-ink-3 mt-0.5">
                    {l.sender} · eingegangen {fmtDate(l.received_date)}
                    {l.scanned_by ? ` · gescannt von ${l.scanned_by}` : ""}
                  </div>
                </div>
                <button onClick={() => update(l.id, { status: STATUS_FLOW[l.status] } as Partial<Letter>)}>
                  <Badge tone={STATUS_TONE[l.status] ?? "neutral"}>{l.status} →</Badge>
                </button>
              </div>
              {l.summary && (
                <p className="text-[13px] text-ink-2 mt-3 bg-inset rounded-[10px] px-3.5 py-2.5">{l.summary}</p>
              )}
            </div>
          </Card>
        ))}

        {archived.length > 0 && (
          <Card className="opacity-60">
            <div className="px-5 pt-3 pb-1 text-[12px] font-semibold text-ink-3 uppercase tracking-wide">Archiv</div>
            {archived.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-5 py-2.5 border-t border-line group">
                <div className="flex-1 text-[13px] text-ink-2 truncate">{l.subject}</div>
                <div className="text-[11px] text-ink-3">{fmtDate(l.received_date)}</div>
                <button
                  onClick={() => remove(l.id)}
                  className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad text-[12px]"
                >
                  Löschen
                </button>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
