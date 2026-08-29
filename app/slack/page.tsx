"use client";

import { useState } from "react";
import { Card, CardHeader, PageHeader, Button, Input, EmptyState, Row, Badge } from "@/components/ui";
import { useTable } from "@/lib/client";

type Rule = { id: number; person: string; note: string };
type Notif = {
  id: number;
  from_person: string;
  channel: string;
  text: string;
  important: number;
  read: number;
  created_at: string;
};

export default function SlackPage() {
  const rules = useTable<Rule>("slack_rules");
  const notifs = useTable<Notif>("slack_notifications");
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");

  const unread = notifs.rows.filter((n) => !n.read);
  const read = notifs.rows.filter((n) => n.read).slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Slack"
        subtitle="Benachrichtigungen – nur von Personen, die dir wichtig sind"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Ungelesen" subtitle={`${unread.length} Nachrichten`} />
            {unread.length === 0 && <EmptyState text="Nichts Wichtiges verpasst." />}
            {unread.map((n) => (
              <Row key={n.id}>
                <div className="w-8 h-8 rounded-full bg-accent-soft text-accent flex items-center justify-center text-[13px] font-semibold shrink-0">
                  {n.from_person.slice(0, 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px]">{n.text}</div>
                  <div className="text-[11px] text-ink-3 mt-0.5">
                    {n.from_person} · {n.channel}
                  </div>
                </div>
                <Button variant="ghost" onClick={() => notifs.update(n.id, { read: 1 } as Partial<Notif>)}>
                  Gelesen
                </Button>
              </Row>
            ))}
          </Card>
          {read.length > 0 && (
            <Card className="opacity-60">
              <CardHeader title="Zuletzt gelesen" />
              {read.map((n) => (
                <Row key={n.id}>
                  <div className="flex-1 text-[13px] text-ink-2 truncate">{n.text}</div>
                  <div className="text-[11px] text-ink-3">{n.from_person}</div>
                </Row>
              ))}
            </Card>
          )}
        </div>

        <Card>
          <CardHeader title="Wichtige Personen" subtitle="Nur deren Nachrichten landen hier" />
          <div className="px-5 pb-3 space-y-1.5">
            {rules.rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2 group">
                <Badge tone="accent">{r.person}</Badge>
                {r.note && <span className="text-[11px] text-ink-3">{r.note}</span>}
                <button
                  onClick={() => rules.remove(r.id)}
                  className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad text-[12px] ml-auto"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-line space-y-2">
            <Input placeholder="Name der Person" value={person} onChange={(e) => setPerson(e.target.value)} />
            <Input placeholder="Notiz (z.B. Standortleiter)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button
              className="w-full"
              onClick={() => {
                if (!person.trim()) return;
                rules.create({ person: person.trim(), note } as Partial<Rule>);
                setPerson("");
                setNote("");
              }}
            >
              Hinzufügen
            </Button>
            <p className="text-[11px] text-ink-3 pt-1">
              Die Live-Anbindung läuft über eine Slack-App (Events API) – eingerichtet wie in{" "}
              <code>docs/INTEGRATIONEN.md</code> beschrieben.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
