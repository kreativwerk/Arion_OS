"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui";
import Reactor, { type ArionState } from "@/components/arion/Reactor";
import { useArionVoice } from "@/components/arion/useArionVoice";
import { useWakeWord } from "@/components/arion/useWakeWord";
import { clipUrl, greetingClip } from "@/lib/arion-wake";
import { compactEuro, formatEuro } from "@/lib/arion-speech";

/**
 * /arion – Sprach-HUD des Assistenten ARION.
 *
 * Bedienung: Knopf halten = Push-to-Talk, kurz tippen = Freihand (endet nach
 * Sprechpause), am Desktop Leertaste halten. Antworten werden vorgelesen.
 *
 * Wake-Hook (für den späteren Mac-Helfer mit „Hey ARION“):
 *   new BroadcastChannel("arion").postMessage({ type: "arion:wake" })
 *   window.postMessage({ type: "arion:wake" }, location.origin)
 *   window.arion.wake()            // z. B. per WKWebView/AppleScript
 * Analog { type: "arion:stop" } bzw. window.arion.stop(). Details: docs/ARION.md
 */

type Action = { type: "task_created"; id: number; title: string; due_date: string | null } | { type: "open"; href: string; label: string };

type Turn = { id: number; q: string; a: string | null; spoken?: string; actions: Action[]; source?: string; failed?: boolean };

type Status = {
  ki: boolean;
  tts: boolean;
  stt: boolean;
  kennzahlen: {
    monat: string;
    fehlt_anzahl: number;
    fehlt_summe: number;
    eingang_neu: number;
    naechste_frist: { titel: string; faellig: string | null; betrag: number | null; tage_bis: number | null } | null;
    qonto_saldo: number | null;
    qonto_stand: string | null;
    mails_neu: number;
    aufgaben_faellig: number;
  };
};

const SUGGESTIONS = ["Wie steht die Buchhaltung?", "Welche Mails sind wichtig?", "Was steht heute an?", "Wie ist der Kontostand?"];

const STATE_LABEL: Record<ArionState, string> = {
  idle: "Bereit",
  listening: "Ich höre zu …",
  thinking: "Denke nach …",
  speaking: "Spreche …",
};

const CONV_KEY = "arion.conversation";
const VOICE_KEY = "arion.voice";
const WAKE_KEY = "arion.wake";
const GREETED_KEY = "arion.greeted";

/** Kurzen Butler-Clip (Alistair, siehe lib/arion-wake.ts) abspielen; löst spätestens nach 4 s auf. */
function playClip(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const a = new Audio(clipUrl(name));
      const done = () => resolve();
      a.onended = done;
      a.onerror = done;
      setTimeout(done, 4000);
      a.play().catch(done);
    } catch {
      resolve();
    }
  });
}

