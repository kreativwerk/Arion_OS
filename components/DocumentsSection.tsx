"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardHeader, Button, Input, Select, Badge, EmptyState, Icon, Row } from "@/components/ui";
import { fmtDate } from "@/lib/client";

type Doc = {
  id: number;
  title: string;
  filename: string;
  mime: string;
  size: number;
  category: string;
  scope: string;
  partner: string;
  tags: string;
  note: string;
  created_at: string;
};

const CATEGORIES = ["Wartungsvertrag", "Versicherung", "Leasing", "Handbuch", "Zertifikat", "Rechnungsvorlage", "Allgemein"];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(mime: string): string {
  if (mime.includes("pdf")) return "picture_as_pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) return "table";
  if (mime.includes("word") || mime.includes("document")) return "docs";
  return "draft";
}

export default function DocumentsSection({ scope, query }: { scope: string; query: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Wartungsvertrag");
  const [docScope, setDocScope] = useState("unternehmen");
  const [partner, setPartner] = useState("");
  const [tags, setTags] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const res = await fetch("/api/documents", { cache: "no-store" });
    if (res.ok) setDocs(await res.json());
  };
  useEffect(() => {
    load();
  }, []);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Bitte eine Datei auswählen.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("title", title || file.name);
    form.append("category", category);
    form.append("scope", docScope);
    form.append("partner", partner);
    form.append("tags", tags);
    const res = await fetch("/api/documents", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Upload fehlgeschlagen.");
      return;
    }
    setTitle("");
    setPartner("");
    setTags("");
    if (fileRef.current) fileRef.current.value = "";
    setShowForm(false);
    load();
  };

  const remove = async (id: number) => {
    await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
    load();
  };

  const filtered = docs.filter((doc) => {
    if (scope !== "alle" && doc.scope !== scope) return false;
    if (query) {
      const q = query.toLowerCase();
      return [doc.title, doc.filename, doc.category, doc.partner, doc.tags, doc.note].some((f) =>
        f?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <Card className="mb-5">
      <CardHeader
        title="Dokumente"
        subtitle="Wartungsverträge, Policen, Handbücher – abgelegt und durchsuchbar, auch für Arion Bot"
        action={
          <Button variant="ghost" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Schließen" : "Hochladen"}
          </Button>
        }
      />

      {showForm && (
        <div className="px-5 pb-4 space-y-2.5 border-b border-line">
          <input
            ref={fileRef}
            type="file"
            className="block w-full text-[13px] text-ink-2 file:mr-3 file:px-3.5 file:h-8 file:rounded-full file:border-0 file:bg-accent file:text-on-accent file:text-[13px] file:font-medium file:cursor-pointer bg-inset border border-line rounded-[10px] p-2"
          />
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_160px_160px] gap-2.5">
            <Input placeholder="Titel (sonst Dateiname)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <Select value={docScope} onChange={(e) => setDocScope(e.target.value)}>
              <option value="persoenlich">Persönlich</option>
              <option value="unternehmen">Unternehmen</option>
              <option value="partner">Partner</option>
            </Select>
            {docScope === "partner" ? (
              <Input placeholder="Partner (z.B. Arval)" value={partner} onChange={(e) => setPartner(e.target.value)} />
            ) : (
              <Input placeholder="Tags (kommagetrennt)" value={tags} onChange={(e) => setTags(e.target.value)} />
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={upload} disabled={busy}>
              {busy ? "Lädt hoch …" : "Ablegen"}
            </Button>
            {error && <span className="text-[12px] text-bad">{error}</span>}
            <span className="text-[11px] text-ink-3 ml-auto">max. 4 MB pro Datei</span>
          </div>
        </div>
      )}

      {filtered.length === 0 && <EmptyState text="Keine Dokumente in dieser Ansicht." />}
      {filtered.map((doc) => (
        <Row key={doc.id} className="group">
          <Icon name={fileIcon(doc.mime)} size={20} className="text-ink-2" />
          <div className="flex-1 min-w-0">
            <a
              href={`/api/documents/${doc.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] font-medium hover:text-accent transition-colors"
            >
              {doc.title}
            </a>
            <div className="text-[11px] text-ink-3">
              {doc.filename} · {fmtSize(doc.size)} · abgelegt {fmtDate(doc.created_at)}
              {doc.tags && ` · ${doc.tags}`}
            </div>
          </div>
          <Badge>{doc.category}</Badge>
          {doc.partner ? (
            <Badge tone="accent">{doc.partner}</Badge>
          ) : (
            <Badge>{doc.scope === "persoenlich" ? "persönlich" : doc.scope}</Badge>
          )}
          <a href={`/api/documents/${doc.id}`} download={doc.filename} className="text-ink-3 hover:text-accent" title="Herunterladen">
            <Icon name="download" size={18} />
          </a>
          <button
            onClick={() => remove(doc.id)}
            className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad text-[12px] transition-all"
          >
            Löschen
          </button>
        </Row>
      ))}
    </Card>
  );
}
