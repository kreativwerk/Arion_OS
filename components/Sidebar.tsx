"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";

/**
 * Navigation nach Häufigkeit (docs/VORGAENGE.md): oben das Tägliche, darunter
 * Firmen & Ablage, unten Werkzeuge. Clipboard, ARION und Einstellungen stehen
 * in der Kopfleiste (TopBar) – hier nicht doppelt.
 */
export const NAV_GRUPPEN: { titel: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    titel: "",
    items: [
      { href: "/", label: "Heute", icon: "sunny" },
      { href: "/eingang", label: "Eingang", icon: "move_to_inbox" },
      { href: "/aufgaben", label: "Vorgänge", icon: "task_alt" },
      { href: "/postfach", label: "Postfach", icon: "inbox" },
      { href: "/post", label: "Briefpost", icon: "markunread_mailbox" },
      { href: "/kalender", label: "Kalender", icon: "calendar_month" },
    ],
  },
  {
    titel: "Firmen & Ablage",
    items: [
      { href: "/firmen", label: "Firmen", icon: "domain" },
      { href: "/buchhaltung", label: "Buchhaltung", icon: "account_balance" },
      { href: "/bescheinigungen", label: "Bescheinigungen", icon: "assignment_ind" },
      { href: "/vertraege", label: "Verträge", icon: "contract" },
      { href: "/wissen", label: "Wissen", icon: "school" },
    ],
  },
  {
    titel: "Werkzeuge",
    items: [
      { href: "/assistent", label: "Arion Bot", icon: "auto_awesome" },
      { href: "/mail", label: "Mail-Digest", icon: "mail" },
      { href: "/watcher", label: "Portale", icon: "travel_explore" },
      { href: "/slack", label: "Slack", icon: "forum" },
      { href: "/gewohnheiten", label: "Gewohnheiten", icon: "autorenew" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-[220px] shrink-0 h-full hidden lg:flex flex-col border-r border-line bg-[rgba(255,255,255,0.03)] backdrop-blur-xl">
      <div className="px-5 pt-6 pb-4 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Arion OS" className="w-9 h-9 rounded-[10px]" />
        <div>
          <div className="text-[17px] font-bold tracking-tight">Arion&nbsp;OS</div>
          <div className="text-[11px] text-ink-3 mt-0.5">Dein Betriebssystem</div>
        </div>
      </div>
      <nav className="flex-1 px-2.5 overflow-y-auto pb-4">
        {NAV_GRUPPEN.map((g) => (
          <div key={g.titel || "start"} className={g.titel ? "mt-5" : ""}>
            {g.titel && (
              <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">{g.titel}</div>
            )}
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
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
            </div>
          </div>
        ))}
      </nav>
      <div className="px-5 py-4 border-t border-line text-[11px] text-ink-3">
        info@arion-logistics.de
      </div>
    </aside>
  );
}
