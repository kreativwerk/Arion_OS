"use client";

import { useEffect, useState } from "react";
import { Card, PageHeader, Button, Input, EmptyState, Icon, MaybeIcon } from "@/components/ui";
import { useTable, todayIso } from "@/lib/client";

type Habit = { id: number; name: string; emoji: string; target_per_week: number };
type Log = { habit_id: number; date: string };

function lastDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

export default function HabitsPage() {
  const { rows: habits, create, remove } = useTable<Habit>("habits");
  const [logs, setLogs] = useState<Log[]>([]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("check_circle");

  const days = lastDays(7);

  const loadLogs = async () => {
    const res = await fetch("/api/habits/toggle", { cache: "no-store" });
    if (res.ok) setLogs(await res.json());
  };
  useEffect(() => {
    loadLogs();
  }, []);

  const toggle = async (habit_id: number, date: string) => {
    await fetch("/api/habits/toggle", { method: "POST", body: JSON.stringify({ habit_id, date }) });
    loadLogs();
  };

  const has = (h: number, d: string) => logs.some((l) => l.habit_id === h && l.date === d);
  const weekCount = (h: number) => days.filter((d) => has(h, d)).length;

  const streak = (h: number) => {
    let s = 0;
    const d = new Date();
    if (!has(h, todayIso())) d.setDate(d.getDate() - 1);
    while (has(h, d.toISOString().slice(0, 10))) {
      s++;
      d.setDate(d.getDate() - 1);
    }
    return s;
  };

  return (
    <div>
      <PageHeader title="Gewohnheiten" subtitle="Die letzten 7 Tage im Überblick" />

      <Card className="mb-5">
        <div className="p-4 flex gap-2.5 items-center">
          <Input
            className="!w-44 text-center"
            title="Material-Icon-Name, z.B. directions_run"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
          />
          <Input
            placeholder="Neue Gewohnheit …"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && (create({ name: name.trim(), emoji } as Partial<Habit>), setName(""))}
          />
          <Button
            onClick={() => {
              if (!name.trim()) return;
              create({ name: name.trim(), emoji } as Partial<Habit>);
              setName("");
            }}
          >
            Hinzufügen
          </Button>
        </div>
      </Card>

      <Card>
        {habits.length === 0 && <EmptyState text="Noch keine Gewohnheiten angelegt." />}
        {habits.length > 0 && (
          <div className="p-5 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[11px] text-ink-3">
                  <th className="text-left font-medium pb-3">Gewohnheit</th>
                  {days.map((d) => (
                    <th key={d} className={`font-medium pb-3 w-12 ${d === todayIso() ? "text-accent" : ""}`}>
                      {new Date(d + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short" })}
                    </th>
                  ))}
                  <th className="font-medium pb-3 text-right">Serie</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody>
                {habits.map((h) => (
                  <tr key={h.id} className="border-t border-line group">
                    <td className="py-3 text-[13px] font-medium">
                      <MaybeIcon value={h.emoji} size={17} className="mr-2 text-ink-2" />
                      {h.name}
                      <span className="text-[11px] text-ink-3 ml-2">
                        {weekCount(h.id)}/{h.target_per_week ?? 7}
                      </span>
                    </td>
                    {days.map((d) => (
                      <td key={d} className="text-center py-3">
                        <button
                          onClick={() => toggle(h.id, d)}
                          className={`w-7 h-7 rounded-[9px] border transition-all text-[13px] ${
                            has(h.id, d)
                              ? "bg-good border-good text-white"
                              : "bg-inset border-line hover:border-ink-3"
                          }`}
                        >
                          {has(h.id, d) ? "✓" : ""}
                        </button>
                      </td>
                    ))}
                    <td className="text-right text-[13px] font-semibold">
                      {streak(h.id) > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="local_fire_department" size={15} className="text-warn" />
                          {streak(h.id)}
                        </span>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="text-right pl-3">
                      <button
                        onClick={() => remove(h.id)}
                        className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad text-[12px] transition-all"
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
