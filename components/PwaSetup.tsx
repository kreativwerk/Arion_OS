"use client";

import { useEffect } from "react";

/** Registriert den Service Worker für Push & PWA-Installation. */
export default function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
