"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

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
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: message }]);
    const res = await fetch("/api/assistant", { method: "POST", body: JSON.stringify({ message }) });
    const data = await res.json();
    setMessages((m) => [...m, { role: "assistant", content: data.reply ?? data.error ?? "Fehler." }]);
    setBusy(false);
  };

  const clear = async () => {
    await fetch("/api/assistant", { method: "DELETE" });
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">✨ Jarvis</h1>
          <p className="text-[14px] text-ink-2 mt-1">
            Kennt deine Aufgaben, Verträge, Post, Mails, Termine und dein Wissen.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" onClick={clear}>
            Verlauf löschen
          </Button>
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
                  ? "bg-accent text-white rounded-[18px] rounded-br-[6px]"
                  : "bg-card border border-line rounded-[18px] rounded-bl-[6px] shadow-card"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-card border border-line rounded-[18px] rounded-bl-[6px] px-4 py-2.5 text-[13px] text-ink-3 shadow-card">
              Denkt nach …
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="pt-3 border-t border-line">
        <div className="flex gap-2.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Frag Jarvis …"
            className="flex-1 h-11 px-4 rounded-full bg-card border border-line text-[14px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all shadow-card"
          />
          <button
            onClick={() => send()}
            disabled={busy || !input.trim()}
            className="h-11 px-5 rounded-full bg-accent text-white text-[14px] font-medium disabled:opacity-40 transition-all"
          >
            Senden
          </button>
        </div>
      </div>
    </div>
  );
}
