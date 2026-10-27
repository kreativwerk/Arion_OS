"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";

/**
 * Feste Kopfleiste über jeder Seite: Clipboard und Neu laden.
 * In der installierten App (PWA) gibt es keinen Browser-Reload – dafür der Knopf.
 */
export default function TopBar() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const clipActive = pathname.startsWith("/clipboard");

  const reload = () => {
    setLoading(true);
    window.location.reload();
  };

  const btn = "w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-inset";

  return (
    <div className="sticky top-0 z-30 bg-ground/70 backdrop-blur-xl border-b border-line pt-[env(safe-area-inset-top)]">
      <div className="max-w-[1080px] mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-end gap-1">
        <Link
          href="/clipboard"
          aria-label="Clipboard"
          title="Clipboard"
          className={`${btn} ${clipActive ? "text-accent" : "text-ink-2 hover:text-ink"}`}
        >
          <Icon name="content_paste" size={22} />
        </Link>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          aria-label="Neu laden"
          title="Neu laden"
          className={`${btn} text-ink-2 hover:text-ink disabled:opacity-60`}
        >
          <Icon name="refresh" size={22} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
    </div>
  );
}
