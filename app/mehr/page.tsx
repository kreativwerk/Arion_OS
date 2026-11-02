"use client";

import Link from "next/link";
import { PageHeader, Icon } from "@/components/ui";
import { NAV_GRUPPEN } from "@/components/Sidebar";

// Gleiche Gruppen wie die Seitenleiste; Heute, Vorgänge und Postfach sind unten in der Tab-Leiste.
const GRUPPEN = NAV_GRUPPEN.map((g) => ({
  titel: g.titel || "Alltag",
  items: g.items.filter((i) => !["/", "/aufgaben", "/postfach", "/assistent"].includes(i.href)),
})).filter((g) => g.items.length);

export default function MorePage() {
  return (
    <div>
      <PageHeader title="Mehr" subtitle="Alles, was nicht unten in der Leiste steht" />
      {GRUPPEN.map((g) => (
        <section key={g.titel} className="mb-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3 mb-2 px-1">{g.titel}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {g.items.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                className="bg-card border border-line rounded-card p-4 hover:border-accent/40 transition-all flex flex-col items-start gap-2.5 min-w-0"
              >
                <div className="w-10 h-10 rounded-[12px] bg-accent-soft text-accent flex items-center justify-center shrink-0">
                  <Icon name={m.icon} size={22} />
                </div>
                <div className="text-[14px] font-semibold min-w-0 max-w-full break-words hyphens-auto" lang="de">{m.label}</div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
