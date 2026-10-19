"use client";

import { useEffect, useRef } from "react";
import type { VoiceFrame } from "@/components/arion/useArionVoice";

export type ArionState = "idle" | "listening" | "thinking" | "speaking";

/**
 * ARION-Reaktor: eigenständiges Canvas-Motiv aus Messring, Pegel-Strahlen,
 * gegenläufigen Segmentbögen und einem „atmenden“ Kern, dessen Kontur der
 * Stimme folgt. Farben kommen aus den Design-Tokens (--color-accent …).
 */

type RGB = [number, number, number];

function cssColor(name: string, fallback: RGB): RGB {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;

const SPEED: Record<ArionState, number> = { idle: 0.12, listening: 0.45, thinking: 2.1, speaking: 0.7 };

export default function Reactor({
  state,
  frame,
  className = "",
}: {
  state: ArionState;
  frame: () => VoiceFrame;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const frameRef = useRef(frame);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext("2d");
    if (!g) return;

    // Token-Farben (Fallback = Werte aus globals.css)
    const accent = cssColor("--color-accent", [62, 207, 142]);
    const ink = cssColor("--color-ink", [237, 237, 237]);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let hgt = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = r.width;
      hgt = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let rot = 0;
    let last = performance.now();
    let level = 0;
    let glow = 0.3;
    const RAYS = 96;
    const rays = new Float32Array(RAYS);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const st = stateRef.current;
      const f = st === "listening" || st === "speaking" ? frameRef.current() : { level: 0, bins: null };

      level += (f.level - level) * 0.22;
      const targetGlow = st === "idle" ? 0.3 : st === "thinking" ? 0.55 + 0.15 * Math.sin(t * 4) : 0.5 + level * 0.5;
      glow += (targetGlow - glow) * 0.08;
      rot += dt * SPEED[st] * (reduced ? 0.25 : 1);

      const cx = w / 2;
      const cy = hgt / 2;
      const R = Math.min(w, hgt) / 2 - 4;
      if (R <= 10) return;
      g.clearRect(0, 0, w, hgt);
      g.lineCap = "round";

      // 1) Weicher Hintergrund-Schein
      const halo = g.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
      halo.addColorStop(0, rgba(accent, 0.22 * glow));
      halo.addColorStop(0.55, rgba(accent, 0.07 * glow));
      halo.addColorStop(1, rgba(accent, 0));
      g.fillStyle = halo;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fill();

      // 2) Messring mit feiner Skala
      g.strokeStyle = rgba(ink, 0.08);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, R * 0.98, 0, Math.PI * 2);
      g.stroke();
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 - rot * 0.15;
        const long = i % 5 === 0;
        const r1 = R * (long ? 0.93 : 0.95);
        g.strokeStyle = rgba(ink, long ? 0.22 : 0.1);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.lineTo(cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98);
        g.stroke();
      }

      // 3) Pegel-Strahlen (Spektrum rund um den Kern)
      const sweep = (t * 2.4) % (Math.PI * 2);
      for (let i = 0; i < RAYS; i++) {
        let target = 0.04;
        if (f.bins) {
          // spiegelsymmetrisch: tiefe Frequenzen oben und unten
          const k = i < RAYS / 2 ? i : RAYS - 1 - i;
          const bin = f.bins[2 + Math.floor((k / (RAYS / 2)) * 40)] ?? 0;
          target = 0.04 + (bin / 255) * 0.9;
        } else if (st === "listening" || st === "speaking") {
          target = 0.05 + level * (0.35 + 0.35 * Math.abs(Math.sin(i * 0.7 + t * 6)));
        } else if (st === "thinking") {
          const a = (i / RAYS) * Math.PI * 2;
          const d = Math.abs(((a - sweep + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          target = 0.05 + Math.max(0, 1 - d / 0.9) * 0.55;
        } else {
          target = 0.04 + 0.03 * Math.sin(i * 0.5 + t * 1.2);
        }
        rays[i] += (target - rays[i]) * 0.25;
        const a = (i / RAYS) * Math.PI * 2 - Math.PI / 2;
        const r0 = R * 0.62;
        const len = R * 0.27 * rays[i];
        g.strokeStyle = rgba(accent, 0.25 + rays[i] * 0.75);
        g.lineWidth = Math.max(1.2, R * 0.012);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
        g.stroke();
      }

      // 4) Gegenläufige Segmentbögen
      const arcs = (radius: number, count: number, span: number, dir: number, width: number, alpha: number) => {
        g.lineWidth = width;
        g.strokeStyle = rgba(accent, alpha);
        for (let i = 0; i < count; i++) {
          const a0 = rot * dir + (i / count) * Math.PI * 2;
          g.beginPath();
          g.arc(cx, cy, radius, a0, a0 + span);
          g.stroke();
        }
      };
      arcs(R * 0.57, 3, 0.9, 1, Math.max(2, R * 0.022), 0.55 + glow * 0.4);
      arcs(R * 0.52, 12, 0.22, -1.6, Math.max(1, R * 0.008), 0.35);

      // 5) Denken: umlaufende Lichtpunkte
      if (st === "thinking") {
        for (let i = 0; i < 3; i++) {
          const a = t * (2.6 - i * 0.5) + i * 2.1;
          const r = R * (0.44 + i * 0.03);
          g.fillStyle = rgba(accent, 0.9 - i * 0.2);
          g.beginPath();
          g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(2, R * 0.018), 0, Math.PI * 2);
          g.fill();
        }
      }

      // 6) Kern: Kontur folgt der Stimme
      const core = R * (0.34 + level * 0.05);
      const pts = 72;
      g.beginPath();
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const wobble =
          st === "idle"
            ? 0.012 * Math.sin(a * 3 + t * 0.8)
            : level * 0.09 * Math.sin(a * 5 + t * 5) + level * 0.05 * Math.sin(a * 9 - t * 7) + (st === "thinking" ? 0.02 * Math.sin(a * 4 + t * 3) : 0);
        const r = core * (1 + wobble);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      const fill = g.createRadialGradient(cx, cy, 0, cx, cy, core * 1.1);
      fill.addColorStop(0, rgba(accent, 0.55 * glow + 0.1));
      fill.addColorStop(0.7, rgba(accent, 0.12 * glow));
      fill.addColorStop(1, rgba(accent, 0.04));
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = Math.max(1.5, R * 0.014);
      g.strokeStyle = rgba(accent, 0.6 + glow * 0.4);
      g.stroke();

      // 7) Heller Mittelpunkt
      const dot = g.createRadialGradient(cx, cy, 0, cx, cy, core * 0.45);
      dot.addColorStop(0, rgba(ink, 0.55 * glow + 0.15));
      dot.addColorStop(1, rgba(accent, 0));
      g.fillStyle = dot;
      g.beginPath();
      g.arc(cx, cy, core * 0.45, 0, Math.PI * 2);
      g.fill();
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={`block w-full h-full ${className}`} aria-hidden />;
}
