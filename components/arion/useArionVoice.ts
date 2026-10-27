"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * ARION – Stimme im Browser: Zuhören (STT), Vorlesen (TTS), Pegel für den Reaktor.
 *
 * STT:  1. Web Speech API (webkitSpeechRecognition, de-DE) mit Live-Transkript
 *       2. Fallback: MediaRecorder → POST /api/arion/stt (Whisper über Tunnel)
 * TTS:  1. POST /api/arion/tts (Server-Stimme, z. B. VoiceStudio) → AudioContext
 *       2. Fallback: speechSynthesis mit deutscher Stimme
 * Pegel: AnalyserNode auf Mikrofon bzw. Wiedergabe; bei speechSynthesis
 *       (kein Zugriff aufs Audio) ein synthetischer Pegel.
 */

export type ListenMode = "hold" | "toggle" | "wake";

export type VoiceFrame = { level: number; bins: Uint8Array | null };

type Handlers = {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  /** Aufnahme läuft wirklich (Mikrofon offen) bzw. ist beendet. */
  onListening: (active: boolean) => void;
  /** Fallback-Aufnahme wird gerade transkribiert. */
  onTranscribing?: () => void;
  /** Browser-Stimme bleibt stumm: „blocked“ = erst nach Klick erlaubt, „stuck“ = Sprachausgabe hängt. */
  onSpeechIssue?: (kind: "blocked" | "stuck") => void;
};

/* ── Minimal-Typen für die Web Speech API (nicht in lib.dom) ── */
type SpeechAlt = { transcript: string };
type SpeechResult = { isFinal: boolean; length: number; [i: number]: SpeechAlt };
type SpeechEvent = { resultIndex: number; results: { length: number; [i: number]: SpeechResult } };
interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecCtor = new () => SpeechRec;

function speechRecCtor(): SpeechRecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return "";
}

/** Wartezeit, bis eine Browser-Stimme loslegen muss – sonst gilt sie als hängend. */
const SPEECH_START_MS = 2500;

/** Deutsche Stimme wählen; `avoid` = Stimme, die gerade nicht losgelegt hat. */
function germanVoice(avoid?: string): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("de") && v.name !== avoid);
  if (!voices.length) return null;
  // Zweiter Versuch: lieber eine andere Art Stimme (Google-Stimme statt macOS-Stimme und umgekehrt)
  if (avoid) {
    const other = voices.find((v) => /google/i.test(v.name) !== /google/i.test(avoid));
    if (other) return other;
  }
  const preferred = ["Anna", "Helena", "Petra", "Markus", "Yannick", "Google Deutsch", "Microsoft Katja", "Microsoft Conrad"];
  for (const name of preferred) {
    const v = voices.find((x) => x.name.includes(name));
    if (v) return v;
  }
  return voices.find((v) => v.lang === "de-DE") ?? voices[0];
}

/**
 * Stille Äußerung zum Freischalten braucht nur Safari (iPhone und Mac). Chrome
 * merkt sich den ersten Klick selbst; dort kann die leere Äußerung die
 * Warteschlange blockieren.
 */
