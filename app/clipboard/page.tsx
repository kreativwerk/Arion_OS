"use client";

import { useState } from "react";
import { Card, PageHeader, Button, Input, TextArea, EmptyState, Icon } from "@/components/ui";
import { useTable } from "@/lib/client";

type Clip = { id: number; content: string; label: string; pinned: number; created_at: string };

export default function ClipboardPage() {
  const { rows, create, update, remove } = useTable<Clip>("clipboard_items");
  const [content, setContent] = useState("");
  const [label, setLabel] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const copy = async (c: Clip) => {
    await navigator.clipboard.writeText(c.content);
    setCopiedId(c.id);
    setTimeout(() => setCopiedId(null), 1200);
  };

  return (
    <div>
      <PageHeader
        title="Clipboard"
        subtitle="Textbausteine, Nummern und Links – ein Klick kopiert"
      />

      <Card className="mb-5">
        <div className="p-4 space-y-2.5">
          <TextArea
            placeholder="Neuer Eintrag … (IBAN, Kundennummer, Link, Textbaustein)"
            rows={2}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="flex gap-2.5">
            <Input placeholder="Bezeichnung (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <Button
              onClick={() => {
                if (!content.trim()) return;
                create({ content: content.trim(), label: label.trim() } as Partial<Clip>);
                setContent("");
                setLabel("");
              }}
            >
              Speichern
            </Button>
          </div>
        </div>
      </Card>

      {rows.length === 0 && (
        <Card>
          <EmptyState text="Noch nichts gespeichert." />
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map((c) => (
          <Card key={c.id} className="group">
            <div className="p-4">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[12px] font-semibold text-ink-2 inline-flex items-center gap-1.5">
                  {c.pinned ? <Icon name="push_pin" size={14} className="text-accent" /> : null}
                  {c.label || "Ohne Titel"}
                </span>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={() => update(c.id, { pinned: c.pinned ? 0 : 1 } as Partial<Clip>)}
                    className="text-[12px] text-ink-3 hover:text-ink"
                  >
                    {c.pinned ? "Lösen" : "Anpinnen"}
                  </button>
                  <button onClick={() => remove(c.id)} className="text-[12px] text-ink-3 hover:text-bad">
                    Löschen
                  </button>
                </div>
              </div>
              <button
                onClick={() => copy(c)}
                className="w-full text-left bg-inset rounded-[10px] px-3.5 py-2.5 text-[13px] font-mono break-all hover:ring-2 hover:ring-accent/30 transition-all"
                title="Klicken zum Kopieren"
              >
                {copiedId === c.id ? <span className="text-good font-sans">✓ Kopiert</span> : c.content}
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
