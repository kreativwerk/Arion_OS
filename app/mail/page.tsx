"use client";

import { useState } from "react";
import { Card, CardHeader, PageHeader, Button, Input, Select, EmptyState, Row, Badge , ErrorNote } from "@/components/ui";
import { useTable } from "@/lib/client";

type Mail = {
  id: number;
  account: string;
  from_addr: string;
  subject: string;
  summary: string;
  matched_rule: string;
  important: number;
  read: number;
  received_at: string;
};
type Rule = { id: number; kind: string; value: string };
type Account = { id: number; label: string; address: string; active: number };

export default function MailPage() {
  const mails = useTable<Mail>("mail_digest");
  const rules = useTable<Rule>("mail_rules");
  const accounts = useTable<Account>("mail_accounts");
  const [ruleKind, setRuleKind] = useState("absender");
  const [ruleValue, setRuleValue] = useState("");
  const [accLabel, setAccLabel] = useState("");
  const [accAddr, setAccAddr] = useState("");

  const unread = mails.rows.filter((m) => !m.read);
  const read = mails.rows.filter((m) => m.read).slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Mail-Digest"
        subtitle="Zusammenfassungen wichtiger Mails aus allen Postfächern – gefiltert nach deinen Regeln"
      />

      <ErrorNote error={mails.error || rules.error || accounts.error} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Ungelesen & wichtig" subtitle={`${unread.length} Mails`} />
            {unread.length === 0 && <EmptyState text="Alles gelesen." />}
            {unread.map((m) => (
              <Row key={m.id}>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold">{m.subject}</div>
                  <div className="text-[12px] text-ink-2 mt-0.5">{m.summary}</div>
                  <div className="text-[11px] text-ink-3 mt-1">
                    {m.from_addr} · {m.account} · <span className="text-accent">{m.matched_rule}</span>
                  </div>
                </div>
                <Button variant="ghost" onClick={() => mails.update(m.id, { read: 1 } as Partial<Mail>)}>
                  Gelesen
                </Button>
              </Row>
            ))}
          </Card>

          {read.length > 0 && (
            <Card className="opacity-60">
              <CardHeader title="Zuletzt gelesen" />
              {read.map((m) => (
                <Row key={m.id}>
                  <div className="flex-1 min-w-0 text-[13px] text-ink-2 truncate">{m.subject}</div>
                  <div className="text-[11px] text-ink-3">{m.from_addr}</div>
                </Row>
              ))}
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Postfächer" subtitle="Mehrere Konten möglich" />
            {accounts.rows.map((a) => (
              <Row key={a.id} className="group">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium">{a.label}</div>
                  <div className="text-[11px] text-ink-3 truncate">{a.address}</div>
                </div>
                <button
                  onClick={() => accounts.remove(a.id)}
                  className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad text-[12px]"
                >
                  Entfernen
                </button>
              </Row>
            ))}
            <div className="p-4 border-t border-line space-y-2">
              <Input placeholder="Bezeichnung (z.B. Geschäftlich)" value={accLabel} onChange={(e) => setAccLabel(e.target.value)} />
              <Input placeholder="E-Mail-Adresse" value={accAddr} onChange={(e) => setAccAddr(e.target.value)} />
              <Button
                className="w-full"
                onClick={() => {
                  if (!accLabel.trim() || !accAddr.trim()) return;
                  accounts.create({ label: accLabel.trim(), address: accAddr.trim() } as Partial<Account>);
                  setAccLabel("");
                  setAccAddr("");
                }}
              >
                Postfach hinzufügen
              </Button>
              <p className="text-[11px] text-ink-3 pt-1">
                IMAP-Zugangsdaten werden in <code>.env.local</code> hinterlegt – siehe{" "}
                <code>docs/INTEGRATIONEN.md</code>.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Wichtig-Regeln" subtitle="VIP-Absender und Stichwörter" />
            <div className="px-5 pb-3 flex flex-wrap gap-1.5">
              {rules.rows.map((r) => (
                <button
                  key={r.id}
                  onClick={() => rules.remove(r.id)}
                  title="Klicken zum Entfernen"
                  className="group"
                >
                  <Badge tone={r.kind === "absender" ? "accent" : "warn"}>
                    {r.kind === "absender" ? "@" : "#"} {r.value} ✕
                  </Badge>
                </button>
              ))}
            </div>
            <div className="p-4 border-t border-line flex gap-2">
              <Select value={ruleKind} onChange={(e) => setRuleKind(e.target.value)}>
                <option value="absender">Absender</option>
                <option value="stichwort">Stichwort</option>
              </Select>
              <Input
                placeholder={ruleKind === "absender" ? "z.B. arval.de" : "z.B. Rechnung"}
                value={ruleValue}
                onChange={(e) => setRuleValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ruleValue.trim()) {
                    rules.create({ kind: ruleKind, value: ruleValue.trim() } as Partial<Rule>);
                    setRuleValue("");
                  }
                }}
              />
              <Button
                onClick={() => {
                  if (!ruleValue.trim()) return;
                  rules.create({ kind: ruleKind, value: ruleValue.trim() } as Partial<Rule>);
                  setRuleValue("");
                }}
              >
                +
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
