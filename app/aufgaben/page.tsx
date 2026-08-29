"use client";

import { useState } from "react";
import { Card, PageHeader, Badge, Button, Input, Select, Segmented, EmptyState, Row } from "@/components/ui";
import { useTable, fmtDate } from "@/lib/client";

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
  const { rows, reload, create, update, remove } = useTable<Task>("tasks");
  const [horizon, setHorizon] = useState<"short" | "long">("short");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState("2");

  const complete = async (id: number, undo = false) => {
    await fetch("/api/tasks/complete", { method: "POST", body: JSON.stringify({ id, undo }) });
    reload();
  };

  const add = async () => {
    if (!title.trim()) return;
    await create({
      title: title.trim(),
      horizon,
      due_date: due || null,
      recurrence: recurrence || null,
      project,
      priority: Number(priority),
    } as Partial<Task>);
    setTitle("");
    setDue("");
    setRecurrence("");
    setProject("");
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

      <Card className="mb-5">
        <div className="p-4 grid grid-cols-1 md:grid-cols-[1fr_150px_150px_150px_90px_auto] gap-2.5 items-center">
          <Input
            placeholder={horizon === "short" ? "Neue Aufgabe …" : "Neues langfristiges Ziel …"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <Select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
            <option value="">einmalig</option>
            <option value="daily">täglich</option>
            <option value="weekly">wöchentlich</option>
            <option value="monthly">monatlich</option>
          </Select>
          <Input placeholder="Projekt" value={project} onChange={(e) => setProject(e.target.value)} />
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="1">Hoch</option>
            <option value="2">Normal</option>
            <option value="3">Niedrig</option>
          </Select>
          <Button onClick={add}>Hinzufügen</Button>
        </div>
      </Card>

      <Card>
        {open.length === 0 && <EmptyState text="Keine offenen Aufgaben in dieser Ansicht." />}
        {open.map((t) => (
          <Row key={t.id} className="group">
            <button
              onClick={() => complete(t.id)}
              className="w-[18px] h-[18px] rounded-full border-[1.5px] border-ink-3 hover:border-accent hover:bg-accent-soft transition-all shrink-0"
              aria-label="Erledigt"
            />
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
                className="w-[18px] h-[18px] rounded-full bg-good border-good text-white text-[11px] leading-none shrink-0"
                title="Rückgängig"
              >
                ✓
              </button>
              <div className="flex-1 text-[13px] line-through text-ink-3">{t.title}</div>
            </Row>
          ))}
        </Card>
      )}
    </div>
  );
}
