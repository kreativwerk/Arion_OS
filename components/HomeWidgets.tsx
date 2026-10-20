"use client";

import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, Icon, Row } from "@/components/ui";
import { fmtDate } from "@/lib/client";

/* Neue Startseiten-Widgets. Daten kommen fertig aus /api/dashboard (lib/home-data.ts). */

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const tageText = (t: number) => (t < 0 ? `seit ${-t} T` : t === 0 ? "heute" : t === 1 ? "morgen" : `in ${t} T`);
const tageTon = (t: number): "bad" | "warn" | "neutral" => (t <= 1 ? "bad" : t <= 7 ? "warn" : "neutral");

export type WartetItem = { id: number; an: string; betreff: string; status: string; quelle: string; erstellt: string };
export type Frist = { titel: string; datum: string; tage: number; art: string; href: string };
export type Konto = { saldo: number | null; stand: string | null; lastschriften: { an: string; datum: string; betrag: number | null; tage: number }[]; summe7: number };
export type Wohnwerk = { monat: string; summe: number; anzahl: number; eingaenge: { von: string; betrag: number; datum: string }[] };
export type Station = {
  verbunden: boolean;
  abwesend: { name: string; art: string }[];
  offeneAntraege: number;
  vorfaelle: { datum: string; kennzeichen: string; schaden: string; fahrer: string; stillgelegt: boolean }[];
};
export type Flotte = {
  verbunden: boolean;
  gesamt: number;
  nachStatus: { status: string; anzahl: number }[];
  ausgefallen: { kennzeichen: string; modell: string; status: string; grund: string }[];
};

function Hinweis({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-start gap-2 px-5 pb-4 pt-1 text-[12px] text-ink-3">
      <Icon name={icon} size={16} className="mt-0.5" />
      <span>{text}</span>
    </div>
  );
}

export function WartetWidget({ items }: { items: WartetItem[] }) {
  return (
    <Card>
      <CardHeader
        title="Wartet auf dich"
        subtitle={items.length ? `${items.length} ${items.length === 1 ? "Entwurf" : "Entwürfe"} zum Senden` : "Nichts offen"}
        action={
          <Link href="/postfach?ansicht=entwuerfe" className="text-[12px] text-accent">
            Öffnen →
          </Link>
        }
      />
      {items.length === 0 && <EmptyState text="Keine Mail wartet auf deine Freigabe." />}
      {items.slice(0, 5).map((d) => (
        <Link key={d.id} href="/postfach?ansicht=entwuerfe" className="block hover:bg-inset/40 transition-all">
          <Row>
            <Icon name={d.status === "fehler" ? "error" : "outgoing_mail"} size={18} className={d.status === "fehler" ? "text-bad" : "text-ink-3"} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium truncate">{d.betreff || "(ohne Betreff)"}</div>
              <div className="text-[11px] text-ink-3 truncate">an {d.an}</div>
            </div>
            {d.status === "fehler" ? <Badge tone="bad">Fehler</Badge> : d.quelle === "claude" ? <Badge tone="accent">Claude</Badge> : null}
          </Row>
        </Link>
      ))}
    </Card>
  );
}

export function FristenWidget({ items }: { items: Frist[] }) {
  const ICON: Record<string, string> = { buchhaltung: "receipt_long", aufgabe: "task_alt", vertrag: "contract", termin: "event" };
  return (
    <Card>
      <CardHeader title="Fristen-Ampel" subtitle="Nächste 45 Tage" />
      {items.length === 0 && <EmptyState text="Keine Fristen in Sicht." />}
      {items.slice(0, 6).map((f, i) => (
        <Link key={`${f.art}-${i}`} href={f.href} className="block hover:bg-inset/40 transition-all">
          <Row>
            <Icon name={ICON[f.art] ?? "event"} size={18} className="text-ink-3" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium truncate">{f.titel}</div>
              <div className="text-[11px] text-ink-3">{fmtDate(f.datum)}</div>
            </div>
            <Badge tone={tageTon(f.tage)}>{tageText(f.tage)}</Badge>
          </Row>
        </Link>
      ))}
    </Card>
  );
}

export function KontoWidget({ konto }: { konto: Konto }) {
  return (
    <Card>
      <CardHeader
        title="Konto"
        subtitle={konto.stand ? `Qonto · Stand ${fmtDate(konto.stand.slice(0, 10))}` : "Qonto"}
      />
      <div className="px-5 pb-3 flex items-end gap-6">
        <div>
          <div className="text-[24px] font-bold leading-none">{konto.saldo !== null ? eur(konto.saldo) : "–"}</div>
          <div className="text-[11px] text-ink-3 mt-1">Kontostand</div>
        </div>
        {konto.summe7 > 0 && (
          <div>
            <div className="text-[17px] font-semibold leading-none">−{eur(konto.summe7)}</div>
            <div className="text-[11px] text-ink-3 mt-1">Lastschriften 7 Tage</div>
          </div>
        )}
      </div>
      {konto.saldo === null && <Hinweis icon="info" text="Kontostand wird gezeigt, sobald der Qonto-Abgleich ihn in die Buchhaltung schreibt." />}
      {konto.lastschriften.map((l, i) => (
        <Row key={i}>
          <Icon name="south_east" size={17} className="text-ink-3" />
          <div className="flex-1 min-w-0 text-[13px] font-medium truncate">{l.an}</div>
          <span className="text-[13px] tabular-nums">{l.betrag !== null ? eur(l.betrag) : "–"}</span>
          <Badge tone={tageTon(l.tage)}>{tageText(l.tage)}</Badge>
        </Row>
      ))}
    </Card>
  );
}

