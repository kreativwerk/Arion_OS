"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";

/**
 * Ernährungs-Zeile fürs Dashboard: Wasser (+250 ml → 2,5 l), Proteine
 * (+35 g → 140 g) und Vitamin (ein Tipp = erledigt). Füllstand schiebt sich
 * animiert, tägliches Reset über das Datum, und bei Zielerreichung wird die
 * passende Gewohnheit serverseitig automatisch abgehakt.
 */

type Metric = { amount: number; goal: number; step: number };
type State = { water: Metric; protein: Metric; vitamin: Metric };

const EMPTY: State = {
  water: { amount: 0, goal: 2500, step: 250 },
  protein: { amount: 0, goal: 140, step: 35 },
  vitamin: { amount: 0, goal: 1, step: 1 },
};

export default function NutritionTracker() {
  const [state, setState] = useState<State>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [taps, setTaps] = useState({ water: 0, protein: 0, vitamin: 0 });

  useEffect(() => {
    fetch("/api/nutrition", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setState(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const change = async (kind: keyof State, delta: number) => {
    setState((s) => ({
      ...s,
      [kind]: { ...s[kind], amount: Math.max(0, s[kind].amount + delta) },
    }));
    if (delta > 0) setTaps((t) => ({ ...t, [kind]: t[kind] + 1 }));
    try {
      const res = await fetch("/api/nutrition", {
        method: "POST",
        body: JSON.stringify({ kind, delta }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d) setState(d);
    } catch {
      /* Offline: optimistischer Stand bleibt sichtbar */
    }
  };

  const liters = (n: number) => (n / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 });

  const pill = (
    kind: "water" | "protein",
    icon: string,
    label: string,
    value: string,
    goalLabel: string
  ) => {
    const m = state[kind];
    const pct = Math.min(100, (m.amount / m.goal) * 100);
    const done = m.amount >= m.goal;
    return (
      <button
        onClick={() => change(kind, m.step)}
        disabled={!loaded}
        aria-label={`${label}: +${m.step} hinzufügen`}
        className="relative flex-1 min-w-0 h-14 rounded-full border border-line bg-card shadow-card overflow-hidden text-left transition-all active:scale-[0.98] disabled:opacity-60"
      >
        <div
          className={`absolute inset-y-0 left-0 transition-all duration-700 ease-out ${
            done ? "bg-accent/30" : "bg-gradient-to-r from-accent/12 to-accent/28"
          }`}
          style={{ width: `${pct}%` }}
        />
        {pct > 0 && pct < 100 && (
          <div
            className="absolute inset-y-2 w-[2px] rounded-full bg-accent/70 transition-all duration-700 ease-out"
            style={{ left: `calc(${pct}% - 1px)` }}
          />
        )}
        <div className="relative h-full pl-2 pr-1 flex items-center gap-1.5">
          <div className="relative w-7 h-7 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <Icon name={done ? "check" : icon} size={16} />
            {taps[kind] > 0 && (
              <span key={taps[kind]} className="water-drop-fly" aria-hidden>
                <Icon name={icon} size={14} />
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div
              key={`v${taps[kind]}`}
              className={`text-[13px] font-bold leading-tight tabular-nums whitespace-nowrap water-bump ${done ? "text-accent" : ""}`}
            >
              {value}
            </div>
            <div className="hidden min-[350px]:block text-[10px] text-ink-3 leading-tight truncate">
              {m.amount > 0 ? `von ${goalLabel}` : `${label} · ${goalLabel}`}
            </div>
          </div>
          {m.amount > 0 && (
            <span
              role="button"
              tabIndex={0}
              aria-label={`${label}: einen Schritt zurück`}
              onClick={(e) => {
                e.stopPropagation();
                change(kind, -m.step);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  change(kind, -m.step);
                }
              }}
              className="hidden min-[370px]:flex w-6 h-6 rounded-full items-center justify-center text-ink-3 hover:text-bad hover:bg-inset transition-all shrink-0"
            >
              <Icon name="remove" size={15} />
            </span>
          )}
        </div>
      </button>
    );
  };

  const vitaminDone = state.vitamin.amount >= state.vitamin.goal;

  return (
    <div className="flex gap-2 mb-5">
      {pill("water", "water_drop", "Wasser", `${liters(state.water.amount)} l`, `${liters(state.water.goal)} l`)}
      {pill("protein", "egg_alt", "Protein", `${state.protein.amount} g`, `${state.protein.goal} g`)}
      <button
        onClick={() => change("vitamin", vitaminDone ? -1 : 1)}
        disabled={!loaded}
        aria-label={vitaminDone ? "Vitamine: erledigt (Tipp macht rückgängig)" : "Vitamine genommen"}
        title="Vitamine"
        className={`relative w-14 h-14 rounded-full border shrink-0 flex items-center justify-center transition-all active:scale-95 disabled:opacity-60 ${
          vitaminDone
            ? "bg-accent border-accent text-on-accent animate-check-pop shadow-[0_4px_18px_rgba(62,207,142,0.35)]"
            : "bg-card border-line text-accent shadow-card"
        }`}
      >
        <Icon name={vitaminDone ? "check" : "medication"} size={22} />
        {taps.vitamin > 0 && !vitaminDone && (
          <span key={taps.vitamin} className="water-drop-fly" aria-hidden>
            <Icon name="medication" size={14} />
          </span>
        )}
      </button>
    </div>
  );
}
