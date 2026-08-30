"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, Button, Icon } from "@/components/ui";

function base64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type Status = { configured: boolean; publicKey: string | null; subscriptions: number };

export default function PushSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    const res = await fetch("/api/push", { cache: "no-store" });
    if (res.ok) setStatus(await res.json());
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
    }
  };
  useEffect(() => {
    load();
  }, []);

  const enable = async () => {
    setMessage("");
    try {
      if (!status?.publicKey) throw new Error("VAPID-Schlüssel fehlen (siehe docs/DEPLOY.md).");
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Dieser Browser unterstützt keine Web-Push-Benachrichtigungen.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Benachrichtigungen wurden nicht erlaubt.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(status.publicKey) as BufferSource,
      });
      await fetch("/api/push", {
        method: "POST",
        body: JSON.stringify({ ...sub.toJSON(), userAgent: navigator.userAgent }),
      });
      setMessage("Benachrichtigungen sind aktiv auf diesem Gerät.");
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setMessage("Benachrichtigungen für dieses Gerät deaktiviert.");
    load();
  };

  const test = async () => {
    const res = await fetch("/api/push/test", { method: "POST" });
    const data = await res.json();
    setMessage(res.ok ? `Test gesendet an ${data.sent} Gerät(e).` : data.error);
  };

  return (
    <Card>
      <CardHeader
        title="Benachrichtigungen"
        subtitle="Push auf die installierte App (Homescreen) – z.B. bei neuen Aufgaben aus Codriver"
      />
      <div className="px-5 pb-5 pt-1 space-y-3">
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <Icon name={status?.configured ? "notifications_active" : "notifications_off"} className={status?.configured ? "text-good" : "text-ink-3"} />
          {status === null
            ? "Prüfe Status …"
            : status.configured
              ? `Push ist serverseitig konfiguriert · ${status.subscriptions} Gerät(e) registriert`
              : "Push ist serverseitig noch nicht konfiguriert (VAPID-Schlüssel setzen, siehe docs/DEPLOY.md)."}
        </div>
        <div className="flex gap-2 flex-wrap">
          {!subscribed ? (
            <Button onClick={enable} disabled={!status?.configured}>
              Auf diesem Gerät aktivieren
            </Button>
          ) : (
            <Button variant="ghost" onClick={disable}>
              Auf diesem Gerät deaktivieren
            </Button>
          )}
          <Button variant="ghost" onClick={test} disabled={!status?.configured}>
            Test senden
          </Button>
        </div>
        {message && <p className="text-[12px] text-ink-2">{message}</p>}
        <p className="text-[11px] text-ink-3">
          iPhone/iPad: App zuerst über Safari mit „Zum Home-Bildschirm" installieren und aus der
          installierten App heraus aktivieren (ab iOS 16.4). Android/Desktop: direkt im Browser möglich.
        </p>
      </div>
    </Card>
  );
}
