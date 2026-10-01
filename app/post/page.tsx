"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  PageHeader,
  Button,
  Input,
  TextArea,
  Select,
  EmptyState,
  Badge,
  ErrorNote,
  Icon,
  Segmented,
} from "@/components/ui";
import { useTable, fmtDate, todayIso } from "@/lib/client";

type Letter = {
  id: number;
  subject: string;
  sender: string;
  received_date: string;
  scanned_by: string;
  status: string;
  summary: string;
  file_ref: string;
  category: string;
  action: string;
  due_date: string;
  reference: string;
  notes: string;
  mime: string;
};

type UploadItem = { name: string; state: "wartet" | "lädt" | "fertig" | "fehler"; message?: string };
type View = "offen" | "erledigt" | "alle";

/** "archiv" ist der Erledigt-Status (bestehende Daten + Dashboard zählen so). */
const DONE = "archiv";
const STATUS_LABEL: Record<string, string> = { neu: "neu", gelesen: "gelesen", aktion: "Aktion nötig", archiv: "erledigt" };
const STATUS_TONE: Record<string, "accent" | "neutral" | "warn" | "good"> = {
  neu: "accent",
  gelesen: "neutral",
  aktion: "warn",
  archiv: "good",
};
const CATEGORIES = ["Rechnung", "Mahnung", "Behörde", "Steuer", "Versicherung", "Bank", "Vertrag", "Bußgeld", "Werbung", "Sonstiges"];

function senderKey(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ") || "—";
}

function dueTone(due: string): "bad" | "warn" | "neutral" {
  const today = todayIso();
  if (due < today) return "bad";
  const inAWeek = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString("sv-SE");
  return due <= inAWeek ? "warn" : "neutral";
}

