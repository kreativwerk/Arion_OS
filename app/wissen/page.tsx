"use client";

import { useState } from "react";
import { Card, PageHeader, Button, Input, TextArea, Select, Segmented, EmptyState, Badge } from "@/components/ui";
import { useTable } from "@/lib/client";
import DocumentsSection from "@/components/DocumentsSection";

type Note = {
  id: number;
  title: string;
  body: string;
  scope: "persoenlich" | "unternehmen" | "partner";
  partner: string;
  tags: string;
  updated_at: string;
};

export default function KnowledgePage() {
  const { rows, create, remove } = useTable<Note>("knowledge_notes");
  const [scope, setScope] = useState<"alle" | "persoenlich" | "unternehmen" | "partner">("alle");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [newScope, setNewScope] = useState("persoenlich");
  const [partner, setPartner] = useState("");
  const [tags, setTags] = useState("");

  const partners = [...new Set(rows.filter((n) => n.partner).map((n) => n.partner))];

  const filtered = rows.filter((n) => {
    if (scope !== "alle" && n.scope !== scope) return false;
    if (query) {
      const q = query.toLowerCase();
      return [n.title, n.body, n.partner, n.tags].some((f) => f?.toLowerCase().includes(q));
    }
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Wissen"
        subtitle="Dein Wissen, das deiner Firma und ihrer Partner – durchsuchbar, auch für Jarvis"
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? "Schließen" : "Neuer Eintrag"}</Button>}
      />

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: "alle", label: "Alle" },
            { value: "persoenlich", label: "Persönlich" },
            { value: "unternehmen", label: "Unternehmen" },
            { value: "partner", label: "Partner" },
          ]}
        />
        <Input
          placeholder="Suchen … (z.B. Arval, Amazon, Onboarding)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="!w-[300px]"
        />
        {partners.map((p) => (
          <button key={p} onClick={() => setQuery(p)}>
            <Badge tone="accent">{p}</Badge>
          </button>
        ))}
      </div>

      {showForm && (
        <Card className="mb-5">
          <div className="p-4 space-y-2.5">
            <Input placeholder="Titel" value={title} onChange={(e) => setTitle(e.target.value)} />
            <TextArea placeholder="Inhalt …" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="flex gap-2.5 flex-wrap">
              <Select value={newScope} onChange={(e) => setNewScope(e.target.value)}>
                <option value="persoenlich">Persönlich</option>
                <option value="unternehmen">Unternehmen</option>
                <option value="partner">Partner</option>
              </Select>
              {newScope === "partner" && (
                <Input placeholder="Partner (z.B. Amazon)" value={partner} onChange={(e) => setPartner(e.target.value)} className="!w-[200px]" />
              )}
              <Input placeholder="Tags (kommagetrennt)" value={tags} onChange={(e) => setTags(e.target.value)} className="!w-[240px]" />
              <Button
                onClick={() => {
                  if (!title.trim()) return;
                  create({ title: title.trim(), body, scope: newScope, partner: newScope === "partner" ? partner : "", tags } as Partial<Note>);
                  setTitle("");
                  setBody("");
                  setPartner("");
                  setTags("");
                  setShowForm(false);
                }}
              >
                Speichern
              </Button>
            </div>
          </div>
        </Card>
      )}

      <DocumentsSection scope={scope} query={query} />

      {filtered.length === 0 && (
        <Card>
          <EmptyState text="Keine Einträge gefunden." />
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((n) => (
          <Card key={n.id} className="group">
            <div className="p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[14px] font-semibold">{n.title}</h3>
                <div className="flex gap-1.5 items-center shrink-0">
                  {n.partner ? (
                    <Badge tone="accent">{n.partner}</Badge>
                  ) : (
                    <Badge>{n.scope === "persoenlich" ? "persönlich" : n.scope}</Badge>
                  )}
                  <button
                    onClick={() => remove(n.id)}
                    className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad text-[12px]"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p className="text-[13px] text-ink-2 mt-2 leading-relaxed whitespace-pre-wrap">{n.body}</p>
              {n.tags && (
                <div className="flex gap-1.5 mt-3 flex-wrap">
                  {n.tags.split(",").map((t) => (
                    <span key={t} className="text-[11px] text-ink-3">
                      #{t.trim()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
