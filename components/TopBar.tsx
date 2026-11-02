"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";

/**
 * Die eine Kopfleiste über jeder Seite – auf Desktop und Handy gleich.
 * Links (nur mobil, wo die Seitenleiste fehlt): Logo zur Startseite.
 * Rechts, immer in dieser Reihenfolge: ARION (Sprache), Clipboard, Neu laden,
 * Einstellungen (dort auch Abmelden). Seiten bauen keine eigenen Kopf-Icons
 * mehr – so gibt es nichts doppelt.
 * In der installierten App (PWA) gibt es keinen Browser-Reload – dafür der Knopf.
 */
export default function TopBar() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);

  const reload = () => {
    setLoading(true);
    window.location.reload();
  };

  const btn = "w-10 h-10 rounded-full flex items-center justify-center transition-colors";
  const ruhig = (aktiv: boolean) => (aktiv ? "text-accent bg-accent-soft" : "text-ink-2 hover:text-ink hover:bg-inset");

  return (
    <div className="sticky top-0 z-30 bg-ground/70 backdrop-blur-xl border-b border-line pt-[env(safe-area-inset-top)]">
      <div className="max-w-[1080px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-1">
        <Link href="/" aria-label="Arion OS – Heute" className="lg:hidden flex items-center gap-2 mr-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="w-8 h-8 rounded-[9px]" />
          <span className="text-[15px] font-bold tracking-tight">Arion OS</span>
        </Link>
        <div className="hidden lg:block mr-auto" />

        <Link
          href="/arion"
          aria-label="ARION – Sprachassistent"
          title="ARION – Sprachassistent"
          className={`${btn} ${pathname.startsWith("/arion") ? "bg-accent text-on-accent" : "bg-accent-soft text-accent hover:bg-accent hover:text-on-accent"}`}
        >
          <Icon name="graphic_eq" size={22} />
        </Link>
        <Link href="/clipboard" aria-label="Clipboard" title="Clipboard" className={`${btn} ${ruhig(pathname.startsWith("/clipboard"))}`}>
          <Icon name="content_paste" size={22} />
        </Link>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          aria-label="Neu laden"
          title="Neu laden"
          className={`${btn} ${ruhig(false)} disabled:opacity-60`}
        >
          <Icon name="refresh" size={22} className={loading ? "animate-spin" : ""} />
        </button>
        <Link
          href="/einstellungen"
          aria-label="Einstellungen und Abmelden"
          title="Einstellungen"
          className={`${btn} ${ruhig(pathname.startsWith("/einstellungen"))}`}
        >
          <Icon name="account_circle" size={24} />
        </Link>
      </div>
    </div>
  );
}
