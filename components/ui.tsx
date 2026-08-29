"use client";

import { ReactNode } from "react";

/* Minimales UI-Kit im Apple-Stil: Karten, Buttons, Inputs, Badges, Segmented Control. */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-card shadow-card border border-line ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between px-5 pt-4 pb-2">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-[12px] text-ink-2 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-[14px] text-ink-2 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: "bg-accent text-white hover:opacity-90",
    ghost: "bg-transparent text-accent hover:bg-accent-soft",
    danger: "bg-transparent text-bad hover:bg-bad/10",
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`px-3.5 h-8 rounded-full text-[13px] font-medium transition-all disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 px-3 rounded-[10px] bg-ground border border-line text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all w-full ${props.className ?? ""}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`px-3 py-2 rounded-[10px] bg-ground border border-line text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all w-full ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-9 px-2.5 rounded-[10px] bg-ground border border-line text-[13px] outline-none focus:border-accent transition-all ${props.className ?? ""}`}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "good" | "warn" | "bad";
}) {
  const styles = {
    neutral: "bg-ground text-ink-2",
    accent: "bg-accent-soft text-accent",
    good: "bg-good/15 text-good",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/15 text-bad",
  }[tone];
  return (
    <span className={`inline-flex items-center px-2 h-[22px] rounded-full text-[11px] font-medium whitespace-nowrap ${styles}`}>
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex bg-ground border border-line rounded-full p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3.5 h-7 rounded-full text-[13px] font-medium transition-all ${
            value === o.value ? "bg-card shadow-card text-ink" : "text-ink-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="text-[13px] text-ink-3 px-5 py-6 text-center">{text}</p>;
}

export function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-3 px-5 py-3 border-t border-line first:border-t-0 ${className}`}>
      {children}
    </div>
  );
}