export function StationWidget({ s }: { s: Station }) {
  return (
    <Card>
      <CardHeader title="Station heute" subtitle="DBY5 · aus Codriver" />
      {!s.verbunden ? (
        <Hinweis icon="link_off" text="Codriver ist noch nicht verbunden – erscheint, sobald der Codriver-Abgleich läuft." />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 px-5 pb-3">
            {[
              { icon: "event_busy", value: s.abwesend.length, label: "abwesend" },
              { icon: "pending", value: s.offeneAntraege, label: "Anträge offen" },
              { icon: "car_crash", value: s.vorfaelle.length, label: "Vorfälle 7 T" },
            ].map((k) => (
              <div key={k.icon} className={`bg-inset rounded-[12px] px-3 py-2.5 ${k.value ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-1.5">
                  <Icon name={k.icon} size={16} className={k.value ? "text-accent" : "text-ink-3"} />
                  <span className="text-[17px] font-bold leading-none">{k.value}</span>
                </div>
                <div className="text-[11px] text-ink-3 mt-1 truncate">{k.label}</div>
              </div>
            ))}
          </div>
          {s.abwesend.length > 0 && (
            <div className="px-5 pb-3 flex flex-wrap gap-1.5">
              {s.abwesend.slice(0, 10).map((a, i) => (
                <Badge key={i} tone={a.art === "Krank" ? "warn" : "neutral"}>
                  {a.name} · {a.art}
                </Badge>
              ))}
            </div>
          )}
          {s.vorfaelle.slice(0, 4).map((v, i) => (
            <Row key={i}>
              <Icon name="car_crash" size={17} className="text-ink-3" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">
                  {v.kennzeichen} · {v.schaden}
                </div>
                <div className="text-[11px] text-ink-3 truncate">
                  {fmtDate(v.datum)} · {v.fahrer}
                </div>
              </div>
              {v.stillgelegt && <Badge tone="bad">steht</Badge>}
            </Row>
          ))}
        </>
      )}
    </Card>
  );
}

export function FlotteWidget({ f }: { f: Flotte }) {
  return (
    <Card>
      <CardHeader title="Flotte" subtitle={f.verbunden ? `${f.gesamt} Fahrzeuge` : "aus Codriver"} />
      {!f.verbunden ? (
        <Hinweis icon="link_off" text="Codriver ist noch nicht verbunden – erscheint, sobald der Codriver-Abgleich läuft." />
      ) : (
        <>
          <div className="px-5 pb-3 flex flex-wrap gap-1.5">
            {f.nachStatus.map((s) => (
              <Badge key={s.status} tone={s.status === "Defekt" ? "bad" : s.status === "Werkstatt" ? "warn" : "neutral"}>
                {s.status} {s.anzahl}
              </Badge>
            ))}
          </div>
          {f.ausgefallen.length === 0 && <EmptyState text="Kein Fahrzeug fällt aus." />}
          {f.ausgefallen.map((v) => (
            <Row key={v.kennzeichen}>
              <Icon name="build" size={17} className="text-ink-3" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">
                  {v.kennzeichen} <span className="text-ink-3 font-normal">{v.modell}</span>
                </div>
                {v.grund && <div className="text-[11px] text-ink-3 truncate">{v.grund}</div>}
              </div>
              <Badge tone={v.status === "Defekt" ? "bad" : "warn"}>{v.status}</Badge>
            </Row>
          ))}
        </>
      )}
    </Card>
  );
}

export function WohnwerkWidget({ w }: { w: Wohnwerk }) {
  const monat = new Date(`${w.monat}-01T12:00:00`).toLocaleDateString("de-DE", { month: "long" });
  return (
    <Card>
      <CardHeader title="Wohnwerk" subtitle={`Mieteingänge ${monat}`} />
      <div className="px-5 pb-3">
        <div className="text-[24px] font-bold leading-none">{eur(w.summe)}</div>
        <div className="text-[11px] text-ink-3 mt-1">
          {w.anzahl} {w.anzahl === 1 ? "Eingang" : "Eingänge"} laut Qonto
        </div>
      </div>
      {w.eingaenge.slice(0, 5).map((e, i) => (
        <Row key={i}>
          <Icon name="south_west" size={17} className="text-ink-3" />
          <div className="flex-1 min-w-0 text-[13px] font-medium truncate">{e.von}</div>
          <span className="text-[12px] text-ink-3">{fmtDate(e.datum)}</span>
          <span className="text-[13px] tabular-nums">{eur(e.betrag)}</span>
        </Row>
      ))}
    </Card>
  );
}
