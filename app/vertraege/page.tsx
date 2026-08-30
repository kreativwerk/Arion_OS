"use client";

import { useState } from "react";
import { Card, PageHeader, Button, Input, Select, EmptyState, Badge , ErrorNote } from "@/components/ui";
import { useTable, fmtDate } from "@/lib/client";

type Contract = {
  id: number;
  name: string;
  provider: string;
  category: string;
  policy_number: string;
  annual_cost: number;
  start_date: string | null;
  end_date: string | null;
  cancel_period_days: number;
  notes: string;
};

function daysUntilCancelDeadline(c: Contract): number | null {
  if (!c.end_date) return null;
  const deadline = new Date(c.end_date);
  deadline.setDate(deadline.getDate() - (c.cancel_period_days ?? 0));
  return Math.floor((deadline.getTime() - Date.now()) / 86400000);
}

export default function ContractsPage() {
  const { rows, create, remove, error } = useTable<Contract>("contracts");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    provider: "",
    category: "Versicherung",
    policy_number: "",
    annual_cost: "",
    end_date: "",
    cancel_period_days: "90",
    notes: "",
  });

  const totalCost = rows.reduce((s, c) => s + (c.annual_cost || 0), 0);

  return (
    <div>
      <PageHeader
        title="Verträge"
        subtitle={`${rows.length} Verträge · ${totalCost.toLocaleString("de-DE")} € pro Jahr`}
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? "Schließen" : "Neuer Vertrag"}</Button>}
      />

      <ErrorNote error={error} />

      {showForm && (
        <Card className="mb-5">
          <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-2.5">
            <Input placeholder="Vertragsname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Anbieter" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option>Versicherung</option>
              <option>Leasing</option>
              <option>Miete</option>
              <option>Software</option>
              <option>Sonstiges</option>
            </Select>
            <Input placeholder="Vertrags-/Policennr." value={form.policy_number} onChange={(e) => setForm({ ...form, policy_number: e.target.value })} />
            <Input placeholder="Kosten €/Jahr" type="number" value={form.annual_cost} onChange={(e) => setForm({ ...form, annual_cost: e.target.value })} />
            <Input type="date" title="Laufzeitende" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            <Input placeholder="Kündigungsfrist (Tage)" type="number" value={form.cancel_period_days} onChange={(e) => setForm({ ...form, cancel_period_days: e.target.value })} />
            <Button
              onClick={() => {
                if (!form.name.trim()) return;
                create({
                  name: form.name.trim(),
                  provider: form.provider,
                  category: form.category,
                  policy_number: form.policy_number,
                  annual_cost: Number(form.annual_cost) || 0,
                  end_date: form.end_date || null,
                  cancel_period_days: Number(form.cancel_period_days) || 0,
                  notes: form.notes,
                } as Partial<Contract>);
                setShowForm(false);
                setForm({ ...form, name: "", provider: "", policy_number: "", annual_cost: "", end_date: "" });
              }}
            >
              Speichern
            </Button>
          </div>
        </Card>
      )}

      <Card>
        {rows.length === 0 && <EmptyState text="Noch keine Verträge hinterlegt." />}
        {rows.length > 0 && (
          <div className="p-5 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[11px] text-ink-3 text-left">
                  <th className="font-medium pb-3">Vertrag</th>
                  <th className="font-medium pb-3">Kategorie</th>
                  <th className="font-medium pb-3">Nummer</th>
                  <th className="font-medium pb-3 text-right">€/Jahr</th>
                  <th className="font-medium pb-3">Läuft bis</th>
                  <th className="font-medium pb-3">Kündigung</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const days = daysUntilCancelDeadline(c);
                  return (
                    <tr key={c.id} className="border-t border-line group">
                      <td className="py-3.5">
                        <div className="text-[13px] font-medium">{c.name}</div>
                        <div className="text-[11px] text-ink-3">{c.provider}</div>
                      </td>
                      <td className="text-[12px] text-ink-2">{c.category}</td>
                      <td className="text-[12px] text-ink-2">{c.policy_number || "–"}</td>
                      <td className="text-[13px] text-right font-medium">
                        {c.annual_cost ? c.annual_cost.toLocaleString("de-DE") : "–"}
                      </td>
                      <td className="text-[12px] text-ink-2">{fmtDate(c.end_date)}</td>
                      <td>
                        {days === null ? (
                          <Badge>unbefristet</Badge>
                        ) : days < 0 ? (
                          <Badge tone="bad">Frist vorbei</Badge>
                        ) : days < 30 ? (
                          <Badge tone="warn">noch {days} Tage</Badge>
                        ) : (
                          <Badge tone="good">noch {days} Tage</Badge>
                        )}
                      </td>
                      <td className="text-right pl-3">
                        <button
                          onClick={() => remove(c.id)}
                          className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad text-[12px]"
                        >
                          Löschen
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-[12px] text-ink-3 mt-3 px-1">
        „Kündigung" zeigt, wie viele Tage bleiben, um die Kündigungsfrist noch einzuhalten. Vertragsdokumente
        (PDF-Ablage) sind als Ausbaustufe vorgesehen.
      </p>
    </div>
  );
}
