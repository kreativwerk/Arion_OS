"use client";

import { useState } from "react";
import { Card, PageHeader, Badge, Button, Segmented, EmptyState, Row, Icon, CheckCircle , ErrorNote } from "@/components/ui";
import { useTable, fmtDate } from "@/lib/client";
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
};

export default function TasksPage() {
  const { rows, reload, update, remove, error } = useTable<Task>("tasks");
  const [horizon, setHorizon] = useState<"short" | "long">("short");
  const [sheetOpen, setSheetOpen] = useState(false);

  const complete = async (id: number, undo = false) => {
    await fetch("/api/tasks/complete", { method: "POST", body: JSON.stringify({ id, undo }) });
    reload();
  };

  const inbox = rows.filter((t) => !t.accepted && !t.done);
  const open = rows.filter((t) => t.horizon === horizon && !t.done && t.accepted);
  const doneRows = rows.filter((t) => t.horizon === horizon && t.done);
  const recLabel: Record<string, string> = { daily: "täglich", weekly: "wöchentlich", monthly: "monatlich" };

  return (
    <div>
      <PageHeader
        title="Aufgaben"
        subtitle="Kurzfristig mit Wiederholungen, langfristig im Blick"
        action={
          <Segmented
            value={horizon}
            onChange={setHorizon}
            options={[
              { value: "short", label: "Short Term" },
              { value: "long", label: "Long Term" },
            ]}
          />
        }
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
        {open.length === 0 && <EmptyState text="Keine offenen Aufgaben in dieser Ansicht." />}
        {open.map((t) => (
          <Row key={t.id} className="group">
            <CheckCircle onComplete={() => complete(t.id)} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium">{t.title}</div>
              <div className="text-[11px] text-ink-3">
                {t.due_date ? `fällig ${fmtDate(t.due_date)}` : "ohne Termin"}
                {t.project ? ` · ${t.project}` : ""}
              </div>
            </div>
            {t.source && t.source !== "eigen" && (
              <Badge tone="accent">von {t.submitted_by || t.source}</Badge>
            )}
            {t.recurrence && <Badge tone="accent">{recLabel[t.recurrence] ?? t.recurrence}</Badge>}
            {t.priority === 1 && <Badge tone="bad">hoch</Badge>}
            {t.priority === 3 && <Badge>niedrig</Badge>}
            <button
              onClick={() => remove(t.id)}
              className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad text-[12px] transition-all"
            >
              Löschen
            </button>
          </Row>
        ))}
      </Card>

      {doneRows.length > 0 && (
        <Card className="mt-5 opacity-70">
          <div className="px-5 pt-3 pb-1 text-[12px] font-semibold text-ink-3 uppercase tracking-wide">
            Erledigt
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
        className="fixed z-50 bottom-[84px] lg:bottom-8 right-5 lg:right-8 w-14 h-14 rounded-[18px] bg-accent text-on-accent shadow-[0_8px_30px_rgba(62,207,142,0.35)] flex items-center justify-center hover:opacity-90 transition-all"
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