export default function PostPage() {
  const { rows, update, reload, error } = useTable<Letter>("letters");
  const [view, setView] = useState<View>("offen");
  const [query, setQuery] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [scannedBy, setScannedBy] = useState("");
  const [analysis, setAnalysis] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pageError, setPageError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/letters", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAnalysis(Boolean(d.analysis)))
      .catch(() => {});
  }, []);

  /** Stapel nacheinander hochladen – ein Scan pro Request (Body-Limit, KI-Zeitbudget). */
  const uploadAll = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setPageError("");
    const items: UploadItem[] = files.map((f) => ({ name: f.name, state: "wartet" }));
    setUploads(items);
    const set = (i: number, patch: Partial<UploadItem>) =>
      setUploads((cur) => cur.map((it, j) => (j === i ? { ...it, ...patch } : it)));

    for (let i = 0; i < files.length; i++) {
      set(i, { state: "lädt" });
      const form = new FormData();
      form.append("file", files[i]);
      form.append("scanned_by", scannedBy);
      try {
        const res = await fetch("/api/letters", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) set(i, { state: "fehler", message: data.error ?? `Fehler ${res.status}` });
        else set(i, { state: "fertig", message: data.analysisError ?? undefined });
      } catch (e) {
        set(i, { state: "fehler", message: e instanceof Error ? e.message : String(e) });
      }
      await reload();
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const reanalyze = async (id: number) => {
    setPageError("");
    const res = await fetch(`/api/letters/${id}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (data.analysisError) setPageError(data.analysisError);
    await reload();
  };

  const removeLetter = async (id: number) => {
    if (!confirm("Brief samt Scan löschen?")) return;
    await fetch(`/api/letters/${id}`, { method: "DELETE" });
    await reload();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((l) => {
      if (view === "offen" && l.status === DONE) return false;
      if (view === "erledigt" && l.status !== DONE) return false;
      if (!q) return true;
      return [l.subject, l.sender, l.summary, l.action, l.reference, l.category, l.notes].some((f) =>
        f?.toLowerCase().includes(q)
      );
    });
  }, [rows, view, query]);

  /** Nach Absender gruppiert; Gruppen mit offener Frist/Aktion zuerst, dann neueste. */
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; letters: Letter[] }>();
    for (const l of filtered) {
      const key = senderKey(l.sender);
      const g = map.get(key) ?? { name: l.sender.trim() || "Absender unbekannt", letters: [] };
      g.letters.push(l);
      map.set(key, g);
    }
    const rank = (g: { letters: Letter[] }) => {
      const dues = g.letters.filter((l) => l.status !== DONE && l.due_date).map((l) => l.due_date).sort();
      return dues[0] ?? "9999";
    };
    return [...map.entries()].sort(([, a], [, b]) => {
      const r = rank(a).localeCompare(rank(b));
      if (r !== 0) return r;
      return (b.letters[0]?.received_date ?? "").localeCompare(a.letters[0]?.received_date ?? "");
    });
  }, [filtered]);

  const openCount = rows.filter((l) => l.status !== DONE).length;
  const doneUploads = uploads.filter((u) => u.state === "fertig" || u.state === "fehler").length;

  return (
    <div>
      <PageHeader title="Briefpost" subtitle="Alle Briefe auf einmal hochladen – sortiert nach Absender, Anliegen kurz erklärt" />

      <ErrorNote error={error || pageError} />

      {/* Sammel-Upload */}
      <Card className="mb-5">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            uploadAll([...e.dataTransfer.files]);
          }}
          className={`m-4 rounded-[12px] border border-dashed px-4 py-6 flex flex-col items-center text-center gap-2 transition-colors ${
            dragOver ? "border-accent bg-accent-soft" : "border-line bg-inset"
          }`}
        >
          <div className="w-11 h-11 rounded-[12px] bg-accent-soft text-accent flex items-center justify-center">
            <Icon name="upload_file" size={24} />
          </div>
          <div className="text-[14px] font-semibold">Briefe hier ablegen</div>
          <div className="text-[12px] text-ink-3">PDF oder Fotos, beliebig viele auf einmal · max. 4 MB pro Datei</div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(e) => uploadAll([...(e.target.files ?? [])])}
          />
          <div className="flex flex-col sm:flex-row items-center gap-2 mt-1 w-full sm:w-auto">
            <Input
              placeholder="Gescannt von (optional)"
              value={scannedBy}
              onChange={(e) => setScannedBy(e.target.value)}
              className="sm:w-52"
            />
            <Button onClick={() => fileRef.current?.click()} disabled={busy} className="shrink-0">
              {busy ? `Analysiere ${Math.min(doneUploads + 1, uploads.length)}/${uploads.length} …` : "Dateien auswählen"}
            </Button>
          </div>
          {analysis === false && (
            <p className="text-[11px] text-warn mt-1">
              Ohne <code>ANTHROPIC_API_KEY</code> werden Briefe nur abgelegt – Absender und Anliegen dann von Hand ergänzen.
            </p>
          )}
        </div>

        {uploads.length > 0 && (
          <div className="px-5 pb-4 space-y-1.5">
            {uploads.map((u, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px] min-w-0">
                <Icon
                  name={u.state === "fertig" ? (u.message ? "warning" : "check_circle") : u.state === "fehler" ? "error" : u.state === "lädt" ? "progress_activity" : "schedule"}
                  size={16}
                  className={
                    u.state === "fertig" ? (u.message ? "text-warn" : "text-accent") : u.state === "fehler" ? "text-bad" : "text-ink-3"
                  }
                />
                <span className="truncate text-ink-2">{u.name}</span>
                {u.message && <span className="text-ink-3 truncate">– {u.message}</span>}
              </div>
            ))}
            {!busy && (
              <button onClick={() => setUploads([])} className="text-[12px] text-ink-3 hover:text-ink">
                Liste ausblenden
              </button>
            )}
          </div>
        )}
      </Card>

      {/* Filter */}
      <div className="flex flex-col sm:flex-row gap-2.5 mb-4">
        <Segmented<View>
          options={[
            { value: "offen", label: `Offen (${openCount})` },
            { value: "erledigt", label: "Erledigt" },
            { value: "alle", label: "Alle" },
          ]}
          value={view}
          onChange={setView}
          className="shrink-0"
        />
        <Input placeholder="Suchen: Absender, Aktenzeichen, Anliegen …" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="space-y-4">
        {groups.length === 0 && (
          <Card>
            <EmptyState text={view === "offen" ? "Keine offene Post." : "Keine Briefe in dieser Ansicht."} />
          </Card>
        )}

        {groups.map(([key, g]) => {
          const open = g.letters.filter((l) => l.status !== DONE).length;
          const isCollapsed = collapsed[key];
          return (
            <Card key={key}>
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
                className="w-full flex items-center gap-3 px-5 pt-4 pb-3 text-left"
              >
                <div className="w-9 h-9 rounded-[11px] bg-accent-soft text-accent flex items-center justify-center shrink-0">
                  <Icon name="business" size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-semibold tracking-tight truncate">{g.name}</div>
                  <div className="text-[12px] text-ink-3">
                    {g.letters.length} {g.letters.length === 1 ? "Brief" : "Briefe"}
                    {open > 0 && view !== "offen" ? ` · ${open} offen` : ""}
                  </div>
                </div>
                <Icon name={isCollapsed ? "expand_more" : "expand_less"} className="text-ink-3" />
              </button>

              {!isCollapsed &&
                g.letters.map((l) =>
                  editing === l.id ? (
                    <LetterEditor
                      key={l.id}
                      letter={l}
                      onCancel={() => setEditing(null)}
                      onSave={async (patch) => {
                        await update(l.id, patch);
                        setEditing(null);
                      }}
                    />
                  ) : (
                    <LetterRow
                      key={l.id}
                      letter={l}
                      onToggleDone={() => update(l.id, { status: l.status === DONE ? "gelesen" : DONE })}
                      onStatus={(status) => update(l.id, { status })}
                      onEdit={() => setEditing(l.id)}
                      onReanalyze={() => reanalyze(l.id)}
                      onDelete={() => removeLetter(l.id)}
                    />
                  )
                )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function LetterRow({
  letter: l,
  onToggleDone,
  onStatus,
  onEdit,
  onReanalyze,
  onDelete,
}: {
  letter: Letter;
  onToggleDone: () => void;
  onStatus: (s: string) => void;
  onEdit: () => void;
  onReanalyze: () => void;
  onDelete: () => void;
}) {
  const done = l.status === DONE;
  const hasScan = Boolean(l.mime);
  return (
    <div className="flex items-start gap-3 px-5 py-3.5 border-t border-line group">
      <button
        onClick={onToggleDone}
        aria-label={done ? "Wieder öffnen" : "Als erledigt markieren"}
        title={done ? "Wieder öffnen" : "Als erledigt markieren"}
        className={`mt-0.5 w-[22px] h-[22px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-colors ${
          done ? "bg-accent border-accent text-on-accent" : "border-ink-3 text-transparent hover:border-accent hover:text-accent/60"
        }`}
      >
        <Icon name="check" size={15} />
      </button>

      <div className={`flex-1 min-w-0 ${done ? "opacity-60" : ""}`}>
        <div className="flex items-start justify-between gap-2">
          <div className={`text-[14px] font-medium break-words ${done ? "line-through" : ""}`}>{l.subject}</div>
          {!done && (
            <Select
              value={l.status}
              onChange={(e) => onStatus(e.target.value)}
              className="!h-7 !text-[11px] !px-1.5 shrink-0"
              aria-label="Status"
            >
              <option value="neu">neu</option>
              <option value="gelesen">gelesen</option>
              <option value="aktion">Aktion nötig</option>
            </Select>
          )}
        </div>

        {l.summary && <p className="text-[13px] text-ink-2 mt-1">{l.summary}</p>}
        {l.action && !done && (
          <p className="text-[13px] mt-1.5 flex items-start gap-1.5">
            <Icon name="arrow_forward" size={15} className="text-accent mt-0.5" />
            <span>{l.action}</span>
          </p>
        )}
        {l.notes && <p className="text-[12px] text-ink-2 mt-1.5 bg-inset rounded-[10px] px-3 py-2 whitespace-pre-wrap">{l.notes}</p>}

        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {done && <Badge tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Badge>}
          {l.due_date && !done && <Badge tone={dueTone(l.due_date)}>Frist {fmtDate(l.due_date)}</Badge>}
          {l.category && <Badge>{l.category}</Badge>}
          {l.reference && <span className="text-[11px] text-ink-3 break-all">{l.reference}</span>}
          <span className="text-[11px] text-ink-3">
            · eingegangen {fmtDate(l.received_date)}
            {l.scanned_by ? ` · gescannt von ${l.scanned_by}` : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-2 text-[12px]">
          {hasScan && (
            <a href={`/api/letters/${l.id}`} target="_blank" rel="noreferrer" className="text-accent hover:underline flex items-center gap-1">
              <Icon name={l.mime === "application/pdf" ? "picture_as_pdf" : "image"} size={15} />
              Scan öffnen
            </a>
          )}
          <button onClick={onEdit} className="text-ink-2 hover:text-ink flex items-center gap-1">
            <Icon name="edit" size={15} />
            Bearbeiten
          </button>
          {hasScan && (
            <button onClick={onReanalyze} className="text-ink-3 hover:text-ink flex items-center gap-1">
              <Icon name="refresh" size={15} />
              Neu analysieren
            </button>
          )}
          <button onClick={onDelete} className="lg:opacity-0 lg:group-hover:opacity-100 text-ink-3 hover:text-bad transition-all">
            Löschen
          </button>
        </div>
      </div>
    </div>
  );
}

function LetterEditor({
  letter,
  onSave,
  onCancel,
}: {
  letter: Letter;
  onSave: (patch: Partial<Letter>) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    subject: letter.subject,
    sender: letter.sender,
    summary: letter.summary,
    action: letter.action,
    category: letter.category,
    due_date: letter.due_date,
    reference: letter.reference,
    notes: letter.notes,
  });
  const field = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((cur) => ({ ...cur, [k]: e.target.value })),
  });

  return (
    <div className="px-5 py-4 border-t border-line space-y-2.5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <Input placeholder="Betreff" {...field("subject")} />
        <Input placeholder="Absender" {...field("sender")} />
      </div>
      <TextArea placeholder="Anliegen – worum geht es?" rows={2} {...field("summary")} />
      <Input placeholder="Was ist zu tun?" {...field("action")} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <Select {...field("category")}>
          <option value="">Kategorie …</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Input type="date" aria-label="Frist" {...field("due_date")} />
        <Input placeholder="Aktenzeichen / Rechnungsnr." {...field("reference")} />
      </div>
      <TextArea placeholder="Eigene Notizen" rows={2} {...field("notes")} />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button onClick={() => onSave({ ...f, subject: f.subject.trim() || "Brief" })}>Speichern</Button>
      </div>
    </div>
  );
}
