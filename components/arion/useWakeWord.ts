"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isWakePhrase } from "@/lib/arion-wake";

/**
 * „Hey ARION“ im Browser: solange die ARION-Seite offen und sichtbar ist, läuft
 * eine eigene, durchgehende Spracherkennung (Web Speech API, de-DE) und wartet
 * auf das Weckwort. Während ARION zuhört/denkt/spricht ist sie pausiert – zwei
 * Erkennungen gleichzeitig erlaubt der Browser nicht.
 *
 * Funktioniert in Chrome/Edge am Mac und auf Android. Safari auf dem iPhone
 * beendet die Dauer-Erkennung nach kurzer Zeit – dort meldet `supported` false.
 */

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { length: number; [j: number]: { transcript: string } } } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
type RecCtor = new () => Rec;

function recCtor(): RecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function useWakeWord({ enabled, paused, onWake, onBlocked }: { enabled: boolean; paused: boolean; onWake: () => void; onBlocked: (msg: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [lauscht, setLauscht] = useState(false);
  const rec = useRef<Rec | null>(null);
  const want = useRef(false);
  const restartRef = useRef<() => void>(() => {});
  const onWakeRef = useRef(onWake);
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onWakeRef.current = onWake;
    onBlockedRef.current = onBlocked;
  }, [onWake, onBlocked]);

  useEffect(() => {
    const t = setTimeout(() => setSupported(Boolean(recCtor()) && !isIOS()), 0);
    return () => clearTimeout(t);
  }, []);

  const stop = useCallback(() => {
    want.current = false;
    const r = rec.current;
    rec.current = null;
    if (r) {
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      try {
        r.abort();
      } catch {
        /* schon beendet */
      }
    }
    setLauscht(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = recCtor();
    if (!Ctor || rec.current) return;
    want.current = true;
    const r = new Ctor();
    r.lang = "de-DE";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0]?.transcript ?? "";
        if (isWakePhrase(text)) {
          stop();
          onWakeRef.current();
          return;
        }
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stop();
        onBlockedRef.current("Mikrofon für den Weckruf nicht erlaubt – bitte in den Browser-Einstellungen freigeben.");
      }
      // „no-speech“, „network“, „aborted“: onend startet neu
    };
    r.onend = () => {
      rec.current = null;
      setLauscht(false);
      // Chrome beendet die Dauer-Erkennung regelmäßig → still neu starten
      if (want.current && document.visibilityState === "visible") setTimeout(() => want.current && restartRef.current(), 400);
    };
    try {
      r.start();
      rec.current = r;
      setLauscht(true);
    } catch {
      rec.current = null;
    }
  }, [stop]);
  useEffect(() => {
    restartRef.current = start;
  }, [start]);

  // An/aus je nach Schalter, Gesprächszustand und Sichtbarkeit
  useEffect(() => {
    if (!supported) return;
    const sync = () => {
      if (enabled && !paused && document.visibilityState === "visible") start();
      else stop();
    };
    const t = setTimeout(sync, paused ? 0 : 300);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [enabled, paused, supported, start, stop]);

  useEffect(() => stop, [stop]);

  return { supported, lauscht };
}
