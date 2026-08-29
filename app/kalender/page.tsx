"use client";

import { useState } from "react";
import { Card, PageHeader, Button, Input, EmptyState, Row, Badge } from "@/components/ui";
import { useTable, fmtDate, todayIso } from "@/lib/client";

type Ev = {
  id: number;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  notes: string;
  source: string;
};

export default function CalendarPage() {
  const { rows, create, remove } = useTable<Ev>("calendar_events");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayIso());
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");

  const add = async () => {
    if (!title.trim() || !date) return;
    await create({ title: title.trim(), date, start_time: start, end_time: end, location } as Partial<Ev>);
    setTitle("");
    setStart("");
    setEnd("");
    setLocation("");
  };

  const upcoming = rows.filter((e) => e.date >= todayIso());
  const past = rows.filter((e) => e.date < todayIso()).slice(-5);
  const byDate = new Map<string, Ev[]>();
  for (const e of upcoming) {
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  }

  return (
    <div>
      <PageHeader
        title="Kalender"
        subtitle="Eigene Einträge – externe Kalender (Google/Outlook via ICS) kommen als nächster Ausbauschritt"
      />

      <Card className="mb-5">
        <div className="p-4 grid grid-cols-1 md:grid-cols-[1fr_140px_100px_100px_160px_auto] gap-2.5 items-center">
          <Input
            placeholder="Neuer Termin …"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          <Input placeholder="Ort" value={location} onChange={(e) => setLocation(e.target.value)} />
          <Button onClick={add}>Eintragen</Button>
        </div>
      </Card>

      {upcoming.length === 0 && (
        <Card>
          <EmptyState text="Keine anstehenden Termine." />
        </Card>
      )}

      {[...byDate.entries()].map(([d, events]) => (
        <Card key={d} className="mb-4">
          <div className="px-5 pt-3.5 pb-1 flex items-center gap-2">
            <span className="text-[13px] font-semibold">
              {new Date(d + "T12:00:00").toLocaleDateString("de-DE", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </span>
            {d === todayIso() && <Badge tone="accent">Heute</Badge>}
          </div>
          {events.map((e) => (
            <Row key={e.id} className="group">
              <div className="text-[12px] text-ink-2 w-[92px] shrink-0">
                {e.start_time || "ganztägig"}
                {e.end_time ? `–${e.end_time}` : ""}
              </div>
              <div className="w-[3px] self-stretch rounded-full bg-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium">{e.title}</div>
                {e.location && <div className="text-[11px] text-ink-3">{e.location}</div>}
              </div>
              <button
                onClick={() => remove(e.id)}
                className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad text-[12px] transition-all"
              >
                Löschen
              </button>
            </Row>
          ))}
        </Card>
      ))}

      {past.length > 0 && (
        <Card className="opacity-60">
          <div className="px-5 pt-3 pb-1 text-[12px] font-semibold text-ink-3 uppercase tracking-wide">
            Vergangen
          </div>
          {past.map((e) => (
            <Row key={e.id}>
              <div className="text-[12px] text-ink-3 w-[92px]">{fmtDate(e.date)}</div>
              <div className="flex-1 text-[13px] text-ink-2">{e.title}</div>
            </Row>
          ))}
        </Card>
      )}
    </div>
  );
}
