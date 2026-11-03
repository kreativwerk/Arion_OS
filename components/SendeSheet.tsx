"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Icon } from "@/components/ui";
import type { WartetItem } from "@/lib/home-data";

/**
 * Sende-Popup für Entwürfe (Heute → „Nur du kannst: senden“).
 *
 * Ablauf: Albert sieht Absender, Empfänger, Text und Anhänge und schiebt den
 * Regler nach rechts. Der Brief faltet sich zum Papierflieger, solange der
 * Server sendet; bei Erfolg fliegt er davon, bei Fehler entfaltet er sich wieder.
 * Ohne Bewegung (prefers-reduced-motion) gibt es nur den Haken.
 *
 * Die Animation ist reines SVG: drei Dreiecke, deren Punkte per
 * requestAnimationFrame vom Brief zum Flieger interpoliert werden. Das läuft
 * auch in Safari/iOS, wo CSS-Pfad-Animationen fehlen.
 */

type P = [number, number];
type Tri = [P, P, P];

// Brief (Blatt 60 × 70) als drei Dreiecke – das dritte ist ein Punkt in der Mitte
const BRIEF: Tri[] = [
  [[30, 25], [90, 25], [30, 95]],
  [[90, 25], [90, 95], [30, 95]],
  [[60, 60], [60, 60], [60, 60]],
];
// Papierflieger (seitlich, Spitze rechts): Oberflügel, Unterflügel, Kiel
const FLIEGER: Tri[] = [
  [[16, 40], [104, 58], [54, 67]],
  [[54, 67], [104, 58], [38, 88]],
  [[54, 67], [38, 88], [49, 76]],
];

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mix = (a: Tri[], b: Tri[], t: number): Tri[] =>
  a.map((tri, i) => tri.map((p, j) => [p[0] + (b[i]![j]![0] - p[0]) * t, p[1] + (b[i]![j]![1] - p[1]) * t]) as Tri);
const punkte = (tri: Tri) => tri.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");

type Phase = "bereit" | "falten" | "wartet" | "fliegen" | "fertig" | "fehler";

function wenigBewegung() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Brief ↔ Papierflieger. `t` = 0 Brief, 1 Flieger. */
function Flieger({ t, phase }: { t: number; phase: Phase }) {
  const tris = mix(BRIEF, FLIEGER, ease(t));
  const zeilen = Math.max(0, 1 - t * 3); // Textzeilen verschwinden früh beim Falten
  return (
    <div className="relative h-40 flex items-center justify-center overflow-hidden" aria-hidden>
      <div className="absolute inset-x-10 top-1/2 h-24 -translate-y-1/2 rounded-full bg-accent-soft blur-2xl opacity-70" />
      {/* Flugspur */}
      <svg viewBox="0 0 320 160" className="absolute inset-0 w-full h-full pointer-events-none">
        <path
          d="M150 92 C 200 90, 230 60, 330 -10"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100 100"
          className={`sende-spur ${phase === "fliegen" || phase === "fertig" ? "sende-spur-an" : ""}`}
        />
      </svg>
      <div className={`relative w-[120px] h-[120px] ${phase === "wartet" ? "sende-schweben" : ""} ${phase === "fliegen" || phase === "fertig" ? "sende-wegfliegen" : ""} ${phase === "fertig" ? "opacity-0" : ""}`}>
        <svg viewBox="0 0 120 120" className="w-full h-full drop-shadow-[0_10px_24px_rgba(0,0,0,0.45)]">
          <defs>
            <linearGradient id="sende-blatt" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f4f6f5" />
              <stop offset="1" stopColor="#cfd6d2" />
            </linearGradient>
            <linearGradient id="sende-fluegel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#e9fbf2" />
              <stop offset="1" stopColor="var(--color-accent)" />
            </linearGradient>
          </defs>
          <polygon points={punkte(tris[0]!)} fill="url(#sende-blatt)" stroke="url(#sende-blatt)" strokeWidth={0.8} strokeLinejoin="round" />
          <polygon
            points={punkte(tris[1]!)}
            fill={t > 0.5 ? "url(#sende-fluegel)" : "url(#sende-blatt)"}
            stroke={t > 0.5 ? "url(#sende-fluegel)" : "url(#sende-blatt)"}
            strokeWidth={0.8}
            strokeLinejoin="round"
          />
          <polygon points={punkte(tris[2]!)} fill="#1f8f5f" opacity={t} />
          {zeilen > 0 && (
            <g stroke="#8a948f" strokeWidth="2.2" strokeLinecap="round" opacity={zeilen}>
              <line x1="38" y1="38" x2="66" y2="38" />
              <line x1="38" y1="50" x2="82" y2="50" />
              <line x1="38" y1="60" x2="82" y2="60" />
              <line x1="38" y1="70" x2="74" y2="70" />
              <line x1="38" y1="82" x2="58" y2="82" />
            </g>
          )}
        </svg>
      </div>
      {phase === "fertig" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="w-14 h-14 rounded-full bg-accent text-on-accent flex items-center justify-center animate-check-pop">
            <Icon name="check" size={30} />
          </span>
          <span className="text-[14px] font-medium">Gesendet</span>
        </div>
      )}
    </div>
  );
}

