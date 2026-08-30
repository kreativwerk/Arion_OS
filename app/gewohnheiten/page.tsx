"use client";

import { useEffect, useState } from "react";
import { Card, PageHeader, Button, EmptyState, Icon, MaybeIcon, ErrorNote } from "@/components/ui";
import { useTable, todayIso } from "@/lib/client";

type Habit = { id: number; name: string; emoji: string; target_per_week: number };
type Log = { habit_id: number; date: string };

/** Auswahl statt Freitext: gängige Material-Icons für Gewohnheiten. */
const ICONS = [
  "check_circle",
  "directions_run",
  "fitness_center",
  "self_improvement",
  "water_drop",
  "bedtime",
  "menu_book",
  "restaurant",
  "smoke_free",
  "savings",
  "mail",
  "family_restroom",
  "mosque",
  "code",
];

function lastDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (n - 1 - i));
    return d.toLocaleDateString("sv-SE");
  });
}

export default function HabitsPage() {
  const { rows: habits, create, remove, error } = useTable<Habit>("habits");
  const [logs, setLogs] = useState<Log[]>([]);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("check_circle");

  const days = lastDays(7);

  const loadLogs = async () => {
    const res = await fetch("/api/habits/toggle", { cache: "no-store" });
    if (res.ok) setLogs(await res.json());
  };
  useEffect(() => {
    loadLogs();
  }, []);

  const toggle = async (habit_id: number, date: string) => {
    // Sofort umschalten (optimistisch), dann mit dem Server abgleichen
    setLogs((ls) =>
      ls.some((l) => l.habit_id === habit_id && l.date === date)
        ? ls.filter((l) => !(l.habit_id === habit_id && l.date === date))
        : [...ls, { habit_id, date }]
    );
    await fetch("/api/habits/toggle", { method: "POST", body: JSON.stringify({ habit_id, date }) });
    loadLogs();
  };

  const add = () => {
    if (!name.trim()) return;
    create({ name: name.trim(), emoji: icon } as Partial<Habit>);
    setName("");
    setIcon("check_circle");
  };

  const has = (h: number, d: string) => logs.some((l) => l.habit_id === h && l.date === d);
  const weekCount = (h: number) => days.filter((d) => has(h, d)).length;

  const streak = (h: number) => {
    let s = 0;
    const d = new Date();
    if (!has(h, todayIso())) d.setDate(d.getDate() - 1);
    while (has(h, d.toLocaleDateString("sv-SE"))) {
      s++;
      d.setDate(d.getDate() - 1);
    }
    return s;
  };

  return (
    <div>
      <PageHeader title="Gewohnheiten" subtitle="Die letzten 7 Tage im Überblick" />

      <ErrorNote error={error} />

      {/* Neue Gewohnheit: großes Feld + Icon-Auswahl */}
      <Card className="mb-5">
        <div className="p-4 space-y-3">
          <div className="flex gap-2.5">
            <input
              placeholder="Neue Gewohnheit …"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              className="flex-1 h-12 px-4 rounded-[12px] bg-inset border border-line text-[16px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
            />
            <Button onClick={add} disabled={!name.trim()} className="!h-12 !px-5 shrink-0">
              Hinzufügen
            </Button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {ICONS.map((ic) => (
              <button
                key={ic}
                onClick={() => setIcon(ic)}
                aria-label={ic}
                className={`w-11 h-11 rounded-[12px] border flex items-center justify-center shrink-0 transition-all ${
                  icon === ic
                    ? "bg-accent-soft border-accent/50 text-accent"
                    : "bg-inset border-line text-ink-2 hover:border-ink-3"
                }`}
              >
                <Icon name={ic} size={22} />
              </button>
            ))}
          </div>
        </div>
      </Card>

      {habits.length === 0 && (
        <Card>
          <EmptyState text="Noch keine Gewohnheiten angelegt." />
        </Card>
      )}

      <div className="space-y-4">
        {habits.map((h) => (
          <Card key={h.id} className="p-4">
            <div className="flex items-center gap-2.5 mb-3">
              <MaybeIcon value={h.emoji} size={20} className="text-accent" />
              <span className="text-[15px] font-semibold flex-1 min-w-0 truncate">{h.name}</span>
              <span className="text-[12px] text-ink-3">
                {weekCount(h.id)}/{h.target_per_week ?? 7}
              </span>
              {streak(h.id) > 0 && (
                <span className="inline-flex items-center gap-1 text-[13px] font-semibold">
                  <Icon name="local_fire_department" size={16} className="text-warn" />
                  {streak(h.id)}
                </span>
              )}
              <button
                onClick={() => remove(h.id)}
                aria-label="Löschen"
                className="text-ink-3 hover:text-bad transition-colors p-1"
              >
                <Icon name="delete" size={18} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {days.map((d) => {
                const checked = has(h.id, d);
                const isToday = d === todayIso();
                return (
                  <button
                    key={d}
                    onClick={() => toggle(h.id, d)}
                    className={`h-[52px] rounded-[12px] border flex flex-col items-center justify-center gap-0.5 transition-all ${
                      checked
                        ? "bg-good border-good text-on-accent"
                        : "bg-inset border-line hover:border-accent/50"
                    }`}
                  >
                    <span
                      className={`text-[10px] font-medium ${
                        checked ? "text-on-accent/80" : isToday ? "text-accent" : "text-ink-3"
                      }`}
                    >
                      {new Date(d + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short" })}
                    </span>
                    {checked ? (
                      <Icon name="check" size={18} />
                    ) : (
                      <span className="w-[18px] h-[18px] rounded-full border-[1.5px] border-ink-3/60" />
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