function needsSpeechUnlock(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return isIOS() || (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg\//.test(ua));
}

export function speechSupport() {
  return {
    webSpeech: Boolean(speechRecCtor()),
    recorder: typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    synthesis: typeof window !== "undefined" && "speechSynthesis" in window,
  };
}

export function useArionVoice(handlers: Handlers) {
  const h = useRef(handlers);
  useEffect(() => {
    h.current = handlers;
  }, [handlers]);

  const ctxRef = useRef<AudioContext | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const outAnalyser = useRef<AnalyserNode | null>(null);
  const active = useRef<"mic" | "out" | "synthetic" | null>(null);
  const bins = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const synthetic = useRef(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const webSpeechBroken = useRef(false);
  const transcriptRef = useRef("");
  const modeRef = useRef<ListenMode>("hold");
  const silenceTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivity = useRef(0);
  const startedAt = useRef(0);
  const heardSomething = useRef(false);

  const playing = useRef<AudioBufferSourceNode | null>(null);
  const ttsAbort = useRef<AbortController | null>(null);
  const speakDone = useRef<(() => void) | null>(null);
  /** Laufende Äußerung festhalten – Chrome räumt sie sonst weg und meldet nie „fertig“. */
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);

  /* ── Audio-Grundlage ───────────────────────────────────── */

  const ensureCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const mic = ctx.createAnalyser();
      mic.fftSize = 256;
      mic.smoothingTimeConstant = 0.75;
      const out = ctx.createAnalyser();
      out.fftSize = 256;
      out.smoothingTimeConstant = 0.7;
      out.connect(ctx.destination);
      ctxRef.current = ctx;
      micAnalyser.current = mic;
      outAnalyser.current = out;
      bins.current = new Uint8Array(new ArrayBuffer(mic.frequencyBinCount));
    }
    return ctxRef.current;
  }, []);

  /** Muss in einer Nutzergeste laufen (iOS): Audio + Sprachausgabe freischalten. */
  const unlock = useCallback(() => {
    const ctx = ensureCtx();
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
    if (typeof speechSynthesis !== "undefined" && needsSpeechUnlock() && !speechSynthesis.speaking) {
      try {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        speechSynthesis.speak(u);
      } catch {
        /* egal */
      }
    }
  }, [ensureCtx]);

  /** Aktueller Pegel 0…1 und Frequenzbänder – vom Reaktor pro Frame gelesen. */
  const frame = useCallback((): VoiceFrame => {
    const src = active.current;
    if (src === "synthetic") {
      synthetic.current *= 0.93;
      const t = performance.now() / 1000;
      return { level: Math.min(1, 0.18 + synthetic.current + 0.1 * Math.abs(Math.sin(t * 7.3))), bins: null };
    }
    const an = src === "mic" ? micAnalyser.current : src === "out" ? outAnalyser.current : null;
    if (!an || !bins.current) return { level: 0, bins: null };
    an.getByteFrequencyData(bins.current);
    let sum = 0;
    const n = Math.min(bins.current.length, 64);
    for (let i = 2; i < n; i++) sum += bins.current[i];
    const level = Math.min(1, (sum / (n - 2) / 255) * 2.2);
    return { level, bins: bins.current };
  }, []);

  /* ── Zuhören ───────────────────────────────────────────── */

  const clearSilence = useCallback(() => {
    if (silenceTimer.current) clearInterval(silenceTimer.current);
    silenceTimer.current = null;
  }, []);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (active.current === "mic" || active.current === "synthetic") active.current = null;
  }, []);

  const openMicLevel = useCallback(
    async (needStream: boolean): Promise<MediaStream | null> => {
      const ctx = ensureCtx();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        // Erkennung schon vorbei, bevor das Mikrofon offen war → gleich wieder schließen
        if (!needStream && !recRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return null;
        }
        streamRef.current = stream;
        if (ctx && micAnalyser.current) {
          ctx.createMediaStreamSource(stream).connect(micAnalyser.current);
          active.current = "mic";
        }
        return stream;
      } catch (e) {
        if (needStream) throw e;
        active.current = "synthetic";
        return null;
      }
    },
    [ensureCtx]
  );

  const finish = useCallback(() => {
    clearSilence();
    releaseMic();
    recRef.current = null;
    h.current.onListening(false);
    const text = transcriptRef.current.trim();
    transcriptRef.current = "";
    h.current.onFinal(text);
  }, [clearSilence, releaseMic]);

  const stopListening = useCallback(() => {
    clearSilence();
    if (recRef.current) {
      try {
        recRef.current.stop();
      } catch {
        finish();
      }
      return;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
      return;
    }
  }, [clearSilence, finish]);

  /** Freihand/Wake: nach Sprechpause automatisch beenden. */
  const watchSilence = useCallback(
    (useLevel: boolean) => {
      clearSilence();
      silenceTimer.current = setInterval(() => {
        const now = performance.now();
        const mode = modeRef.current;
        if (now - startedAt.current > (mode === "hold" ? 60_000 : 20_000)) return stopListening();
        if (mode === "hold") return;
        if (useLevel) {
          const lv = frame().level;
          if (lv > 0.12) {
            heardSomething.current = true;
            lastActivity.current = now;
          }
        }
        const quiet = now - lastActivity.current;
        if (heardSomething.current && quiet > 1700) stopListening();
        else if (!heardSomething.current && now - startedAt.current > 8000) stopListening();
      }, 150);
    },
    [clearSilence, frame, stopListening]
  );

  const startWebSpeech = useCallback(
    async (Ctor: SpeechRecCtor) => {
      const rec = new Ctor();
      rec.lang = "de-DE";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        let finalText = "";
        let interim = "";
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        transcriptRef.current = (finalText + " " + interim).replace(/\s+/g, " ").trim();
        heardSomething.current = true;
        lastActivity.current = performance.now();
        synthetic.current = 0.5;
        h.current.onInterim(transcriptRef.current);
      };
      rec.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        if (e.error === "service-not-allowed" || e.error === "language-not-supported") {
          // z. B. iOS-PWA ohne Siri/Diktat → künftig Aufnahme + Server-Erkennung
          webSpeechBroken.current = true;
        }
        const msg =
          e.error === "not-allowed"
            ? "Kein Mikrofonzugriff – bitte in den Einstellungen erlauben."
            : e.error === "network"
              ? "Spracherkennung braucht eine Internetverbindung."
              : e.error === "service-not-allowed"
                ? "Spracherkennung ist hier nicht verfügbar (Diktierfunktion aktiv?). Ich nutze ab jetzt die Aufnahme."
                : `Spracherkennung: ${e.error}`;
        h.current.onError(msg);
      };
      rec.onend = () => finish();
      recRef.current = rec;
      rec.start();
      h.current.onListening(true);
      // Pegel fürs Mikrofon – auf iOS nicht parallel zur Erkennung öffnen
      if (isIOS()) active.current = "synthetic";
      else void openMicLevel(false);
      watchSilence(false);
    },
    [finish, openMicLevel, watchSilence]
  );

  const startRecorder = useCallback(async () => {
    const stream = await openMicLevel(true);
    if (!stream) throw new Error("Kein Mikrofon");
    const mime = pickRecorderMime();
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = async () => {
      clearSilence();
      releaseMic();
      recorderRef.current = null;
      h.current.onListening(false);
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(chunks, { type });
      if (blob.size < 1200) return h.current.onFinal("");
      h.current.onTranscribing?.();
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      const form = new FormData();
      form.append("file", blob, `aufnahme.${ext}`);
      try {
        const res = await fetch("/api/arion/stt", { method: "POST", body: form });
        const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
        if (!res.ok) {
          h.current.onError(data?.error ?? `Spracherkennung fehlgeschlagen (${res.status}).`);
          return h.current.onFinal("");
        }
        h.current.onInterim(data?.text ?? "");
        h.current.onFinal(data?.text ?? "");
      } catch {
        h.current.onError("Spracherkennung nicht erreichbar.");
        h.current.onFinal("");
      }
    };
    recorderRef.current = rec;
    rec.start(250);
    h.current.onListening(true);
    watchSilence(true);
  }, [clearSilence, openMicLevel, releaseMic, watchSilence]);

  const startListening = useCallback(
    async (mode: ListenMode) => {
      modeRef.current = mode;
      transcriptRef.current = "";
      heardSomething.current = false;
      startedAt.current = performance.now();
      lastActivity.current = startedAt.current;
      const Ctor = speechRecCtor();
      try {
        if (Ctor && !webSpeechBroken.current) await startWebSpeech(Ctor);
        else if (speechSupport().recorder) await startRecorder();
        else {
          h.current.onError("Dieser Browser kann nicht zuhören. Tippe deine Frage.");
          h.current.onListening(false);
        }
      } catch (e) {
        clearSilence();
        releaseMic();
        recRef.current = null;
        h.current.onListening(false);
        const name = e instanceof Error ? e.name : "";
        h.current.onError(
          name === "NotAllowedError" ? "Kein Mikrofonzugriff – bitte in den Einstellungen erlauben." : "Mikrofon konnte nicht gestartet werden."
        );
      }
    },
    [clearSilence, releaseMic, startRecorder, startWebSpeech]
  );

  /** Modus während der Aufnahme wechseln (Halten → Freihand nach kurzem Tippen). */
  const setListenMode = useCallback((mode: ListenMode) => {
    modeRef.current = mode;
    lastActivity.current = performance.now();
  }, []);

  /* ── Vorlesen ──────────────────────────────────────────── */

  const stopSpeaking = useCallback(() => {
    ttsAbort.current?.abort();
    ttsAbort.current = null;
    try {
      playing.current?.stop();
    } catch {
      /* schon beendet */
    }
    playing.current = null;
    utterance.current = null;
    // Nur abbrechen, wenn wirklich etwas läuft: cancel() direkt vor speak() verschluckt in Chrome die neue Äußerung
    if (typeof speechSynthesis !== "undefined" && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
    if (active.current === "out" || active.current === "synthetic") active.current = null;
    speakDone.current?.();
    speakDone.current = null;
  }, []);

  const speakBrowser = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (typeof speechSynthesis === "undefined") return resolve();
      let done = false;
      let started = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const end = () => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        utterance.current = null;
        if (active.current === "synthetic") active.current = null;
        speakDone.current = null;
        resolve();
      };
      speakDone.current = end;

      const say = (attempt: number, avoid?: string) => {
        if (done) return;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "de-DE";
        const v = germanVoice(avoid);
        if (v) u.voice = v;
        u.rate = 1.04;
        u.pitch = 1;
        u.onstart = () => {
          started = true;
          active.current = "synthetic";
          synthetic.current = 0.4;
        };
        u.onboundary = () => {
          synthetic.current = 0.35 + Math.random() * 0.35;
        };
        u.onend = () => {
          if (utterance.current === u) end();
        };
        u.onerror = (e) => {
          if (utterance.current !== u) return; // alte Äußerung, bewusst abgebrochen
          if (e.error === "not-allowed") h.current.onSpeechIssue?.("blocked");
          end();
        };
        utterance.current = u;
        try {
          speechSynthesis.resume(); // Chrome bleibt sonst manchmal im Pause-Zustand hängen
          speechSynthesis.speak(u);
        } catch {
          return end();
        }
        // Wächter: legt die Stimme nicht los, einmal mit einer anderen Stimme versuchen, dann Hinweis
        timers.push(
          setTimeout(() => {
            if (done || started || utterance.current !== u) return;
            utterance.current = null;
            speechSynthesis.cancel();
            if (attempt === 0) timers.push(setTimeout(() => say(1, u.voice?.name), 150));
            else {
              h.current.onSpeechIssue?.("stuck");
              end();
            }
          }, SPEECH_START_MS)
        );
      };

      active.current = "synthetic";
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel();
        timers.push(setTimeout(() => say(0), 120));
      } else say(0);
      // Sicherheitsnetz: manche Browser feuern onend nie
      timers.push(setTimeout(end, Math.max(6000, text.length * 110) + 2 * SPEECH_START_MS));
    });
  }, []);

  /**
   * Antwort vorlesen. `serverTts`: Server-Stimme versuchen (ARION_TTS_URL aktiv).
   * Resolved, wenn fertig gesprochen oder abgebrochen – wirft nie.
   */
  const speak = useCallback(
    async (text: string, serverTts: boolean): Promise<void> => {
      stopSpeaking();
      if (!text.trim()) return;
      if (serverTts) {
        const ctx = ensureCtx();
        const abort = new AbortController();
        ttsAbort.current = abort;
        const timer = setTimeout(() => abort.abort(), 20_000);
        try {
          const res = await fetch("/api/arion/tts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
            signal: abort.signal,
          });
          if (res.ok && ctx && outAnalyser.current) {
            const buf = await ctx.decodeAudioData(await res.arrayBuffer());
            if (abort.signal.aborted) return;
            if (ctx.state !== "running") await ctx.resume().catch(() => {});
            await new Promise<void>((resolve) => {
              const src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(outAnalyser.current!);
              playing.current = src;
              active.current = "out";
              const end = () => {
                if (playing.current === src) playing.current = null;
                if (active.current === "out") active.current = null;
                speakDone.current = null;
                resolve();
              };
              speakDone.current = end;
              src.onended = end;
              src.start();
            });
            return;
          }
        } catch {
          if (abort.signal.aborted && ttsAbort.current !== abort) return; // bewusst abgebrochen
        } finally {
          clearTimeout(timer);
          if (ttsAbort.current === abort) ttsAbort.current = null;
        }
      }
      await speakBrowser(text);
    },
    [ensureCtx, speakBrowser, stopSpeaking]
  );

  /* ── Aufräumen ─────────────────────────────────────────── */

  useEffect(() => {
    // Stimmenliste laden (Chrome/iOS liefern sie asynchron)
    if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices();
    return () => {
      if (silenceTimer.current) clearInterval(silenceTimer.current);
      try {
        recRef.current?.abort();
      } catch {
        /* egal */
      }
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ttsAbort.current?.abort();
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  return { unlock, frame, startListening, stopListening, setListenMode, speak, stopSpeaking };
}