/** „Zum Senden schieben“ – Regler mit Zeiger/Touch, per Tastatur Enter/Leertaste. */
function SendeRegler({ onSenden, gesperrt }: { onSenden: () => void; gesperrt: boolean }) {
  const spur = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; basis: number } | null>(null);
  const [x, setX] = useState(0);
  const [zieht, setZieht] = useState(false);
  const [breite, setBreite] = useState(0);
  const KNOPF = 52;
  const PAD = 4;

  useEffect(() => {
    const el = spur.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBreite(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxX = () => Math.max(0, breite - KNOPF - PAD * 2);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Regler nach Fehler/Abbruch zurücksetzen
    if (!gesperrt) setX(0);
  }, [gesperrt]);

  const loslassen = () => {
    if (!start.current) return;
    start.current = null;
    setZieht(false);
    if (x >= maxX() * 0.88) {
      setX(maxX());
      onSenden();
    } else {
      setX(0);
    }
  };

  const anteil = maxX() ? x / maxX() : 0;

  return (
    <div
      ref={spur}
      className={`relative h-[60px] rounded-full bg-inset border border-line overflow-hidden select-none touch-none ${gesperrt ? "opacity-60" : ""}`}
    >
      <div className="absolute inset-y-0 left-0 bg-accent-soft rounded-full" style={{ width: x + KNOPF + PAD * 2 }} />
      <div
        className="absolute inset-0 flex items-center justify-center pl-12 text-[14px] font-medium text-ink-2 pointer-events-none"
        style={{ opacity: 1 - anteil * 1.4 }}
      >
        <span className="sende-schimmer">Zum Senden schieben</span>
      </div>
      <button
        type="button"
        disabled={gesperrt}
        aria-label="Zum Senden schieben oder Enter drücken"
        onKeyDown={(e) => {
          if (!gesperrt && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setX(maxX());
            onSenden();
          }
        }}
        onPointerDown={(e) => {
          if (gesperrt) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          start.current = { x: e.clientX, basis: x };
          setZieht(true);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          setX(Math.min(maxX(), Math.max(0, start.current.basis + e.clientX - start.current.x)));
        }}
        onPointerUp={loslassen}
        onPointerCancel={loslassen}
        className={`absolute top-[3px] w-[52px] h-[52px] rounded-full bg-accent text-on-accent flex items-center justify-center shadow-[0_4px_16px_rgba(62,207,142,0.35)] ${
          zieht ? "" : "transition-[left] duration-300 ease-out"
        } cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground`}
        style={{ left: PAD + x }}
      >
        <Icon name={anteil > 0.88 ? "send" : "arrow_forward"} size={24} />
      </button>
    </div>
  );
}