function newConversationId() {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
  return `arion-${rnd}`;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.` : "–";
}

function stripMd(s: string) {
  return s.replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/`([^`]*)`/g, "$1").replace(/^#{1,6}\s+/gm, "");
}

function isTypingTarget(t: EventTarget | null) {
  return t instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable);
}

export default function ArionPage() {
  const [state, setStateRaw] = useState<ArionState>("idle");
  const [transcript, setTranscript] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [freehand, setFreehand] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [input, setInput] = useState("");
  const [wakeOn, setWakeOn] = useState(false);

  const stateRef = useRef<ArionState>("idle");
  const conversationId = useRef<string>("");
  const pressAt = useRef<number | null>(null);
  const speakToken = useRef(0);
  const turnSeq = useRef(0);
  const statusRef = useRef<Status | null>(null);
  const voiceRef = useRef(true);
  const askRef = useRef<(text: string, mode: "voice" | "text") => void>(() => {});

  /** Aktueller Zustand – als Funktion, damit TypeScript nach await nicht falsch einengt. */
  const current = useCallback((): ArionState => stateRef.current, []);

  const setState = useCallback((s: ArionState) => {
    stateRef.current = s;
    setStateRaw(s);
  }, []);

  /* ── Status + Kennzahlen ──────────────────────────────── */

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/arion/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Status;
      statusRef.current = data;
      setStatus(data);
    } catch {
      /* Karten bleiben leer */
    }
  }, []);

  useEffect(() => {
    // Gespräch über Reloads hinweg fortsetzen (pro Tab), Stimme an/aus merken
    try {
      conversationId.current = sessionStorage.getItem(CONV_KEY) || newConversationId();
      sessionStorage.setItem(CONV_KEY, conversationId.current);
    } catch {
      conversationId.current = newConversationId();
    }
    let savedVoice = true;
    try {
      savedVoice = localStorage.getItem(VOICE_KEY) !== "0";
    } catch {
      /* Standard: an */
    }
    voiceRef.current = savedVoice;
    let savedWake = false;
    try {
      savedWake = localStorage.getItem(WAKE_KEY) === "1";
    } catch {
      /* Standard: aus */
    }
    const t = setTimeout(() => {
      setVoiceOn(savedVoice);
      setWakeOn(savedWake);
    }, 0);
    const t0 = setTimeout(loadStatus, 0);
    const iv = setInterval(loadStatus, 60_000);
    return () => {
      clearTimeout(t0);
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [loadStatus]);

  /* ── Stimme ───────────────────────────────────────────── */

  const handlers = useMemo(
    () => ({
      onInterim: (text: string) => setTranscript(text),
      onFinal: (text: string) => {
        setFreehand(false);
        if (!text) {
          if (stateRef.current !== "speaking") setState("idle");
          setError((e) => e ?? "Ich habe nichts verstanden. Halte den Knopf und sprich.");
          return;
        }
        setTranscript(text);
        askRef.current(text, "voice");
      },
      onError: (message: string) => setError(message),
      onListening: (active: boolean) => {
        if (active) {
          setError(null);
          setState("listening");
        } else if (stateRef.current === "listening") setState("idle");
      },
      onTranscribing: () => {
        setState("thinking");
        setTranscript("Transkribiere …");
      },
      onSpeechIssue: (kind: "blocked" | "stuck") =>
        setError(
          kind === "blocked"
            ? "Der Browser lässt ARION erst nach einem Klick sprechen. Einmal auf die Seite klicken, dann klappt es."
            : "Die Sprachausgabe des Browsers hängt. Chrome ganz beenden (⌘Q) und neu öffnen – in Safari klappt es sofort."
        ),
    }),
    [setState]
  );

  const { unlock, frame, startListening, stopListening, setListenMode, speak, stopSpeaking } = useArionVoice(handlers);

  // Erster Klick oder Tastendruck irgendwo auf der Seite schaltet Audio und Stimme frei –
  // sonst bleibt ARION beim Weckruf ohne vorherige Geste stumm.
  useEffect(() => {
    const once = () => {
      unlock();
      window.removeEventListener("pointerdown", once, true);
      window.removeEventListener("keydown", once, true);
    };
    window.addEventListener("pointerdown", once, true);
    window.addEventListener("keydown", once, true);
    return () => {
      window.removeEventListener("pointerdown", once, true);
      window.removeEventListener("keydown", once, true);
    };
  }, [unlock]);

  /* ── Fragen ───────────────────────────────────────────── */

  const ask = useCallback(
    async (text: string, mode: "voice" | "text") => {
      const q = text.trim();
      if (!q) return;
      const id = ++turnSeq.current;
      setError(null);
      setState("thinking");
      setTurns((t) => [{ id, q, a: null, actions: [] }, ...t].slice(0, 20));
      let spoken = "";
      try {
        const res = await fetch("/api/arion/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: q, mode: voiceRef.current ? "voice" : mode, conversationId: conversationId.current }),
        });
        const data = (await res.json().catch(() => null)) as {
          answer?: string;
          spokenAnswer?: string;
          actions?: Action[];
          conversationId?: string;
          source?: string;
          error?: string;
        } | null;
        const answer = data?.answer || data?.error || `Fehler (${res.status}).`;
        spoken = data?.spokenAnswer || "";
        if (data?.conversationId && data.conversationId !== conversationId.current) {
          conversationId.current = data.conversationId;
          try {
            sessionStorage.setItem(CONV_KEY, data.conversationId);
          } catch {
            /* egal */
          }
        }
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, a: answer, spoken, actions: data?.actions ?? [], source: data?.source, failed: !res.ok } : x)));
        if (data?.actions?.some((a) => a.type === "task_created")) void loadStatus();
      } catch {
        const answer = "Keine Verbindung zu Arion OS. Prüfe dein Netz und versuch es noch einmal.";
        spoken = answer;
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, a: answer, spoken: answer, failed: true } : x)));
      }

      if (stateRef.current !== "thinking") return; // inzwischen unterbrochen
      if (voiceRef.current && spoken) {
        const token = ++speakToken.current;
        setState("speaking");
        await speak(spoken, Boolean(statusRef.current?.tts));
        if (token === speakToken.current && current() === "speaking") setState("idle");
      } else {
        setState("idle");
      }
    },
    [current, loadStatus, setState, speak]
  );

  useEffect(() => {
    askRef.current = (t, m) => void ask(t, m);
  }, [ask]);

  /* ── Push-to-Talk ─────────────────────────────────────── */

  const begin = useCallback(
    (mode: "hold" | "toggle" | "wake") => {
      speakToken.current++;
      stopSpeaking();
      setTranscript("");
      setError(null);
      setFreehand(mode !== "hold");
      void startListening(mode);
    },
    [startListening, stopSpeaking]
  );

  const onPressStart = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      unlock();
      if (stateRef.current === "listening") {
        // Freihand läuft → Tippen beendet
        pressAt.current = null;
        stopListening();
        return;
      }
      if (stateRef.current === "thinking") return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
      pressAt.current = performance.now();
      begin("hold");
    },
    [begin, stopListening, unlock]
  );

  const onPressEnd = useCallback(() => {
    if (pressAt.current === null) return;
    const held = performance.now() - pressAt.current;
    pressAt.current = null;
    if (held < 350) {
      // Kurz getippt → Freihand: hört weiter bis zur Sprechpause
      setListenMode("toggle");
      setFreehand(true);
    } else {
      stopListening();
    }
  }, [setListenMode, stopListening]);

  // Desktop: Leertaste halten
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault();
      unlock();
      if (stateRef.current === "listening") return;
      if (stateRef.current === "thinking") return;
      pressAt.current = performance.now();
      begin("hold");
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTypingTarget(e.target)) return;
      e.preventDefault();
      if (pressAt.current === null) return;
      pressAt.current = null;
      stopListening();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [begin, stopListening, unlock]);

  /* ── Wake-Hook ────────────────────────────────────────── */

  useEffect(() => {
    const wake = () => {
      if (stateRef.current === "listening" || stateRef.current === "thinking") return;
      unlock();
      begin("wake");
    };
    const stop = () => {
      speakToken.current++;
      stopSpeaking();
      stopListening();
      if (stateRef.current === "speaking") setState("idle");
    };
    const handle = (data: unknown) => {
      const type = (data as { type?: unknown } | null)?.type;
      if (type === "arion:wake") wake();
      else if (type === "arion:stop") stop();
    };
    const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("arion") : null;
    if (bc) bc.onmessage = (e) => handle(e.data);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      handle(e.data);
    };
    window.addEventListener("message", onMessage);
    const w = window as unknown as { arion?: { wake: () => void; stop: () => void } };
    w.arion = { wake, stop };
    return () => {
      bc?.close();
      window.removeEventListener("message", onMessage);
      delete w.arion;
    };
  }, [begin, setState, stopListening, stopSpeaking, unlock]);

  /* ── Weckruf „Hey ARION“ (Browser) ───────────────────── */

  const onWakeWord = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    // Erster Weckruf des Tages: Begrüßung nach Tageszeit, sonst „Zu Diensten, Sir.“
    let clip = "zu-diensten";
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem(GREETED_KEY) !== today) {
        clip = greetingClip(new Date().getHours());
        localStorage.setItem(GREETED_KEY, today);
      }
    } catch {
      /* egal */
    }
    if (voiceRef.current) await playClip(clip);
    if (stateRef.current !== "idle") return;
    begin("wake");
  }, [begin]);

  const { supported: wakeSupported, lauscht: wakeListening } = useWakeWord({
    enabled: wakeOn,
    paused: state !== "idle",
    onWake: onWakeWord,
    onBlocked: (msg) => {
      setError(msg);
      setWakeOn(false);
    },
  });

  const toggleWake = () => {
    const next = !wakeOn;
    unlock();
    setWakeOn(next);
    try {
      localStorage.setItem(WAKE_KEY, next ? "1" : "0");
    } catch {
      /* egal */
    }
  };

  /* ── Sonstiges ────────────────────────────────────────── */

  const toggleVoice = () => {
    const next = !voiceOn;
    voiceRef.current = next;
    setVoiceOn(next);
    if (!next) {
      speakToken.current++;
      stopSpeaking();
      if (stateRef.current === "speaking") setState("idle");
    }
    try {
      localStorage.setItem(VOICE_KEY, next ? "1" : "0");
    } catch {
      /* egal */
    }
  };

  const newConversation = () => {
    speakToken.current++;
    stopSpeaking();
    conversationId.current = newConversationId();
    try {
      sessionStorage.setItem(CONV_KEY, conversationId.current);
    } catch {
      /* egal */
    }
    setTurns([]);
    setTranscript("");
    setError(null);
    if (stateRef.current === "speaking") setState("idle");
  };

  const submitText = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || stateRef.current === "thinking") return;
    unlock();
    speakToken.current++;
    stopSpeaking();
    setInput("");
    setTranscript(q);
    void ask(q, "text");
  };

  const k = status?.kennzahlen;
  const cards = [
    {
      href: "/buchhaltung",
      icon: "receipt_long",
      label: "Belege fehlen",
      short: "Belege",
      value: k ? String(k.fehlt_anzahl) : "–",
      meta: k && k.fehlt_anzahl > 0 ? compactEuro(k.fehlt_summe) : "alles da",
      active: Boolean(k && k.fehlt_anzahl > 0),
    },
    {
      href: "/buchhaltung",
      icon: "event_upcoming",
      label: "Nächste Frist",
      short: "Frist",
      value: k?.naechste_frist ? shortDate(k.naechste_frist.faellig) : "–",
      meta: k?.naechste_frist?.titel ?? "keine",
      active: Boolean(k?.naechste_frist),
    },
    {
      href: "/buchhaltung",
      icon: "account_balance",
      label: "Qonto-Saldo",
      short: "Qonto",
      value: k?.qonto_saldo != null ? formatEuro(k.qonto_saldo).replace(/,\d\d\u00a0€$/, "\u00a0€") : "–",
      compact: k?.qonto_saldo != null ? compactEuro(k.qonto_saldo) : undefined,
      meta: k?.qonto_stand ? `Stand ${shortDate(k.qonto_stand)}` : "kein Stand",
      active: k?.qonto_saldo != null,
    },
    {
      href: "/mail",
      icon: "mail",
      label: "Neue Mails",
      short: "Mails",
      value: k ? String(k.mails_neu) : "–",
      meta: k && k.mails_neu > 0 ? "wichtig" : "ruhig",
      active: Boolean(k && k.mails_neu > 0),
    },
  ];

  const latest = turns[0];
  const live = state === "listening" || (state === "thinking" && !latest?.a);

  return (
    <div className="arion-hud fixed inset-0 lg:left-[220px] z-[60] flex flex-col overflow-hidden select-none">
      {/* Kopfzeile */}
      <header className="relative z-10 flex items-center justify-between gap-2 px-4 sm:px-6 pt-[max(12px,env(safe-area-inset-top))] pb-2">
        <Link
          href="/"
          aria-label="Schließen"
          className="w-10 h-10 rounded-full flex items-center justify-center text-ink-2 hover:text-ink hover:bg-inset transition-colors"
        >
          <Icon name="close" size={22} />
        </Link>
        <div className="flex flex-col items-center">
          <div className="text-[13px] font-semibold tracking-[0.42em] pl-[0.42em] text-ink">ARION</div>
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3 mt-0.5" aria-live="polite">
            <span className={`w-1.5 h-1.5 rounded-full ${state === "idle" ? "bg-ink-3" : "bg-accent animate-pulse"}`} />
            {STATE_LABEL[state]}
            {status && !status.ki && <span className="text-warn">· KI aus</span>}
          </div>
        </div>
        <div className="flex items-center">
          {wakeSupported && (
            <button
              onClick={toggleWake}
              aria-label={wakeOn ? "Weckruf aus" : "Weckruf „Hey ARION“ an"}
              title={wakeOn ? (wakeListening ? "Hört auf „Hey ARION“ – tippen zum Ausschalten" : "Weckruf an") : "Weckruf „Hey ARION“ einschalten"}
              className={`w-10 h-10 rounded-full flex items-center justify-center hover:bg-inset transition-colors ${wakeOn ? "text-accent" : "text-ink-3"}`}
            >
              <Icon name={wakeOn ? "hearing" : "hearing_disabled"} size={21} />
            </button>
          )}
          <button
            onClick={toggleVoice}
            aria-label={voiceOn ? "Stimme aus" : "Stimme an"}
            title={voiceOn ? "Stimme aus" : "Stimme an"}
            className={`w-10 h-10 rounded-full flex items-center justify-center hover:bg-inset transition-colors ${voiceOn ? "text-ink-2" : "text-ink-3"}`}
          >
            <Icon name={voiceOn ? "volume_up" : "volume_off"} size={21} />
          </button>
          <button
            onClick={newConversation}
            aria-label="Neues Gespräch"
            title="Neues Gespräch"
            className="w-10 h-10 rounded-full flex items-center justify-center text-ink-2 hover:text-ink hover:bg-inset transition-colors"
          >
            <Icon name="restart_alt" size={21} />
          </button>
        </div>
      </header>

      <div className="relative z-10 flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Reaktor + Live-Text */}
        <section className="flex flex-col items-center shrink-0 lg:flex-1 lg:justify-center px-4 pt-1 lg:pt-0">
          <div className="relative aspect-square w-[min(72vw,34dvh,300px)] lg:w-[min(46vw,58dvh,520px)]">
            <Reactor state={state} frame={frame} />
          </div>
          <div className="min-h-[52px] lg:min-h-[72px] max-w-[560px] w-full text-center mt-2 px-2">
            {live && transcript ? (
              <p className="text-[17px] lg:text-[20px] leading-snug text-ink">{transcript}</p>
            ) : state === "listening" ? (
              <p className="text-[15px] text-ink-3">{freehand ? "Sprich einfach – ich höre bis zur Pause zu." : "Sprich jetzt …"}</p>
            ) : error ? (
              <p className="text-[13px] text-warn">{error}</p>
            ) : !latest ? (
              <p className="text-[13px] text-ink-3">
                Knopf halten und sprechen<span className="hidden lg:inline"> – oder Leertaste halten</span>.
              </p>
            ) : null}
          </div>
        </section>

        {/* Kennzahlen + Gespräch */}
        <aside className="flex-1 min-h-0 flex flex-col lg:w-[400px] lg:flex-none lg:border-l lg:border-line lg:bg-[rgba(255,255,255,0.02)]">
          <div className="grid grid-cols-4 lg:grid-cols-2 gap-2 px-4 sm:px-6 lg:px-5 lg:pt-5 shrink-0">
            {cards.map((c) => (
              <Link
                key={c.label}
                href={c.href}
                className={`rounded-[12px] border border-line bg-card backdrop-blur-md px-2.5 py-2 lg:px-3.5 lg:py-3 min-w-0 transition-colors hover:border-accent/40 ${
                  c.active ? "" : "opacity-60"
                }`}
              >
                <div className="flex items-center gap-1 text-ink-3">
                  <Icon name={c.icon} size={14} className={c.active ? "text-accent" : ""} />
                  <span className="text-[10px] lg:text-[11px] truncate">
                    <span className="lg:hidden">{c.short}</span>
                    <span className="hidden lg:inline">{c.label}</span>
                  </span>
                </div>
                <div className={`mt-1 text-[15px] lg:text-[20px] font-semibold tracking-tight truncate ${c.active ? "text-ink" : "text-ink-3"}`}>
                  {c.compact ? (
                    <>
                      <span className="lg:hidden">{c.compact}</span>
                      <span className="hidden lg:inline">{c.value}</span>
                    </>
                  ) : (
                    c.value
                  )}
                </div>
                <div className="text-[10px] lg:text-[11px] text-ink-3 truncate">{c.meta}</div>
              </Link>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 lg:px-5 pt-3 pb-2 space-y-2.5 select-text">
            {turns.length === 0 && (
              <div className="flex flex-wrap justify-center lg:justify-start gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      unlock();
                      if (stateRef.current === "thinking") return;
                      setTranscript(s);
                      void ask(s, "text");
                    }}
                    className="h-9 px-3.5 rounded-full border border-line bg-card text-[13px] text-ink-2 hover:text-ink hover:border-accent/40 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {turns.map((t, i) => (
              <article
                key={t.id}
                className={`rounded-card border border-line bg-card backdrop-blur-md px-4 py-3 ${i > 0 ? "opacity-70" : ""}`}
              >
                <div className="flex items-start gap-2 text-[12px] text-ink-3">
                  <Icon name="person" size={15} className="mt-px" />
                  <span className="text-ink-2">{t.q}</span>
                </div>
                <div className="mt-2 flex items-start gap-2">
                  <Icon name="graphic_eq" size={15} className={`mt-[3px] ${t.failed ? "text-warn" : "text-accent"}`} />
                  {t.a === null ? (
                    <div className="flex items-center gap-1 h-5" aria-label="Denke nach">
                      <span className="thinking-dot" />
                      <span className="thinking-dot [animation-delay:0.15s]" />
                      <span className="thinking-dot [animation-delay:0.3s]" />
                    </div>
                  ) : (
                    <p className="text-[14px] lg:text-[15px] leading-relaxed text-ink whitespace-pre-wrap">{stripMd(t.a)}</p>
                  )}
                </div>
                {t.actions.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 pl-[23px]">
                    {t.actions.map((a, j) =>
                      a.type === "task_created" ? (
                        <Link
                          key={j}
                          href="/aufgaben"
                          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-accent-soft text-accent text-[12px] font-medium"
                        >
                          <Icon name="add_task" size={15} />
                          Aufgabe angelegt{a.due_date ? ` · ${shortDate(a.due_date)}` : ""}
                        </Link>
                      ) : (
                        <Link
                          key={j}
                          href={a.href}
                          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-inset text-ink-2 hover:text-ink text-[12px]"
                        >
                          {a.label}
                          <Icon name="arrow_forward" size={14} />
                        </Link>
                      )
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </aside>
      </div>

      {/* Bedienleiste */}
      <footer className="relative z-10 shrink-0 px-4 sm:px-6 pt-2 pb-[max(16px,env(safe-area-inset-bottom))]">
        {showInput && (
          <form onSubmit={submitText} className="max-w-[560px] mx-auto mb-3 flex items-center gap-2">
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Frage tippen …"
              enterKeyHint="send"
              className="flex-1 h-11 rounded-full bg-inset border border-line px-4 text-[15px] text-ink placeholder:text-ink-3 outline-none focus:border-accent/50"
            />
            <button
              type="submit"
              aria-label="Senden"
              disabled={!input.trim() || state === "thinking"}
              className="w-11 h-11 rounded-full bg-accent text-on-accent flex items-center justify-center disabled:opacity-40"
            >
              <Icon name="arrow_upward" size={22} />
            </button>
          </form>
        )}
        <div className="flex items-center justify-center gap-6 sm:gap-10">
          <button
            onClick={() => setShowInput((v) => !v)}
            aria-label="Tastatur"
            title="Frage tippen"
            className={`w-12 h-12 rounded-full border border-line flex items-center justify-center transition-colors ${
              showInput ? "bg-accent-soft text-accent" : "bg-card text-ink-2 hover:text-ink"
            }`}
          >
            <Icon name="keyboard" size={22} />
          </button>

          <button
            onPointerDown={onPressStart}
            onPointerUp={onPressEnd}
            onPointerCancel={onPressEnd}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              // Tastatur-Bedienung: Enter = Freihand an/aus
              if (e.key !== "Enter") return;
              e.preventDefault();
              unlock();
              if (stateRef.current === "listening") stopListening();
              else if (stateRef.current !== "thinking") begin("toggle");
            }}
            aria-label={state === "listening" ? "Zuhören beenden" : "Halten zum Sprechen"}
            aria-pressed={state === "listening"}
            className={`arion-ptt relative w-[84px] h-[84px] rounded-full flex items-center justify-center touch-none transition-transform duration-150 ${
              state === "listening"
                ? "bg-accent text-on-accent scale-110 shadow-[0_0_0_10px_var(--color-accent-soft),0_0_48px_var(--color-accent-soft)]"
                : state === "thinking"
                  ? "bg-card border border-line text-ink-3"
                  : "bg-accent-soft border border-accent/40 text-accent active:scale-95"
            }`}
          >
            <Icon name={state === "listening" ? "graphic_eq" : state === "speaking" ? "stop" : "mic"} size={36} />
          </button>

          <button
            onClick={() => {
              speakToken.current++;
              stopSpeaking();
              if (stateRef.current === "speaking") setState("idle");
              else if (latest?.a) {
                unlock();
                const token = ++speakToken.current;
                setState("speaking");
                void speak(latest.spoken || stripMd(latest.a), Boolean(statusRef.current?.tts)).then(() => {
                  if (token === speakToken.current && stateRef.current === "speaking") setState("idle");
                });
              }
            }}
            disabled={!latest?.a && state !== "speaking"}
            aria-label={state === "speaking" ? "Vorlesen stoppen" : "Antwort wiederholen"}
            title={state === "speaking" ? "Vorlesen stoppen" : "Antwort wiederholen"}
            className="w-12 h-12 rounded-full border border-line bg-card flex items-center justify-center text-ink-2 hover:text-ink transition-colors disabled:opacity-40"
          >
            <Icon name={state === "speaking" ? "stop_circle" : "replay"} size={22} />
          </button>
        </div>
        <p className="text-center text-[11px] text-ink-3 mt-2">
          {state === "listening" && freehand ? "Tippen zum Beenden" : "Halten zum Sprechen · Tippen für Freihand"}
        </p>
      </footer>
    </div>
  );
}
