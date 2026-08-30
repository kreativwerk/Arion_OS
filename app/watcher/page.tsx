"use client";

import { useState } from "react";
import { Card, CardHeader, PageHeader, Button, Input, EmptyState, Row, Badge , ErrorNote } from "@/components/ui";
import { useTable } from "@/lib/client";

type Watcher = {
  id: number;
  name: string;
  url: string;
  hint: string;
  interval_minutes: number;
  last_checked: string | null;
  active: number;
};
type WEvent = { id: number; watcher_id: number; title: string; detail: string; seen: number; created_at: string };

export default function WatcherPage() {
  const watchers = useTable<Watcher>("watchers");
  const events = useTable<WEvent>("watcher_events");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [hint, setHint] = useState("");

  const unseen = events.rows.filter((e) => !e.seen);
  const watcherName = (id: number) => watchers.rows.find((w) => w.id === id)?.name ?? "";

  return (
    <div>
      <PageHeader
        title="Portale & Webseiten"
        subtitle="Watcher prüfen regelmäßig, ob es neue Aufgaben oder relevante Infos gibt"
      />

      <ErrorNote error={watchers.error || events.error} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
        <Card>
          <CardHeader title="Neue Meldungen" subtitle={`${unseen.length} ungelesen`} />
          {unseen.length === 0 && <EmptyState text="Keine neuen Meldungen von deinen Portalen." />}
          {unseen.map((e) => (
            <Row key={e.id}>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold">{e.title}</div>
                <div className="text-[12px] text-ink-2 mt-0.5">{e.detail}</div>
                <div className="text-[11px] text-ink-3 mt-1">{watcherName(e.watcher_id)}</div>
              </div>
              <Button variant="ghost" onClick={() => events.update(e.id, { seen: 1 } as Partial<WEvent>)}>
                OK
              </Button>
            </Row>
          ))}
        </Card>

        <Card>
          <CardHeader title="Überwachte Portale" />
          {watchers.rows.map((w) => (
            <Row key={w.id} className="group">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium">{w.name}</div>
                <a href={w.url} target="_blank" rel="noreferrer" className="text-[11px] text-accent truncate block">
                  {w.url}
                </a>
                {w.hint && <div className="text-[11px] text-ink-3">{w.hint}</div>}
              </div>
              <Badge>{w.interval_minutes >= 60 ? `alle ${Math.round(w.interval_minutes / 60)} h` : `alle ${w.interval_minutes} min`}</Badge>
              <button
                onClick={() => watchers.remove(w.id)}
                className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad text-[12px]"
              >
                ✕
              </button>
            </Row>
          ))}
          <div className="p-4 border-t border-line space-y-2">
            <Input placeholder="Name (z.B. Arval Portal)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Input placeholder="Worauf achten? (z.B. neue Aufgaben)" value={hint} onChange={(e) => setHint(e.target.value)} />
            <Button
              className="w-full"
              onClick={() => {
                if (!name.trim() || !url.trim()) return;
                watchers.create({ name: name.trim(), url: url.trim(), hint } as Partial<Watcher>);
                setName("");
                setUrl("");
                setHint("");
              }}
            >
              Portal hinzufügen
            </Button>
            <p className="text-[11px] text-ink-3 pt-1">
              Die automatische Prüfung (Headless-Browser + Login) ist als Ausbaustufe beschrieben in{" "}
              <code>docs/INTEGRATIONEN.md</code>. Meldungen können auch per API eingespeist werden.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
