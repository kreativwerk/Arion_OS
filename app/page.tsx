"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, Badge, EmptyState, Row, Icon, MaybeIcon } from "@/components/ui";
import { fmtDate, todayIso } from "@/lib/client";

type Dash = {
  config: Record<string, string>;
  inboxCount: number;
  tasksToday: { id: number; title: string; priority: number; recurrence: string | null; project: string }[];
  habits: { id: number; name: string; emoji: string }[];
  habitLogsToday: { habit_id: number }[];
  events: { id: number; title: string; date: string; start_time: string; end_time: string; location: string }[];
  mails: { id: number; from_addr: string; subject: string; summary: string; account: string }[];
  letters: { id: number; subject: string; sender: string; status: string; summary: string }[];
  watcherEvents: { id: number; title: string; detail: string; watcher_name: string }[];
  slack: { id: number; from_person: string; channel: string; text: string }[];
  contractsDue: { id: number; name: string; provider: string; days_to_cancel: number }[];
};

export default function TodayPage() {
  const [data, setData] = useState<Dash | null>(null);

  const reload = async () => {
    const res = await fetch("/api/dashboard", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  };
  useEffect(() => {
    reload();
  }, []);

  const completeTask = async (id: number) => {
    await fetch("/api/tasks/complete", { method: "POST", body: JSON.stringify({ id }) });
    reload();
  };
  const toggleHabit = async (habit_id: number) => {
    await fetch("/api/habits/toggle", { method: "POST", body: JSON.stringify({ habit_id, date: todayIso() }) });
    reload();
  };

  const now = new Date();
  const greeting = now.getHours() < 11 ? "Guten Morgen" : now.getHours() < 18 ? "Guten Tag" : "Guten Abend";
  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  if (!data) return <p className="text-ink-3 text-[13px]">Lade …</p>;
  const doneHabits = new Set(data.habitLogsToday.map((l) => l.habit_id));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[32px] font-bold tracking-tight">
          {greeting}
          {data.config?.user_name ? `, ${data.config.user_name}` : ""}.
        </h1>
        <p className="text-[15px] text-ink-2 mt-1">{dateStr}</p>
        {data.inboxCount > 0 && (
          <Link href="/aufgaben" className="inline-flex items-center gap-2 mt-3 px-3.5 h-8 rounded-full bg-accent-soft text-accent text-[13px] font-medium">
            <Icon name="inbox" size={16} /> {data.inboxCount} neue{" "}
            {data.inboxCount === 1 ? "Aufgabe" : "Aufgaben"} von Mitarbeitern im Eingang →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader
            title="Heute fällig"
            subtitle={`${data.tasksToday.length} ${data.tasksToday.length === 1 ? "Aufgabe" : "Aufgaben"}`}
            action={<Link href="/aufgaben" className="text-[12px] text-accent">Alle →</Link>}
          />
          {data.tasksToday.length === 0 && <EmptyState text="Nichts fällig – freier Kopf." />}
          {data.tasksToday.map((t) => (
            <Row key={t.id}>
              <button
                onClick={() => completeTask(t.id)}
                className="w-[18px] h-[18px] rounded-full border-[1.5px] border-ink-3 hover:border-accent hover:bg-accent-soft transition-all shrink-0"
                aria-label="Erledigt"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{t.title}</div>
                {t.project && <div className="text-[11px] text-ink-3">{t.project}</div>}
              </div>
              {t.recurrence && <Badge>wiederkehrend</Badge>}
              {t.priority === 1 && <Badge tone="bad">hoch</Badge>}
            </Row>
          ))}
        </Card>

        <Card>
          <CardHeader
            title="Gewohnheiten heute"
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
                      ? "bg-good/15 border-good/30 text-good"
                      : "bg-inset border-line text-ink-2 hover:border-ink-3"
                  }`}
                >
                  <MaybeIcon value={h.emoji} size={17} />
                  {h.name}
                  {done && <span>✓</span>}
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Nächste Termine"
            action={<Link href="/kalender" className="text-[12px] text-accent">Kalender →</Link>}
          />
          {data.events.length === 0 && <EmptyState text="Keine anstehenden Termine." />}
          {data.events.map((e) => (
            <Row key={e.id}>
              <div className="text-[12px] text-ink-2 w-[110px] shrink-0">
                {fmtDate(e.date)}
                <div className="text-ink-3">{e.start_time}{e.end_time ? `–${e.end_time}` : ""}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{e.title}</div>
                {e.location && <div className="text-[11px] text-ink-3">{e.location}</div>}
              </div>
            </Row>
          ))}
        </Card>

        <Card>
          <CardHeader
            title="Wichtige Mails"
            subtitle="Nur VIP-Absender & Stichwörter"
            action={<Link href="/mail" className="text-[12px] text-accent">Digest →</Link>}
          />
          {data.mails.length === 0 && <EmptyState text="Keine wichtigen ungelesenen Mails." />}
          {data.mails.map((m) => (
            <Row key={m.id}>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{m.subject}</div>
                <div className="text-[12px] text-ink-2 truncate">{m.summary}</div>
                <div className="text-[11px] text-ink-3 mt-0.5">{m.from_addr} · {m.account}</div>
              </div>
            </Row>
          ))}
        </Card>

        <Card>
          <CardHeader
            title="Briefpost"
            subtitle="Digital zugestellt"
            action={<Link href="/post" className="text-[12px] text-accent">Alle →</Link>}
          />
          {data.letters.length === 0 && <EmptyState text="Keine neue Post." />}
          {data.letters.map((l) => (
            <Row key={l.id}>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{l.subject}</div>
                <div className="text-[11px] text-ink-3">{l.sender}</div>
              </div>
              <Badge tone={l.status === "aktion" ? "warn" : "accent"}>{l.status}</Badge>
            </Row>
          ))}
        </Card>

        <Card>
          <CardHeader title="Portale & Slack" subtitle="Neues aus Watchern und wichtigen Personen" />
          {data.watcherEvents.length === 0 && data.slack.length === 0 && (
            <EmptyState text="Keine neuen Meldungen." />
          )}
          {data.watcherEvents.map((w) => (
            <Row key={`w${w.id}`}>
              <Icon name="travel_explore" className="text-ink-2" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{w.title}</div>
                <div className="text-[11px] text-ink-3">{w.watcher_name}</div>
              </div>
            </Row>
          ))}
          {data.slack.map((s) => (
            <Row key={`s${s.id}`}>
              <Icon name="forum" className="text-ink-2" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{s.text}</div>
                <div className="text-[11px] text-ink-3">{s.from_person} · {s.channel}</div>
              </div>
            </Row>
          ))}
        </Card>

        {data.contractsDue.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader
              title="Verträge im Blick"
              subtitle="Kündigungsfenster, die bald schließen"
              action={<Link href="/vertraege" className="text-[12px] text-accent">Alle Verträge →</Link>}
            />
            {data.contractsDue.map((c) => (
              <Row key={c.id}>
                <div className="flex-1">
                  <span className="text-[13px] font-medium">{c.name}</span>
                  <span className="text-[12px] text-ink-3 ml-2">{c.provider}</span>
                </div>
                <Badge tone={c.days_to_cancel < 0 ? "bad" : c.days_to_cancel < 21 ? "warn" : "neutral"}>
                  {c.days_to_cancel < 0
                    ? "Frist abgelaufen"
                    : `Kündigung in ${c.days_to_cancel} Tagen möglich`}
                </Badge>
              </Row>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
