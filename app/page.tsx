"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, Badge, EmptyState, Row, Icon, CheckCircle, MaybeIcon } from "@/components/ui";
import { fmtDate, todayIso } from "@/lib/client";
import TaskQuickSheet from "@/components/TaskQuickSheet";
import NutritionTracker from "@/components/NutritionTracker";
import {
  FlotteWidget,
  FristenWidget,
  KontoWidget,
  StationWidget,
  WartetWidget,
  WohnwerkWidget,
  type Flotte,
  type Frist,
  type Konto,
  type Station,
  type WartetItem,
  type Wohnwerk,
} from "@/components/HomeWidgets";
import { WIDGETS, moveItem, normalizeLayout, type LayoutItem, type WidgetId } from "@/lib/home-widgets";

type Dash = {
  config: Record<string, string>;
  inboxCount: number;
  counts: { slack: number; mail: number; letters: number; watcher: number };
  tasksToday: { id: number; title: string; priority: number; recurrence: string | null; project: string; source: string; submitted_by: string }[];
  habits: { id: number; name: string; emoji: string }[];
  habitLogsToday: { habit_id: number }[];
  events: { id: number; title: string; date: string; start_time: string; end_time: string; location: string }[];
  contractsDue: { id: number; name: string; provider: string; days_to_cancel: number }[];
  buchhaltung?: {
    monat: string;
    fehlt_anzahl: number;
    fehlt_summe: number;
    belegt_prozent: number | null;
    eingang_neu: number;
    naechste_frist: { titel: string; faellig: string; betrag: number | null } | null;
  };
  layout?: LayoutItem[];
  wartet?: WartetItem[];
  fristen?: Frist[];
  konto?: Konto;
  wohnwerk?: Wohnwerk;
  station?: Station;
  flotte?: Flotte;
};

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

const TILES = [
  { key: "slack", label: "Slack", icon: "notifications", href: "/slack" },
  { key: "mail", label: "Mail", icon: "mail", href: "/mail" },
  { key: "letters", label: "Post", icon: "markunread_mailbox", href: "/post" },
  { key: "watcher", label: "Portale", icon: "travel_explore", href: "/watcher" },
] as const;

