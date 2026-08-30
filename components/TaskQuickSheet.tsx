"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui";
import { todayIso } from "@/lib/client";

/**
 * Schnelles Anlegen von Aufgaben im Stil von Google Tasks:
 * Bottom Sheet mit schlichtem Eingabefeld, Icon-Zeile für optionale Details
 * (Notizen, Datum, Wiederholung, Priorität) und "Speichern".
 */
export default function TaskQuickSheet({
  open,
  onClose,
  onCreated,
  defaultHorizon = "short",
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultHorizon?: "short" | "long";
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [priority, setPriority] = useState(2);
  const [showNotes, setShowNotes] = useState(false);
  const [showDue, setShowDue] = useState(false);
  const [showRecurrence, setShowRecurrence] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setTitle("");
      setNotes("");
      setDue("");
      setRecurrence("");
      setPriority(2);
      setShowNotes(false);
      setShowDue(false);
      setShowRecurrence(false);
    }
  }, [open]);

  if (!open) return null;

  const save = async () => {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/data/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: t,
          notes,
          horizon: defaultHorizon,
          due_date: due || (defaultHorizon === "short" ? todayIso() : null),
          recurrence: recurrence || null,
          priority,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Server-Fehler ${res.status}`);
      }
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const cyclePriority = () => setPriority(priority === 2 ? 1 : priority === 1 ? 3 : 2);

  const iconBtn = (active: boolean) =>
    `w-10 h-10 rounded-full flex items-center justify-center transition-all ${
      active ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-inset"
    }`;

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute bottom-0 inset-x-0 max-w-[640px] mx-auto bg-[#17191a] border-t border-x border-line rounded-t-[18px] p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-[0_-8px_40px_rgba(0,0,0,0.5)]">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Neue Aufgabe"
          className="w-full bg-transparent text-[16px] outline-none placeholder:text-ink-3 py-1"
        />

        {showNotes && (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Details hinzufügen"
            rows={2}
            className="w-full bg-transparent text-[14px] text-ink-2 outline-none placeholder:text-ink-3 mt-1 resize-none"
          />
        )}
        {showDue && (
          <div className="flex items-center gap-2 mt-2">
            <Icon name="event" size={16} className="text-ink-3" />
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="bg-inset border border-line rounded-[8px] h-8 px-2 text-[13px] outline-none focus:border-accent"
            />
            {due && (
              <button onClick={() => setDue("")} className="text-ink-3 hover:text-ink">
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        )}
        {showRecurrence && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {[
              ["", "einmalig"],
              ["daily", "täglich"],
              ["weekly", "wöchentlich"],
              ["monthly", "monatlich"],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setRecurrence(v)}
                className={`px-3 h-7 rounded-full text-[12px] font-medium border transition-all ${
                  recurrence === v
                    ? "bg-accent-soft border-accent/40 text-accent"
                    : "bg-inset border-line text-ink-2"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {error && <p className="text-[12px] text-bad mt-2 break-words">{error}</p>}

        <div className="flex items-center justify-between mt-2 pt-1">
          <div className="flex items-center gap-1">
            <button onClick={() => setShowNotes(!showNotes)} className={iconBtn(showNotes)} title="Details">
              <Icon name="notes" size={20} />
            </button>
            <button onClick={() => setShowDue(!showDue)} className={iconBtn(showDue || Boolean(due))} title="Fälligkeitsdatum">
              <Icon name="schedule" size={20} />
            </button>
            <button
              onClick={() => setShowRecurrence(!showRecurrence)}
              className={iconBtn(showRecurrence || Boolean(recurrence))}
              title="Wiederholung"
            >
              <Icon name="autorenew" size={20} />
            </button>
            <button
              onClick={cyclePriority}
              className={iconBtn(priority !== 2)}
              title={priority === 1 ? "Priorität: hoch" : priority === 3 ? "Priorität: niedrig" : "Priorität"}
            >
              <Icon name={priority === 1 ? "keyboard_double_arrow_up" : priority === 3 ? "keyboard_double_arrow_down" : "flag"} size={20} />
            </button>
          </div>
          <button
            onClick={save}
            disabled={!title.trim() || saving}
            className="text-[15px] font-semibold text-accent disabled:text-ink-3 px-3 py-1.5 transition-colors"
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
