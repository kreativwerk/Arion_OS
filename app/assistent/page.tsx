"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui";

type Msg = { id?: number; role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Was steht heute an?",
  "Welche Verträge muss ich bald kündigen?",
  "Was weiß ich über Arval?",
  "Gibt es neue Briefpost?",
  "Fasse meine wichtigen Mails zusammen",
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/assistant", { cache: "no-store" })
      .then((r) => r.json())
      .then(setMessages);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: message }]);
    try {
      const res = await fetch("/api/assistant", { method: "POST", body: JSON.stringify({ message }) });
      const data = await res.json().catch(() => null);
      setMessages((m) => [...m, { role: "assistant", content: data?.reply ?? data?.error ?? `Fehler (${res.status}).` }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Keine Verbindung: ${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    await fetch("/api/assistant", { method: "DELETE" });
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-200px)] lg:h-[calc(100vh-64px)]">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[28px] font-bold tracking-tight inline-flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="w-9 h-9 rounded-full" />
          Arion Bot
        </h1>
        {messages.length > 0 && (
          <button
            onClick={clear}
            aria-label="Verlauf löschen"
            title="Verlauf löschen"
            className="w-10 h-10 rounded-full flex items-center justify-center text-ink-3 hover:text-bad hover:bg-inset transition-all"
          >
            <Icon name="delete" size={20} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.length === 0 && (
          <div className="pt-10 text-center">
            <p className="text-[14px] text-ink-3 mb-5">Frag mich etwas – zum Beispiel:</p>
            <div className="flex flex-wrap gap-2 justify-center max-w-[520px] mx-auto">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="px-4 h-9 rounded-full bg-card border border-line text-[13px] text-ink-2 hover:border-accent hover:text-accent transition-all shadow-card"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={m.id ?? i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-accent text-on-accent rounded-[18px] rounded-br-[6px]"
                  : "bg-card border border-line rounded-[18px] rounded-bl-[6px] shadow-card"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-card border border-line rounded-[18px] rounded-bl-[6px] px-4 py-2.5 shadow-card flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="" className="w-6 h-6 rounded-full animate-bot-pulse" />
              <span className="flex items-center gap-1">
                <span className="thinking-dot" />
                <span className="thinking-dot" style={{ animationDelay: "0.15s" }} />
                <span className="thinking-dot" style={{ animationDelay: "0.3s" }} />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Eingabe im WhatsApp-Stil: wachsendes Textfeld + runder Pfeil-Button */}
      <div className="pt-3 border-t border-line">
        <div className="flex items-end gap-2.5">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 132) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
                (e.target as HTMLTextAreaElement).style.height = "auto";
              }
            }}
            placeholder="Frag den Arion Bot …"
            className="flex-1 min-h-[48px] max-h-[132px] px-4 py-3 rounded-[24px] bg-card border border-line text-[16px] leading-snug outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all shadow-card resize-none"
          />
          <button
            onClick={() => send()}
            disabled={busy || !input.trim()}
            aria-label="Senden"
            className="w-12 h-12 shrink-0 rounded-full bg-accent text-on-accent flex items-center justify-center disabled:opacity-40 transition-all"
          >
            <Icon name="arrow_upward" size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}
