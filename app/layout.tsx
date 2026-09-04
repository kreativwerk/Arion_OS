import type { Metadata, Viewport } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";
import PwaSetup from "@/components/PwaSetup";

export const metadata: Metadata = {
  title: "Arion OS",
  description: "Dein persönliches Betriebssystem für Alltag, Firma und Partner",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Arion OS",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <PwaSetup />
        {/* App-Shell: Die Seite selbst scrollt nie – nur <main>. Dadurch kann
            iOS die fixierten Elemente (Bottom-Bar, FAB) nicht verschieben. */}
        <div className="flex h-dvh overflow-hidden">
          <Sidebar />
          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain">
            <div className="max-w-[1080px] mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-8 pb-36 lg:pb-8">
              {children}
            </div>
          </main>
        </div>
        <MobileNav />
      </body>
    </html>
  );
}
