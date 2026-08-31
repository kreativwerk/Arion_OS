"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";

/**
 * Wasser-Tracker fürs Dashboard: breiter Schiebe-Button, der sich pro Tipp
 * (+250 ml) Richtung Tagesziel (2,5 l) füllt. Tägliches Reset über das Datum
 * in der water_log-Tabelle. Tropfen- und Füll-Animation beim Tippen.
 */
export default function WaterTracker() {
  const [ml, setMl] = useState(0);
  const [goal, setGoal] = useState(2500);
  const [step, setStep] = useState(250);
  const [loaded, setLoaded] = useState(false);
  const [taps, setTaps] = useState(0); // key für die Tropfen-Animation

  useEffect(() => {
    fetch("/api/water", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setMl(d.ml);
          setGoal(d.goal);
          setStep(d.step);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const change = async (delta: number) => {
    setMl((m) => Math.max(0, m + delta)); // optimistisch
    if (delta > 0) setTaps((t) => t + 1);
    try {
      const res = await fetch("/api/water", { method: "POST", body: JSON.stringify({ delta }) });
      const d = await res.json().catch(() => null);
      if (res.ok && d) setMl(d.ml);
    } catch {
      /* Offline: der optimistische Stand bleibt sichtbar */
    }
  };

  const pct = Math.min(100, (ml / goal) * 100);
  const done = ml >= goal;
  const liters = (n: number) => (n / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 });

  return (
    <button
      onClick={() => change(step)}
      disabled={!loaded}
      aria-label={`Wasser trinken: ${step} ml hinzufügen`}
      className="relative w-full h-14 mb-5 rounded-full border border-line bg-card shadow-card overflow-hidden text-left transition-all active:scale-[0.99] disabled:opacity-60"
    >
      {/* Füllstand: schiebt sich pro Tipp weiter nach rechts */}
      <div
        className={`absolute inset-y-0 left-0 transition-all duration-700 ease-out ${
          done ? "bg-accent/30" : "bg-gradient-to-r from-accent/12 to-accent/28"
        }`}
        style={{ width: `${pct}%` }}
      />
      {/* Leuchtkante am Füllstand */}
      {pct > 0 && pct < 100 && (
        <div
          className="absolute inset-y-2 w-[2px] rounded-full bg-accent/70 transition-all duration-700 ease-out"
          style={{ left: `calc(${pct}% - 1px)` }}
        />
      )}

      <div className="relative h-full px-4 flex items-center gap-3">
        <div className="relative w-9 h-9 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
          <Icon name={done ? "check" : "water_drop"} size={20} />
          {/* aufsteigender Tropfen bei jedem Tipp */}
          {taps > 0 && (
            <span key={taps} className="water-drop-fly" aria-hidden>
              <Icon name="water_drop" size={16} />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold leading-tight">
            {done ? "Ziel erreicht!" : "Wasser trinken"}
          </div>
          <div className="text-[11px] text-ink-3 leading-tight">
            {done ? `Stark – ${liters(ml)} l heute` : `+${step} ml pro Tipp · täglich ${liters(goal)} l`}
          </div>
        </div>
        <div key={`n${taps}`} className={`text-[15px] font-bold tabular-nums water-bump ${done ? "text-accent" : ""}`}>
          {liters(ml)}
          <span className="text-[11px] font-medium text-ink-3"> / {liters(goal)} l</span>
        </div>
        {ml > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`${step} ml abziehen`}
            title="Zu viel getippt? Einen Schritt zurück"
            onClick={(e) => {
              e.stopPropagation();
              change(-step);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                change(-step);
              }
            }}
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-3 hover:text-bad hover:bg-inset transition-all shrink-0"
          >
            <Icon name="remove" size={18} />
          </span>
        )}
      </div>
    </button>
  );
}