export default function SendeSheet({
  entwurf,
  onClose,
  onGesendet,
}: {
  entwurf: WartetItem | null;
  onClose: () => void;
  onGesendet: (hinweis: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("bereit");
  const [t, setT] = useState(0);
  const [fehler, setFehler] = useState("");
  const ergebnis = useRef<{ ok: boolean; text: string } | null>(null);
  const tRef = useRef(0);
  const frame = useRef<number | null>(null);

  // Zustand zurücksetzen, wenn ein anderer Entwurf geöffnet wird
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- frischer Start pro Entwurf */
    setPhase("bereit");
    setT(0);
    setFehler("");
    /* eslint-enable react-hooks/set-state-in-effect */
    tRef.current = 0;
    ergebnis.current = null;
  }, [entwurf?.id]);

  useEffect(() => () => void (frame.current && cancelAnimationFrame(frame.current)), []);

  // Escape schließt (nicht während des Sendens)
  useEffect(() => {
    if (!entwurf) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && (phase === "bereit" || phase === "fehler") && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [entwurf, phase, onClose]);

  const morph = useCallback((ziel: number, dauer: number) => {
    return new Promise<void>((fertig) => {
      const von = tRef.current;
      const t0 = performance.now();
      const schritt = (jetzt: number) => {
        const p = Math.min(1, (jetzt - t0) / dauer);
        tRef.current = von + (ziel - von) * p;
        setT(tRef.current);
        if (p < 1) frame.current = requestAnimationFrame(schritt);
        else fertig();
      };
      frame.current = requestAnimationFrame(schritt);
    });
  }, []);

  const abschliessen = useCallback(
    async (r: { ok: boolean; text: string }) => {
      const ruhig = wenigBewegung();
      if (r.ok) {
        setPhase(ruhig ? "fertig" : "fliegen");
        if (!ruhig) {
          await new Promise((ok) => setTimeout(ok, 900));
          setPhase("fertig");
        }
        await new Promise((ok) => setTimeout(ok, 1300));
        onGesendet(r.text);
      } else {
        setFehler(r.text);
        if (!ruhig) await morph(0, 450);
        else {
          tRef.current = 0;
          setT(0);
        }
        setPhase("fehler");
      }
    },
    [morph, onGesendet]
  );

  const senden = useCallback(async () => {
    if (!entwurf || (phase !== "bereit" && phase !== "fehler")) return;
    setFehler("");
    ergebnis.current = null;
    const ruhig = wenigBewegung();
    setPhase("falten");

    const anfrage = fetch("/api/mail/drafts/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: entwurf.id }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) return { ok: false, text: data?.error ?? `Server-Fehler ${res.status}` };
        return { ok: true, text: data.hinweis ? `Gesendet. ${data.hinweis}` : "Gesendet." };
      })
      .catch((e: unknown) => ({ ok: false, text: e instanceof Error ? e.message : String(e) }));
    void anfrage.then((r) => {
      ergebnis.current = r;
    });

    if (!ruhig) await morph(1, 750);
    else {
      tRef.current = 1;
      setT(1);
    }
    // Server noch nicht fertig? Flieger schwebt, bis die Antwort da ist.
    let r: { ok: boolean; text: string } | null = ergebnis.current;
    if (!r) {
      setPhase("wartet");
      r = await anfrage;
    }
    await abschliessen(r);
  }, [entwurf, phase, morph, abschliessen]);

  if (!entwurf) return null;
  const laeuft = phase === "falten" || phase === "wartet" || phase === "fliegen" || phase === "fertig";

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Entwurf senden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm sende-einblenden" onClick={() => !laeuft && onClose()} />
      <div className="relative w-full max-w-[560px] max-h-[92dvh] flex flex-col bg-[#17191a] border border-line rounded-t-[22px] sm:rounded-[22px] shadow-[0_-8px_40px_rgba(0,0,0,0.5)] sende-hochfahren">
        <div className="w-10 h-1 rounded-full bg-ink-3/40 mx-auto mt-3 shrink-0 sm:hidden" />
        <button
          type="button"
          onClick={onClose}
          disabled={laeuft}
          aria-label="Schließen"
          className="absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-ink-3 hover:text-ink hover:bg-inset disabled:opacity-30"
        >
          <Icon name="close" size={20} />
        </button>

        <Flieger t={t} phase={phase} />

        <div className={`px-5 overflow-y-auto space-y-3 transition-opacity duration-300 ${laeuft ? "opacity-40" : ""}`}>
          <div className="text-[16px] font-semibold leading-snug pr-8">{entwurf.betreff || "(ohne Betreff)"}</div>
          <div className="text-[12px] text-ink-2 space-y-0.5">
            <div>
              <span className="text-ink-3">Von </span>
              {entwurf.von || "–"}
            </div>
            <div>
              <span className="text-ink-3">An </span>
              {entwurf.an}
            </div>
          </div>
          {entwurf.vorschau && (
            <p className="text-[13px] text-ink-2 leading-relaxed whitespace-pre-line rounded-[10px] bg-inset px-3.5 py-3 max-h-40 overflow-y-auto">{entwurf.vorschau}</p>
          )}
          {entwurf.anhaenge.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {entwurf.anhaenge.map((f) => (
                <Badge key={f}>
                  <Icon name="attach_file" size={13} className="mr-1" />
                  {f}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 pt-4 pb-[max(20px,env(safe-area-inset-bottom))] space-y-3 shrink-0">
          {fehler && (
            <p className="text-[12px] text-bad flex items-start gap-1.5" role="alert">
              <Icon name="error" size={16} className="mt-px" />
              {fehler}
            </p>
          )}
          <SendeRegler onSenden={senden} gesperrt={laeuft} />
          <div className="flex justify-center">
            <Link href="/postfach?ansicht=entwuerfe" className={`text-[13px] text-accent ${laeuft ? "pointer-events-none opacity-40" : ""}`}>
              Im Postfach bearbeiten
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
