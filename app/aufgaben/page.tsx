"use client";

import { useState } from "react";
import { Card, PageHeader, Badge, Button, Segmented, EmptyState, Row, Icon, CheckCircle , ErrorNote } from "@/components/ui";
import { useTable, fmtDate, todayIso } from "@/lib/client";
import { vorgangStatus, wartetText, WER_DRAN } from "@/lib/vorgang";
import TaskQuickSheet from "@/components/TaskQuickSheet";

type Task = {
  id: number;
  title: string;
  notes: string;
  horizon: "short" | "long";
  due_date: string | null;
  recurrence: string | null;
  project: string;
  priority: number;
  done: number;
  source: string;
  submitted_by: string;
  accepted: number;
  completed_at?: string | null;
  wer_dran?: string | null;
  wartet_auf?: string | null;
  naechster_schritt?: string | null;
  nachhaken_am?: string | null;
};

type Ansicht = "ich" | "wartet" | "lang";

export default function TasksPage() {
  const { rows, reload, update, remove, error } = useTable<Task>("tasks");
  const [ansicht, setAnsicht] = useState<Ansicht>("ich");
  const [offenId, setOffenId] = useState<number | null>(null);
  const horizon: "short" | "long" = ansicht === "lang" ? "long" : "short";
  const today = todayIso();
  const [sheetOpen, setSheetOpen] = useState(false);

  const complete = async (id: number, undo = false) => {
    await fetch("/api/tasks/complete", { method: "POST", body: JSON.stringify({ id, undo }) });
    reload();
  };

  const inbox = rows.filter((t) => !t.accepted && !t.done);
  // Vorgangsmodell (lib/vorgang.ts): „Ich dran“ = bei Albert oder Nachhaken fällig; „Wartet“ = jemand anderes ist dran
  const aktiv = rows.filter((t) => !t.done && t.accepted);
  const status = (t: Task) => vorgangStatus(t, today);
  const ich = aktiv.filter((t) => t.horizon !== "long" && status(t) !== "wartet");
  const wartet = aktiv.filter((t) => t.horizon !== "long" && status(t) === "wartet");
  const lang = aktiv.filter((t) => t.horizon === "long");
  const open = ansicht === "ich" ? ich : ansicht === "wartet" ? wartet : lang;
  const vor14 = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const doneRows = rows.filter((t) => t.done && (t.completed_at ?? "").slice(0, 10) >= vor14).slice(0, 20);
  const recLabel: Record<string, string> = { daily: "täglich", weekly: "wöchentlich", monthly: "monatlich" };

  return (
    <div>
      <PageHeader title="Vorgänge" subtitle="Was bei dir liegt, worauf du wartest und was später kommt" />

      {/* Tab-Leiste über die ganze Breite */}
      <Segmented
        className="flex w-full mb-4"
        value={ansicht}
        onChange={(v) => {
          setAnsicht(v);
          setOffenId(null);
        }}
        options={[
          { value: "ich", label: `Ich dran · ${ich.length}` },
          { value: "wartet", label: `Wartet · ${wartet.length}` },
          { value: "lang", label: `Langfristig · ${lang.length}` },
        ]}
      />

      <ErrorNote error={error} />

      {inbox.length > 0 && (
        <Card className="mb-5 border-accent/30">
          <div className="px-5 pt-3.5 pb-1 flex items-center gap-2">
            <span className="text-[13px] font-semibold">Eingang von Mitarbeitern</span>
            <Badge tone="accent">{inbox.length}</Badge>
          </div>
          {inbox.map((t) => (
            <Row key={t.id}>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium">{t.title}</div>
                <div className="text-[11px] text-ink-3">
                  von {t.submitted_by || "unbekannt"} · über {t.source}
                  {t.due_date ? ` · fällig ${fmtDate(t.due_date)}` : ""}
                  {t.notes ? ` · ${t.notes}` : ""}
                </div>
              </div>
              <Button variant="ghost" onClick={() => update(t.id, { accepted: 1 } as Partial<Task>)}>
                Annehmen
              </Button>
              <Button variant="danger" onClick={() => remove(t.id)}>
                Ablehnen
              </Button>
            </Row>
          ))}
        </Card>
      )}

      <Card>
        {open.length === 0 && (
          <EmptyState text={ansicht === "wartet" ? "Du wartest auf niemanden." : "Keine offenen Vorgänge in dieser Ansicht."} />
        )}
        {open.map((t) => {
          const st = status(t);
          const auf = offenId === t.id;
          const warteText = wartetText(t.wer_dran, t.wartet_auf);
          return (
            <div key={t.id} className={`border-t border-line first:border-t-0 ${auf ? "bg-inset/40" : ""}`}>
              <div className="flex items-start gap-3 px-5 py-3 group">
                <div className="shrink-0 pt-px">
                  <CheckCircle onComplete={() => complete(t.id)} />
                </div>
                <button type="button" onClick={() => setOffenId(auf ? null : t.id)} aria-expanded={auf} className="flex-1 min-w-0 text-left">
                  <div className={`text-[14px] font-medium ${auf ? "" : "line-clamp-2"}`}>{t.title}</div>
                  {t.naechster_schritt && <div className="text-[12px] text-ink-2 mt-0.5 line-clamp-2">→ {t.naechster_schritt}</div>}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5 empty:hidden">
                    {st === "nachhaken" && <Badge tone="warn">nachhaken · {warteText.replace(/^wartet auf /, "")}</Badge>}
                    {st === "wartet" && (
                      <Badge>
                        {warteText}
                        {t.nachhaken_am ? ` · ab ${fmtDate(t.nachhaken_am).slice(0, 6)}` : ""}
                      </Badge>
                    )}
                    {t.project && <Badge>{t.project}</Badge>}
                    {t.due_date && <Badge tone={t.due_date < today ? "bad" : "neutral"}>{fmtDate(t.due_date)}</Badge>}
                    {t.source && t.source !== "eigen" && t.source !== "claude" && <Badge tone="accent">von {t.submitted_by || t.source}</Badge>}
                    {t.recurrence && <Badge tone="accent">{recLabel[t.recurrence] ?? t.recurrence}</Badge>}
                    {t.priority === 1 && <Badge tone="bad">dringend</Badge>}
                    {t.priority === 3 && <Badge>niedrig</Badge>}
                  </div>
                </button>
              </div>
              {auf && (
                <div className="px-5 pb-4 pl-[60px] space-y-3">
                  <div>
                    <div className="text-[11px] text-ink-3 mb-1">Wer ist dran?</div>
                    <Segmented
                      value={(t.wer_dran || "albert") as "albert" | "claude" | "mitarbeiter" | "extern"}
                      onChange={(v) => update(t.id, { wer_dran: v === "albert" ? "" : v } as Partial<Task>)}
                      options={WER_DRAN}
                    />
                  </div>
                  {!["", "albert"].includes(t.wer_dran ?? "") && (
                    <div className="flex flex-wrap gap-2">
                      <input
                        defaultValue={t.wartet_auf ?? ""}
                        placeholder="Wartet auf … (z. B. SD Worx)"
                        onBlur={(e) => e.target.value !== (t.wartet_auf ?? "") && update(t.id, { wartet_auf: e.target.value } as Partial<Task>)}
                        className="flex-1 min-w-[180px] h-9 px-3 rounded-[10px] bg-inset border border-line text-[13px]"
                      />
                      <label className="flex items-center gap-2 text-[12px] text-ink-2">
                        Nachhaken am
                        <input
                          type="date"
                          defaultValue={t.nachhaken_am ?? ""}
                          onChange={(e) => update(t.id, { nachhaken_am: e.target.value } as Partial<Task>)}
                          className="h-9 px-2 rounded-[10px] bg-inset border border-line text-[13px]"
                        />
                      </label>
                    </div>
                  )}
                  <input
                    defaultValue={t.naechster_schritt ?? ""}
                    placeholder="Nächster Schritt in einem Satz"
                    onBlur={(e) =>
                      e.target.value !== (t.naechster_schritt ?? "") && update(t.id, { naechster_schritt: e.target.value } as Partial<Task>)
                    }
                    className="w-full h-9 px-3 rounded-[10px] bg-inset border border-line text-[13px]"
                  />
                  {t.notes && <p className="text-[12px] text-ink-2 whitespace-pre-line leading-relaxed">{t.notes}</p>}
                  <button onClick={() => remove(t.id)} className="text-ink-3 hover:text-bad text-[12px]">
                    Vorgang löschen
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {doneRows.length > 0 && (
        <Card className="mt-5 opacity-70">
          <div className="px-5 pt-3 pb-1 text-[12px] font-semibold text-ink-3 uppercase tracking-wide">
            Erledigt · letzte 14 Tage
          </div>
          {doneRows.map((t) => (
            <Row key={t.id}>
              <button
                onClick={() => complete(t.id, true)}
                className="w-[26px] h-[26px] rounded-full bg-good border-good text-on-accent flex items-center justify-center shrink-0 hover:opacity-80 transition-all"
                title="Rückgängig"
              >
                <Icon name="check" size={17} />
              </button>
              <div className="flex-1 text-[13px] line-through text-ink-3">{t.title}</div>
            </Row>
          ))}
        </Card>
      )}

      {/* Floating-Button: neue Aufgabe (Google-Tasks-Stil) */}
      <button
        onClick={() => setSheetOpen(true)}
        className="fixed z-50 bottom-[118px] lg:bottom-8 right-5 lg:right-8 w-14 h-14 rounded-[18px] bg-accent text-on-accent shadow-[0_8px_30px_rgba(62,207,142,0.35)] flex items-center justify-center hover:opacity-90 transition-all"
        aria-label="Neue Aufgabe"
      >
        <Icon name="add" size={28} />
      </button>

      <TaskQuickSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={reload}
        defaultHorizon={horizon}
      />
    </div>
  );
}
