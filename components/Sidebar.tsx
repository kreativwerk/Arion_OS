"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: { href: string; label: string; icon: string }[] = [
  { href: "/", label: "Heute", icon: "☀️" },
  { href: "/aufgaben", label: "Aufgaben", icon: "☑️" },
  { href: "/gewohnheiten", label: "Gewohnheiten", icon: "🔁" },
  { href: "/kalender", label: "Kalender", icon: "📅" },
  { href: "/mail", label: "Mail-Digest", icon: "✉️" },
  { href: "/post", label: "Briefpost", icon: "📬" },
  { href: "/wissen", label: "Wissen", icon: "🧠" },
  { href: "/vertraege", label: "Verträge", icon: "📄" },
  { href: "/clipboard", label: "Clipboard", icon: "📋" },
  { href: "/watcher", label: "Portale", icon: "🔭" },
  { href: "/slack", label: "Slack", icon: "💬" },
  { href: "/assistent", label: "Jarvis", icon: "✨" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-[220px] shrink-0 h-screen sticky top-0 flex flex-col border-r border-line bg-card/60 backdrop-blur-xl">
      <div className="px-5 pt-6 pb-4">
        <div className="text-[17px] font-bold tracking-tight">Arion&nbsp;OS</div>
        <div className="text-[11px] text-ink-3 mt-0.5">Dein persönliches Betriebssystem</div>
      </div>
      <nav className="flex-1 px-2.5 space-y-0.5 overflow-y-auto pb-4">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-2.5 h-9 rounded-[10px] text-[13px] font-medium transition-all ${
                active ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-ground hover:text-ink"
              }`}
            >
              <span className="text-[15px] w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-line text-[11px] text-ink-3">
        info@arion-logistics.de
      </div>
    </aside>
  );
}
