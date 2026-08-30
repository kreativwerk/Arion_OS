"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";

const ITEMS = [
  { href: "/", label: "Heute", icon: "sunny" },
  { href: "/aufgaben", label: "Aufgaben", icon: "task_alt" },
  { href: "/assistent", label: "Jarvis", icon: "auto_awesome" },
  { href: "/wissen", label: "Wissen", icon: "school" },
  { href: "/mehr", label: "Mehr", icon: "apps" },
];

/** Untere Tab-Leiste für Mobilgeräte (PWA). */
export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 border-t border-line bg-[rgba(12,13,14,0.85)] backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-stretch justify-around h-[58px]">
        {ITEMS.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 transition-colors ${
                active ? "text-accent" : "text-ink-3"
              }`}
            >
              <Icon name={item.icon} size={22} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
