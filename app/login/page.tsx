"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const next = params.get("next");
        // Harte Navigation: Middleware und Server-Daten laufen garantiert frisch.
        window.location.assign(next && next.startsWith("/") ? next : "/");
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error ?? `Fehler ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full max-w-[340px] flex flex-col items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="Arion OS" className="w-20 h-20 rounded-[24px] mb-5" />
      <h1 className="text-[24px] font-bold tracking-tight mb-1">Arion OS</h1>
      <p className="text-[13px] text-ink-3 mb-8">Privater Bereich – bitte anmelden</p>

      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Passwort"
        autoComplete="current-password"
        className="w-full h-12 px-4 rounded-[14px] bg-card border border-line text-[16px] text-center outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
      />
      {error && <p className="text-[13px] text-bad mt-3">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password}
        className="w-full h-12 mt-4 rounded-[14px] bg-accent text-on-accent text-[15px] font-semibold disabled:opacity-40 transition-all"
      >
        {busy ? "Prüfe …" : "Anmelden"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="fixed inset-0 z-[100] bg-ground flex items-center justify-center px-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
