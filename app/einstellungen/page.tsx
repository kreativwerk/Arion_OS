"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, PageHeader, Button, Input, TextArea, Row, EmptyState, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/client";
import PushSettings from "@/components/PushSettings";

type Token = { id: number; label: string; created_at: string; last_used: string | null };

export default function SettingsPage() {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tokenLabel, setTokenLabel] = useState("Codriver");
  const [newToken, setNewToken] = useState<string | null>(null);

  const load = async () => {
    const [c, t] = await Promise.all([
      fetch("/api/config", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/tokens", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setCfg(c);
    setTokens(t);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    await fetch("/api/config", { method: "POST", body: JSON.stringify(cfg) });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const createToken = async () => {
    if (!tokenLabel.trim()) return;
    const res = await fetch("/api/tokens", { method: "POST", body: JSON.stringify({ label: tokenLabel.trim() }) });
    const data = await res.json();
    setNewToken(data.token);
    load();
  };

  const deleteToken = async (id: number) => {
    await fetch(`/api/tokens?id=${id}`, { method: "DELETE" });
    load();
  };

  const field = (key: string) => ({
    value: cfg[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setCfg({ ...cfg, [key]: e.target.value }),
  });

  return (
    <div>
      <PageHeader
        title="Einstellungen"
        subtitle="Dein Profil, White-Label-Konfiguration und Zugänge für externe Apps"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Card>
          <CardHeader
            title="Profil & Personalisierung"
            subtitle="Arion Bot nutzt diese Angaben als festes Wissen über dich"
          />
          <div className="p-5 pt-2 space-y-3">
            <div>
              <label className="text-[12px] text-ink-2 block mb-1">Dein Name (für Begrüßung & Arion Bot)</label>
              <Input placeholder="z.B. Alexander" {...field("user_name")} />
            </div>
            <div>
              <label className="text-[12px] text-ink-2 block mb-1">Firma</label>
              <Input {...field("company")} />
            </div>
            <div>
              <label className="text-[12px] text-ink-2 block mb-1">Wichtige Partner (kommagetrennt)</label>
              <Input {...field("partners")} />
            </div>
            <div>
              <label className="text-[12px] text-ink-2 block mb-1">Über mich – alles, was Arion Bot wissen soll</label>
              <TextArea rows={6} {...field("about_me")} />
              <p className="text-[11px] text-ink-3 mt-1">
                Rolle, Arbeitsweise, Vorlieben, Zuständigkeiten … Dieses Feld wird Arion Bot bei jeder
                Frage mitgegeben.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] text-ink-2 block mb-1">App-Name (White-Label)</label>
                <Input {...field("app_name")} />
              </div>
              <div>
                <label className="text-[12px] text-ink-2 block mb-1">Mitarbeiter-App</label>
                <Input {...field("employee_app")} />
              </div>
            </div>
            <Button onClick={save}>{saved ? "✓ Gespeichert" : "Speichern"}</Button>
          </div>
        </Card>

        <div className="space-y-5">
          <PushSettings />
          <Card>
            <CardHeader
              title="API-Zugänge"
              subtitle="Tokens für externe Apps wie Codriver – damit Mitarbeiter dir Aufgaben eintragen können"
            />
            {tokens.length === 0 && <EmptyState text="Noch keine Zugänge angelegt." />}
            {tokens.map((t) => (
              <Row key={t.id} className="group">
                <div className="flex-1">
                  <div className="text-[13px] font-medium">{t.label}</div>
                  <div className="text-[11px] text-ink-3">
                    angelegt {fmtDate(t.created_at)}
                    {t.last_used ? ` · zuletzt genutzt ${fmtDate(t.last_used)}` : " · noch nie genutzt"}
                  </div>
                </div>
                <button
                  onClick={() => deleteToken(t.id)}
                  className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-bad text-[12px]"
                >
                  Widerrufen
                </button>
              </Row>
            ))}
            <div className="p-4 border-t border-line space-y-2">
              <div className="flex gap-2">
                <Input placeholder="Bezeichnung (z.B. Codriver)" value={tokenLabel} onChange={(e) => setTokenLabel(e.target.value)} />
                <Button onClick={createToken}>Token erstellen</Button>
              </div>
              {newToken && (
                <div className="bg-accent-soft rounded-[10px] p-3">
                  <p className="text-[12px] text-accent font-medium mb-1.5">
                    Token erstellt – jetzt kopieren, er wird nur einmal angezeigt:
                  </p>
                  <button
                    onClick={() => navigator.clipboard.writeText(newToken)}
                    className="w-full text-left bg-card rounded-[8px] px-3 py-2 text-[12px] font-mono break-all"
                    title="Klicken zum Kopieren"
                  >
                    {newToken}
                  </button>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Anbindung Codriver" subtitle="So tragen Mitarbeiter dir Aufgaben ein" />
            <div className="px-5 pb-5 pt-1 space-y-2">
              <p className="text-[13px] text-ink-2">
                Codriver ruft mit dem Token diesen Endpunkt auf – die Aufgabe landet in deinem{" "}
                <Badge tone="accent">Eingang</Badge> im Aufgaben-Modul und wartet auf deine Annahme:
              </p>
              <pre className="bg-inset rounded-[10px] p-3 text-[11px] font-mono overflow-x-auto">
{`POST /api/external/tasks
Authorization: Bearer arion_…

{
  "title": "Palettenstellplätze prüfen",
  "submitted_by": "Markus Weber",
  "due_date": "2026-09-05",
  "priority": 2,
  "notes": "Lager Nord, Reihe 4"
}`}
              </pre>
              <p className="text-[11px] text-ink-3">
                Vollständige Doku für eure Entwickler: <code>docs/CODRIVER.md</code>
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Sitzung" subtitle="Login-Schutz über APP_PASSWORD (siehe docs/DEPLOY.md)" />
            <div className="px-5 pb-5 pt-1">
              <Button
                variant="danger"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.href = "/login";
                }}
              >
                Abmelden
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
