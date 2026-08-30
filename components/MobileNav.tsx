"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";

const LEFT = [
  { href: "/", label: "Heute", icon: "sunny" },
  { href: "/aufgaben", label: "Aufgaben", icon: "task_alt" },
];
const RIGHT = [
  { href: "/wissen", label: "Wissen", icon: "school" },
  { href: "/mehr", label: "Mehr", icon: "apps" },
];

/** Schwebende, voll abgerundete Tab-Leiste (PWA). In der Mitte ragt das
 *  Arion-Logo als runder Button heraus – der Zugang zum Arion Bot. */
export default function MobileNav() {
  const pathname = usePathname();

  const item = (href: string, label: string, icon: string) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
          active ? "text-accent" : "text-ink-3"
        }`}
      >
        <Icon name={icon} size={22} />
        <span className="text-[10px] font-medium">{label}</span>
      </Link>
    );
  };

  const botActive = pathname.startsWith("/assistent");

  return (
    <nav className="lg:hidden fixed z-50 inset-x-4 bottom-[max(16px,env(safe-area-inset-bottom))] max-w-[420px] mx-auto">
      <div className="relative h-[62px] rounded-full border border-line bg-[rgba(18,20,21,0.9)] backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.55)] flex items-stretch px-2">
        {LEFT.map((i) => item(i.href, i.label, i.icon))}

        {/* Platzhalter für den mittigen Bot-Button */}
        <div className="w-[68px] shrink-0" />

        {RIGHT.map((i) => item(i.href, i.label, i.icon))}

        {/* Arion Bot: rundes Logo, ragt über die Leiste hinaus */}
        <Link
          href="/assistent"
          aria-label="Arion Bot"
          className={`absolute left-1/2 -translate-x-1/2 -top-6 w-[64px] h-[64px] rounded-full overflow-hidden border-2 transition-all shadow-[0_6px_24px_rgba(62,207,142,0.35)] ${
            botActive ? "border-accent scale-105" : "border-line hover:border-accent/60"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Arion Bot" className="w-full h-full scale-110" />
        </Link>
      </div>
    </nav>
  );
}
