"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";

const NAV: { href: string; label: string; icon: string }[] = [
  { href: "/", label: "Heute", icon: "sunny" },
  { href: "/aufgaben", label: "Aufgaben", icon: "task_alt" },
  { href: "/gewohnheiten", label: "Gewohnheiten", icon: "autorenew" },
  { href: "/kalender", label: "Kalender", icon: "calendar_month" },
  { href: "/mail", label: "Mail-Digest", icon: "mail" },
  { href: "/post", label: "Briefpost", icon: "markunread_mailbox" },
  { href: "/wissen", label: "Wissen", icon: "school" },
  { href: "/vertraege", label: "Verträge", icon: "contract" },
  { href: "/clipboard", label: "Clipboard", icon: "content_paste" },
  { href: "/watcher", label: "Portale", icon: "travel_explore" },
  { href: "/slack", label: "Slack", icon: "forum" },
  { href: "/assistent", label: "Arion Bot", icon: "auto_awesome" },
  { href: "/einstellungen", label: "Einstellungen", icon: "settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-[220px] shrink-0 h-screen sticky top-0 hidden lg:flex flex-col border-r border-line bg-[rgba(255,255,255,0.03)] backdrop-blur-xl">
      <div className="px-5 pt-6 pb-4 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Arion OS" className="w-9 h-9 rounded-[10px]" />
        <div>
          <div className="text-[17px] font-bold tracking-tight">Arion&nbsp;OS</div>
          <div className="text-[11px] text-ink-3 mt-0.5">Dein Betriebssystem</div>
        </div>
      </div>
      <nav className="flex-1 px-2.5 space-y-0.5 overflow-y-auto pb-4">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-2.5 h-9 rounded-[10px] text-[13px] font-medium transition-all ${
                active ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-inset hover:text-ink"
              }`}
            >
              <Icon name={item.icon} size={19} className="w-5 text-center" />
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