/** ISO-Kalenderwoche (KW) */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export default function TodayPage() {
  const [data, setData] = useState<Dash | null>(null);
  const [apiError, setApiError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [layoutLocal, setLayoutLocal] = useState<LayoutItem[] | null>(null);

  const reload = async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (res.ok) {
        setData(await res.json());
        setApiError("");
      } else {
        const body = await res.json().catch(() => null);
        setApiError(body?.error ?? `Server-Fehler ${res.status}`);
      }
    } catch (e) {
      setApiError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    reload();
  }, []);

  const completeTask = async (id: number) => {
    await fetch("/api/tasks/complete", { method: "POST", body: JSON.stringify({ id }) });
    reload();
  };
  const toggleHabit = async (habit_id: number) => {
    await fetch("/api/habits/toggle", { method: "POST", body: JSON.stringify({ habit_id, date: todayIso() }) });
    reload();
  };

  const now = new Date();
  const evening = now.getHours() >= 17;
  const greeting = now.getHours() < 11 ? "Guten Morgen" : !evening ? "Guten Tag" : "Guten Abend";
  const dateStr = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

  if (apiError) {
    return (
      <div className="bg-bad/10 border border-bad/30 rounded-card p-5 mt-4">
        <div className="flex items-center gap-2 text-bad font-semibold text-[14px]">
          <Icon name="error" size={20} />
          Verbindung zur Datenbank fehlgeschlagen
        </div>
        <p className="text-[13px] text-ink-2 mt-2 break-words">{apiError}</p>
        <p className="text-[12px] text-ink-3 mt-3">
          Meist fehlt oder stimmt die <code>DATABASE_URL</code> in den Vercel-Umgebungsvariablen nicht
          (Supabase → Connect → Session pooler, Passwort einsetzen). Nach dem Ändern: Redeploy.
          Details: <code>docs/DEPLOY.md</code>
        </p>
        <button onClick={reload} className="mt-3 text-[13px] text-accent font-medium">
          Erneut versuchen
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-ink-3 text-[13px]">Lade …</p>;

  // Number(): bigint-IDs kamen aus Postgres früher als String an
  const doneHabits = new Set(data.habitLogsToday.map((l) => Number(l.habit_id)));
  // Geteilte Taskleiste: tägliche Routine-Checks rechts, alles andere links
  const dailyTasks = data.tasksToday.filter((t) => t.recurrence === "daily");
  const otherTasks = data.tasksToday.filter((t) => t.recurrence !== "daily");

  const layout = layoutLocal ?? normalizeLayout(data.layout ?? null);
  const saveLayout = (next: LayoutItem[]) => {
    setLayoutLocal(next);
    fetch("/api/home-layout", { method: "POST", body: JSON.stringify({ layout: next }) }).catch(() => {});
  };

  const renderWidget = (id: WidgetId) => {
    switch (id) {
      case "posteingaenge":
        return (
      <div className="grid grid-cols-4 gap-2">
          {TILES.map((t) => {
            const n = data.counts[t.key];
            const active = n > 0;
            return (
              <Link
                key={t.key}
                href={t.href}
                className={`bg-card border border-line rounded-[14px] py-2.5 px-1 flex flex-col items-center gap-1 transition-all hover:border-accent/40 ${
                  active ? "" : "opacity-60"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Icon name={t.icon} size={17} className={active ? "text-accent" : "text-ink-3"} />
                  <span className={`text-[17px] font-bold leading-none ${active ? "" : "text-ink-3"}`}>{n}</span>
                </div>
                <span className="text-[11px] text-ink-3 truncate max-w-full">{t.label}</span>
              </Link>
            );
          })}
        </div>
  
          );
      case "ernaehrung":
        return <NutritionTracker />;
      case "aufgaben":
        return (
        <Card className="flex flex-col">
          <CardHeader
            title={evening ? "Noch offen heute" : "Heute fällig"}
            subtitle={`${data.tasksToday.length} ${data.tasksToday.length === 1 ? "Aufgabe" : "Aufgaben"}`}
            action={
              <div className="flex items-center gap-1">
                <Link href="/aufgaben" className="text-[12px] text-accent px-2">
                  Alle →
                </Link>
                <button
                  onClick={() => setSheetOpen(true)}
                  className="w-8 h-8 rounded-full bg-accent text-on-accent flex items-center justify-center hover:opacity-90 transition-all"
                  aria-label="Aufgabe hinzufügen"
                >
                  <Icon name="add" size={20} />
                </button>
              </div>
            }
          />
          {/* Geteilte Taskleiste: links (70 %) alles außer täglich, rechts (30 %) die täglichen Checks */}
          <div className="flex-1 flex max-h-[460px] min-h-[220px]">
            <div className="flex-[7] min-w-0 overflow-y-auto">
              {otherTasks.length === 0 && <EmptyState text="Nichts fällig – freier Kopf." />}
              {otherTasks.map((t) => (
                <Row key={t.id} className="py-3.5">
                  <CheckCircle onComplete={() => completeTask(t.id)} />
                  <div className="flex-1 min-w-0 text-[14px] font-medium truncate">{t.title}</div>
                  {t.source !== "eigen" && t.submitted_by && <Badge tone="accent">{t.submitted_by}</Badge>}
                  {t.recurrence && <Icon name="autorenew" size={15} className="text-ink-3" />}
                  {t.priority === 1 && <Badge tone="bad">hoch</Badge>}
                </Row>
              ))}
            </div>
            <div className="flex-[3] min-w-0 overflow-y-auto border-l border-line bg-inset/40">
              <div className="px-2.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3 flex items-center gap-1">
                <Icon name="autorenew" size={12} />
                Täglich
              </div>
              {dailyTasks.length === 0 && (
                <p className="text-[11px] text-ink-3 px-2.5 py-2">Alles erledigt.</p>
              )}
              {dailyTasks.map((t) => (
                <div key={t.id} className="flex items-start gap-1.5 px-2.5 py-2 border-t border-line/60 first:border-t-0">
                  <CheckCircle size={20} onComplete={() => completeTask(t.id)} className="mt-0.5" />
                  <div className="flex-1 min-w-0 text-[11px] font-medium leading-snug line-clamp-2">
                    {t.title}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        );
      case "gewohnheiten":
        return (
        <Card>
          <CardHeader
            title="Gewohnheiten"
            subtitle={`${doneHabits.size} von ${data.habits.length} heute`}
            action={<Link href="/gewohnheiten" className="text-[12px] text-accent">Details →</Link>}
          />
          <div className="px-5 pb-4 pt-1 flex flex-wrap gap-2">
            {data.habits.map((h) => {
              const done = doneHabits.has(Number(h.id));
              return (
                <button
                  key={h.id}
                  onClick={() => toggleHabit(h.id)}
                  className={`flex items-center gap-2 px-3.5 h-9 rounded-full border text-[13px] font-medium transition-all ${
                    done
                      ? "bg-accent-soft border-accent/30 text-accent"
                      : "bg-inset border-line text-ink-2 hover:border-ink-3"
                  }`}
                >
                  <MaybeIcon value={h.emoji} size={17} />
                  {h.name}
                  {done && <Icon name="check" size={15} />}
                </button>
              );
            })}
          </div>
        </Card>

        );
      case "termine":
        return (
        <Card>
          <CardHeader
            title="Nächste Termine"
            action={<Link href="/kalender" className="text-[12px] text-accent">Kalender →</Link>}
          />
          {data.events.length === 0 && <EmptyState text="Keine anstehenden Termine." />}
          {data.events.slice(0, 4).map((e) => (
            <Row key={e.id}>
              <div className="text-[12px] text-ink-2 w-[96px] shrink-0">
                {e.date === todayIso() ? "Heute" : fmtDate(e.date)}
                <div className="text-ink-3">{e.start_time}{e.end_time ? `–${e.end_time}` : ""}</div>
              </div>
              <div className="w-[3px] self-stretch rounded-full bg-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{e.title}</div>
                {e.location && <div className="text-[11px] text-ink-3 truncate">{e.location}</div>}
              </div>
            </Row>
          ))}
        </Card>
        );
      case "vertraege":
        return data.contractsDue.length > 0 ? (
        <Card>
          <CardHeader
            title="Verträge im Blick"
            subtitle="Kündigungsfenster, die bald schließen"
            action={<Link href="/vertraege" className="text-[12px] text-accent">Alle →</Link>}
          />
          {data.contractsDue.map((c) => (
            <Row key={c.id}>
              <Icon name="contract" size={18} className="text-ink-3" />
              <div className="flex-1 min-w-0">
                <span className="text-[13px] font-medium">{c.name}</span>
                <span className="text-[12px] text-ink-3 ml-2 hidden sm:inline">{c.provider}</span>
              </div>
              <Badge tone={c.days_to_cancel < 0 ? "bad" : c.days_to_cancel < 21 ? "warn" : "neutral"}>
                {c.days_to_cancel < 0 ? "Frist abgelaufen" : `noch ${c.days_to_cancel} Tage kündbar`}
              </Badge>
            </Row>
          ))}
        </Card>
        ) : null;
      case "buchhaltung":
        return data.buchhaltung ? (
        <Link href="/buchhaltung" className="block">
          <Card className="hover:border-accent/40 transition-all">
            <CardHeader
              title="Buchhaltung"
              subtitle={monthLabel(data.buchhaltung.monat)}
              action={<span className="text-[12px] text-accent">Öffnen →</span>}
            />
            <div className="grid grid-cols-3 gap-2 px-5 pb-4">
              {[
                {
                  icon: "receipt_long",
                  value: String(data.buchhaltung.fehlt_anzahl),
                  label: data.buchhaltung.fehlt_anzahl > 0 ? `fehlen · ${eur(data.buchhaltung.fehlt_summe)}` : "Belege fehlen",
                  active: data.buchhaltung.fehlt_anzahl > 0,
                },
                {
                  icon: "inbox",
                  value: String(data.buchhaltung.eingang_neu),
                  label: "neue Eingänge",
                  active: data.buchhaltung.eingang_neu > 0,
                },
                {
                  icon: "event",
                  value: data.buchhaltung.naechste_frist ? fmtDate(data.buchhaltung.naechste_frist.faellig).slice(0, 6) : "–",
                  label: data.buchhaltung.naechste_frist?.titel ?? "keine Frist",
                  active: Boolean(data.buchhaltung.naechste_frist),
                },
              ].map((k) => (
                <div key={k.icon} className={`bg-inset rounded-[12px] px-3 py-2.5 min-w-0 ${k.active ? "" : "opacity-60"}`}>
                  <div className="flex items-center gap-1.5">
                    <Icon name={k.icon} size={16} className={k.active ? "text-accent" : "text-ink-3"} />
                    <span className={`text-[17px] font-bold leading-none ${k.active ? "" : "text-ink-3"}`}>{k.value}</span>
                  </div>
                  <div className="text-[11px] text-ink-3 mt-1 truncate">{k.label}</div>
                </div>
              ))}
            </div>
          </Card>
        </Link>
        ) : null;
      case "wartet":
        return <WartetWidget items={data.wartet ?? []} />;
      case "fristen":
        return <FristenWidget items={data.fristen ?? []} />;
      case "konto":
        return data.konto ? <KontoWidget konto={data.konto} /> : null;
      case "station":
        return data.station ? <StationWidget s={data.station} /> : null;
      case "flotte":
        return data.flotte ? <FlotteWidget f={data.flotte} /> : null;
      case "wohnwerk":
        return data.wohnwerk ? <WohnwerkWidget w={data.wohnwerk} /> : null;
      default:
        return null;
    }
  };

  return (
    <div>
      {/* Kopf: Orientierung in einer Sekunde */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-[26px] sm:text-[32px] font-bold tracking-tight">
            {greeting}
            {data.config?.user_name ? `, ${data.config.user_name}` : ""}.
          </h1>
          {/* Schnellzugriff oben rechts: Clipboard, Einstellungen, Profil */}
          <div className="flex items-center gap-1 shrink-0 mt-1">
            <Link
              href="/arion"
              aria-label="ARION – Sprachassistent"
              title="ARION – Sprachassistent"
              className="w-10 h-10 rounded-full flex items-center justify-center bg-accent-soft text-accent hover:bg-accent hover:text-on-accent transition-all"
            >
              <Icon name="graphic_eq" size={22} />
            </Link>
            <Link
              href="/clipboard"
              aria-label="Clipboard"
              className="w-10 h-10 rounded-full flex items-center justify-center text-ink-2 hover:text-accent hover:bg-inset transition-all"
            >
              <Icon name="attach_file" size={22} />
            </Link>
            <Link
              href="/einstellungen"
              aria-label="Einstellungen"
              className="w-10 h-10 rounded-full flex items-center justify-center text-ink-2 hover:text-accent hover:bg-inset transition-all"
            >
              <Icon name="settings" size={22} />
            </Link>
            <button
              onClick={async () => {
                if (!confirm("Abmelden?")) return;
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.href = "/login";
              }}
              aria-label="Profil / Abmelden"
              className="w-10 h-10 rounded-full flex items-center justify-center text-ink-2 hover:text-accent hover:bg-inset transition-all"
            >
              <Icon name="account_circle" size={24} />
            </button>
          </div>
        </div>
        <p className="text-[12px] text-ink-3 mt-1">
          {dateStr} · KW {isoWeek(now)}
        </p>
        {data.inboxCount > 0 && (
          <Link
            href="/aufgaben"
            className="inline-flex items-center gap-2 mt-3 px-3.5 h-8 rounded-full bg-accent-soft text-accent text-[13px] font-medium"
          >
            <Icon name="inbox" size={16} /> {data.inboxCount} neue{" "}
            {data.inboxCount === 1 ? "Aufgabe" : "Aufgaben"} von Mitarbeitern im Eingang →
          </Link>
        )}
      </div>

      {/* Startseite = Widget-Baukasten: Reihenfolge/Sichtbarkeit/Breite in app_config.home_layout */}
      <div className="flex justify-end -mt-3 mb-2">
        <button
          onClick={() => setEditing((v) => !v)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] text-ink-2 hover:text-accent hover:bg-inset transition-all"
        >
          <Icon name={editing ? "check" : "dashboard_customize"} size={16} />
          {editing ? "Fertig" : "Anpassen"}
        </button>
      </div>

      {editing && <LayoutEditor layout={layout} onChange={saveLayout} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {layout
          .filter((w) => w.an)
          .map((w) => {
            const el = renderWidget(w.id);
            if (!el) return null;
            return (
              <div key={w.id} className={w.breit ? "lg:col-span-2" : ""}>
                {el}
              </div>
            );
          })}
      </div>

      <TaskQuickSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onCreated={reload} />
    </div>
  );
}

/** Bearbeiten-Modus: Widgets ein-/ausblenden, verschieben, Breite umschalten. */
function LayoutEditor({ layout, onChange }: { layout: LayoutItem[]; onChange: (l: LayoutItem[]) => void }) {
  const set = (id: WidgetId, patch: Partial<LayoutItem>) => onChange(layout.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <Card className="mb-4">
      <CardHeader
        title="Startseite anpassen"
        subtitle="Ein-/ausblenden, Reihenfolge, halbe oder volle Breite"
        action={
          <button
            onClick={() => onChange(normalizeLayout(null))}
            className="text-[12px] text-ink-3 hover:text-accent"
          >
            Zurücksetzen
          </button>
        }
      />
      {layout.map((item, i) => {
        const def = WIDGETS.find((w) => w.id === item.id)!;
        return (
          <Row key={item.id} className="py-2.5">
            <button
              onClick={() => set(item.id, { an: !item.an })}
              aria-label={item.an ? "Ausblenden" : "Einblenden"}
              className={`w-9 h-5 rounded-full relative transition-all shrink-0 ${item.an ? "bg-accent" : "bg-inset border border-line"}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${item.an ? "left-[18px] bg-on-accent" : "left-0.5 bg-ink-3"}`} />
            </button>
            <Icon name={def.icon} size={18} className={item.an ? "text-ink-2" : "text-ink-3"} />
            <div className={`flex-1 min-w-0 ${item.an ? "" : "opacity-50"}`}>
              <div className="text-[13px] font-medium truncate">{def.label}</div>
              <div className="text-[11px] text-ink-3 truncate">{def.beschreibung}</div>
            </div>
            <button
              onClick={() => set(item.id, { breit: !item.breit })}
              title={item.breit ? "Volle Breite" : "Halbe Breite"}
              aria-label="Breite umschalten"
              className="hidden lg:flex w-8 h-8 rounded-full items-center justify-center text-ink-3 hover:text-accent hover:bg-inset"
            >
              <Icon name={item.breit ? "width_full" : "width_normal"} size={18} />
            </button>
            <button
              onClick={() => onChange(moveItem(layout, item.id, -1))}
              disabled={i === 0}
              aria-label="Nach oben"
              className="w-8 h-8 rounded-full flex items-center justify-center text-ink-3 hover:text-accent hover:bg-inset disabled:opacity-30"
            >
              <Icon name="arrow_upward" size={18} />
            </button>
            <button
              onClick={() => onChange(moveItem(layout, item.id, 1))}
              disabled={i === layout.length - 1}
              aria-label="Nach unten"
              className="w-8 h-8 rounded-full flex items-center justify-center text-ink-3 hover:text-accent hover:bg-inset disabled:opacity-30"
            >
              <Icon name="arrow_downward" size={18} />
            </button>
          </Row>
        );
      })}
    </Card>
  );
}
