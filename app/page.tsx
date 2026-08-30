"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, Badge, EmptyState, Row, Icon } from "@/components/ui";
import { fmtDate, todayIso } from "@/lib/client";

type Dash = {
  config: Record<string, string>;
  inboxCount: number;
  counts: { slack: number; mail: number; letters: number; watcher: number };
  tasksToday: { id: number; title: string; priority: number; recurrence: string | null; project: string; source: string; submitted_by: string }[];
  habits: { id: number; name: string; emoji: string }[];
  habitLogsToday: { habit_id: number }[];
  events: { id: number; title: string; date: string; start_time: string; end_time: string; location: string }[];
  contractsDue: { id: number; name: string; provider: string; days_to_cancel: number }[];
};

const TILES = [
  { key: "slack", label: "Benachrichtigungen", icon: "notifications", href: "/slack" },
  { key: "mail", label: "Mail", icon: "mail", href: "/mail" },
  { key: "letters", label: "Briefpost", icon: "markunread_mailbox", href: "/post" },
  { key: "watcher", label: "Portale", icon: "travel_explore", href: "/watcher" },
] as const;

export default function TodayPage() {
  const [data, setData] = useState<Dash | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const quickRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const res = await fetch("/api/dashboard", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  };
  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (quickAdd) quickRef.current?.focus();
  }, [quickAdd]);

  const completeTask = async (id: number) => {
    await fetch("/api/tasks/complete", { method: "POST", body: JSON.stringify({ id }) });
    reload();
  };
  const toggleHabit = async (habit_id: number) => {
    await fetch("/api/habits/toggle", { method: "POST", body: JSON.stringify({ habit_id, date: todayIso() }) });
    reload();
  };
  const addQuickTask = async () => {
    const title = quickTitle.trim();
    if (!title) return;
    setQuickTitle("");
    await fetch("/api/data/tasks", {
      method: "POST",
      body: JSON.stringify({ title, horizon: "short", due_date: todayIso(), priority: 2 }),
    });
    reload();
  };

  const now = new Date();
  const evening = now.getHours() >= 17;
  const greeting = now.getHours() < 11 ? "Guten Morgen" : !evening ? "Guten Tag" : "Guten Abend";
  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

  if (!data) return <p className="text-ink-3 text-[13px]">Lade …</p>;

  const doneHabits = new Set(data.habitLogsToday.map((l) => l.habit_id));
  const eventsToday = data.events.filter((e) => e.date === todayIso());
  const summary = evening
    ? `Noch offen: ${data.tasksToday.length} ${data.tasksToday.length === 1 ? "Aufgabe" : "Aufgaben"} · Gewohnheiten ${doneHabits.size}/${data.habits.length}`
    : `${data.tasksToday.length} ${data.tasksToday.length === 1 ? "Aufgabe" : "Aufgaben"} · ${eventsToday.length} ${eventsToday.length === 1 ? "Termin" : "Termine"} heute · ${data.counts.mail + data.counts.letters + data.counts.slack + data.counts.watcher} Neues im Posteingang`;

  return (
    <div>
      {/* Kopf: Orientierung in einer Sekunde */}
      <div className="mb-6">
        <h1 className="text-[26px] sm:text-[32px] font-bold tracking-tight">
          {greeting}
          {data.config?.user_name ? `, ${data.config.user_name}` : ""}.
        </h1>
        <p className="text-[14px] text-ink-2 mt-1">
          {dateStr} · {summary}
        </p>
        {data.inboxCount > 0 && (
          <Link
            href="/aufgaben"
            className="inline-flex items-center gap-2 mt-3 px-3.5 h-8 rounded-full bg-accent-soft text-accent text-[13px] font-medium"
          >
            <Icon name="inbox" size={16} /> {data.inboxCount} neue{" "}
            {data.inboxCount === 1 ? "Aufgabe" : "Aufgaben"} von Mitarbeitern im Eingang →
          </Link>
        )}
      </div>

      {/* Triage: 4 Kacheln */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {TILES.map((t) => {
          const n = data.counts[t.key];
          const active = n > 0;
          return (
            <Link
              key={t.key}
              href={t.href}
              className={`bg-card border rounded-card p-4 transition-all hover:border-accent/40 ${
                active ? "border-line" : "border-line opacity-70"
              }`}
            >
              <div className="flex items-start justify-between">
                <div
                  className={`w-9 h-9 rounded-[11px] flex items-center justify-center ${
                    active ? "bg-accent-soft text-accent" : "bg-inset text-ink-3"
                  }`}
                >
                  <Icon name={t.icon} size={20} />
                </div>
                <span className={`text-[26px] font-bold leading-none ${active ? "" : "text-ink-3"}`}>
                  {n}
                </span>
              </div>
              <div className="text-[12px] text-ink-2 mt-3">{t.label}</div>
              <div className="text-[11px] text-ink-3">{active ? "ungelesen" : "alles erledigt"}</div>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Fokus: Aufgaben heute mit Quick-Add */}
        <Card className="lg:row-span-2 flex flex-col">
          <CardHeader
            title={evening ? "Noch offen heute" : "Heute fällig"}
            subtitle={`${data.tasksToday.length} ${data.tasksToday.length === 1 ? "Aufgabe" : "Aufgaben"}`}
            action={
              <div className="flex items-center gap-1">
                <Link href="/aufgaben" className="text-[12px] text-accent px-2">
                  Alle →
                </Link>
                <button
                  onClick={() => setQuickAdd(!quickAdd)}
                  className="w-8 h-8 rounded-full bg-accent text-on-accent flex items-center justify-center hover:opacity-90 transition-all"
                  aria-label="Aufgabe hinzufügen"
                >
                  <Icon name={quickAdd ? "close" : "add"} size={20} />
                </button>
              </div>
            }
          />
          {quickAdd && (
            <div className="px-5 pb-3">
              <input
                ref={quickRef}
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQuickTask()}
                placeholder="Neue Aufgabe für heute … (Enter)"
                className="w-full h-10 px-3.5 rounded-[10px] bg-inset border border-accent/40 text-[13px] outline-none focus:ring-2 focus:ring-accent/20 transition-all"
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto max-h-[340px]">
            {data.tasksToday.length === 0 && <EmptyState text="Nichts fällig – freier Kopf." />}
            {data.tasksToday.map((t) => (
              <Row key={t.id}>
                <button
                  onClick={() => completeTask(t.id)}
                  className="w-[19px] h-[19px] rounded-full border-[1.5px] border-ink-3 hover:border-accent hover:bg-accent-soft transition-all shrink-0"
                  aria-label="Erledigt"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{t.title}</div>
                  <div className="text-[11px] text-ink-3">
                    {t.project || " "}
                    {t.source !== "eigen" && t.submitted_by ? ` · von ${t.submitted_by}` : ""}
                  </div>
                </div>
                {t.recurrence && <Icon name="autorenew" size={15} className="text-ink-3" />}
                {t.priority === 1 && <Badge tone="bad">hoch</Badge>}
              </Row>
            ))}
          </div>
        </Card>

        {/* Rhythmus: Gewohnheiten */}
        <Card>
          <CardHeader
            title="Gewohnheiten"
            subtitle={`${doneHabits.size} von ${data.habits.length} heute`}
            action={<Link href="/gewohnheiten" className="text-[12px] text-accent">Details →</Link>}
          />
          <div className="px-5 pb-4 pt-1 flex flex-wrap gap-2">
            {data.habits.map((h) => {
              const done = doneHabits.has(h.id);
              return (
                <button
                  key={h.id}
                  onClick={() => toggleHabit(h.id)}
                  className={`flex items-center gap-2 px-3.5 h-9 rounded-full border text-[13px] font-medium transition-all ${
                    done
                      ? "bg-accent-soft border-accent/30 text-accent"
                      : "bg-inset border-line text-ink-2 hover:border-ink-3"
                  }`}
                >
                  {/^[a-z0-9_]+$/.test(h.emoji) ? <Icon name={h.emoji} size={17} /> : <span>{h.emoji}</span>}
                  {h.name}
                  {done && <Icon name="check" size={15} />}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Rhythmus: Termine */}
        <Card>
          <CardHeader
            title="Nächste Termine"
            action={<Link href="/kalender" className="text-[12px] text-accent">Kalender →</Link>}
          />
          {data.events.length === 0 && <EmptyState text="Keine anstehenden Termine." />}
          {data.events.slice(0, 4).map((e) => (
            <Row key={e.id}>
              <div className="text-[12px] text-ink-2 w-[96px] shrink-0">
                {e.date === todayIso() ? "Heute" : fmtDate(e.date)}
                <div className="text-ink-3">{e.start_time}{e.end_time ? `–${e.end_time}` : ""}</div>
              </div>
              <div className="w-[3px] self-stretch rounded-full bg-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{e.title}</div>
                {e.location && <div className="text-[11px] text-ink-3 truncate">{e.location}</div>}
              </div>
            </Row>
          ))}
        </Card>
      </div>

      {/* Risiken: Vertragsfristen */}
      {data.contractsDue.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="Verträge im Blick"
            subtitle="Kündigungsfenster, die bald schließen"
            action={<Link href="/vertraege" className="text-[12px] text-accent">Alle →</Link>}
          />
          {data.contractsDue.map((c) => (
            <Row key={c.id}>
              <Icon name="contract" size={18} className="text-ink-3" />
              <div className="flex-1 min-w-0">
                <span className="text-[13px] font-medium">{c.name}</span>
                <span className="text-[12px] text-ink-3 ml-2 hidden sm:inline">{c.provider}</span>
              </div>
              <Badge tone={c.days_to_cancel < 0 ? "bad" : c.days_to_cancel < 21 ? "warn" : "neutral"}>
                {c.days_to_cancel < 0 ? "Frist abgelaufen" : `noch ${c.days_to_cancel} Tage kündbar`}
              </Badge>
            </Row>
          ))}
        </Card>
      )}
    </div>
  );
}
