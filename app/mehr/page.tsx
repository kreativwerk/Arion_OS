"use client";

import Link from "next/link";
import { PageHeader, Icon } from "@/components/ui";

const MODULES = [
  { href: "/gewohnheiten", label: "Gewohnheiten", icon: "autorenew", desc: "Habit-Tracker & Serien" },
  { href: "/kalender", label: "Kalender", icon: "calendar_month", desc: "Termine & Einträge" },
  { href: "/mail", label: "Mail-Digest", icon: "mail", desc: "Wichtige Mails, gefiltert" },
  { href: "/post", label: "Briefpost", icon: "markunread_mailbox", desc: "Digital zugestellte Scans" },
  { href: "/vertraege", label: "Verträge", icon: "contract", desc: "Fristen & Kosten" },
  { href: "/clipboard", label: "Clipboard", icon: "content_paste", desc: "Textbausteine & Nummern" },
  { href: "/watcher", label: "Portale", icon: "travel_explore", desc: "Watcher & Meldungen" },
  { href: "/slack", label: "Slack", icon: "forum", desc: "Wichtige Personen" },
  { href: "/einstellungen", label: "Einstellungen", icon: "settings", desc: "Profil, Push, API-Zugänge" },
];

export default function MorePage() {
  return (
    <div>
      <PageHeader title="Alle Module" subtitle="Der Rest von Arion OS" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {MODULES.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="bg-card border border-line rounded-card p-4 hover:border-accent/40 transition-all"
          >
            <div className="w-10 h-10 rounded-[12px] bg-accent-soft text-accent flex items-center justify-center mb-3">
              <Icon name={m.icon} size={22} />
            </div>
            <div className="text-[14px] font-semibold">{m.label}</div>
            <div className="text-[11px] text-ink-3 mt-0.5">{m.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
