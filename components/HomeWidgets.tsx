"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, CardHeader, CheckCircle, EmptyState, Icon, Row } from "@/components/ui";
import { fmtDate } from "@/lib/client";
import SendeSheet from "@/components/SendeSheet";
import BezahlSheet, { type BezahlVorgang } from "@/components/BezahlSheet";
import type { EingangZahlen, Faelle, FallItem, Jetzt, JetztItem, WartetItem } from "@/lib/home-data";

/* Neue Startseiten-Widgets. Daten kommen fertig aus /api/dashboard (lib/home-data.ts). */

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const tageText = (t: number) => (t < 0 ? `seit ${-t} T` : t === 0 ? "heute" : t === 1 ? "morgen" : `in ${t} T`);
const tageTon = (t: number): "bad" | "warn" | "neutral" => (t <= 1 ? "bad" : t <= 7 ? "warn" : "neutral");

export type { WartetItem, Faelle, Jetzt, EingangZahlen };
export type Frist = { titel: string; datum: string; tage: number; art: string; href: string; dokument?: { name: string; oeffnen: string } };
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

/**
 * Entwürfe zur Freigabe. Claude legt Entwürfe an, gesendet wird nur hier.
 * Ein Tipp auf den Entwurf öffnet das Sende-Popup (components/SendeSheet.tsx):
 * Absender, Empfänger, Text, Anhänge und „Zum Senden schieben“.
 * Push-Link /?entwurf=ID öffnet das Popup direkt.
 */
export function WartetWidget({ items, onChanged }: { items: WartetItem[]; onChanged?: () => void }) {
  const [offenId, setOffenId] = useState<number | null>(null);
  const [meldung, setMeldung] = useState("");

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("entwurf"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- einmalig aus dem Push-Link übernehmen
    if (id) setOffenId(id);
  }, []);

  const offen = items.find((d) => d.id === offenId) ?? null;

  return (
    <Card>
      <CardHeader
        title="Nur du kannst: senden"
        subtitle={items.length ? `${items.length} ${items.length === 1 ? "Entwurf" : "Entwürfe"} zum Senden` : "Nichts offen"}
        action={
          <Link href="/postfach?ansicht=entwuerfe" className="text-[12px] text-accent">
            Postfach →
          </Link>
        }
      />
      {meldung && <Hinweis icon="check_circle" text={meldung} />}
      {items.length === 0 && !meldung && <EmptyState text="Keine Mail wartet auf deine Freigabe." />}
      {items.slice(0, 5).map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => {
            setMeldung("");
            setOffenId(d.id);
          }}
          className="block w-full text-left hover:bg-inset/40 transition-colors"
        >
          <Row>
            <Icon name={d.status === "fehler" ? "error" : "outgoing_mail"} size={18} className={d.status === "fehler" ? "text-bad" : "text-ink-3"} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium truncate">{d.betreff || "(ohne Betreff)"}</div>
              <div className="text-[11px] text-ink-3 truncate">an {d.an}</div>
            </div>
            {d.status === "fehler" ? <Badge tone="bad">Fehler</Badge> : d.quelle === "claude" ? <Badge tone="accent">Claude</Badge> : null}
            <span className="inline-flex items-center gap-1 h-8 px-3 rounded-full bg-accent-soft text-accent text-[12px] font-medium shrink-0">
              <Icon name="send" size={14} />
              Senden
            </span>
          </Row>
        </button>
      ))}
      <SendeSheet
        entwurf={offen}
        onClose={() => setOffenId(null)}
        onGesendet={(text) => {
          setOffenId(null);
          setMeldung(text);
          if (window.location.search.includes("entwurf=")) window.history.replaceState(null, "", window.location.pathname);
          onChanged?.();
        }}
      />
    </Card>
  );
}

/** Frist eines Falls: Datum + Resttage, rot bei ≤ 1 Tag, gelb bei ≤ 7 Tagen. */
function FristBadge({ iso }: { iso: string }) {
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const t = Math.round((new Date(`${iso}T00:00:00`).getTime() - heute.getTime()) / 86400000);
  return (
    <Badge tone={tageTon(t)}>
      {fmtDate(iso)} · {tageText(t)}
    </Badge>
  );
}

/**
 * Offene Fälle (mit Claude): alles, was Albert im Chat angestoßen hat. Claude
 * legt die Fälle an und schreibt den Stand dazu; abgehakt wird hier. Dokumente
 * (Brief-Scan, Mail-Anhang) lassen sich im aufgeklappten Fall öffnen und
 * herunterladen. Erledigte bleiben 14 Tage sichtbar und lassen sich zurückholen.
 */
export function FaelleWidget({ faelle, onChanged }: { faelle: Faelle; onChanged?: () => void }) {
  const [offen, setOffen] = useState<number | null>(null);
  const [zeigeErledigt, setZeigeErledigt] = useState(false);
  const [fehler, setFehler] = useState("");

  const setzen = async (id: number, undo: boolean) => {
    setFehler("");
    try {
      const res = await fetch("/api/tasks/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, undo }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setFehler(data?.error ?? `Server-Fehler ${res.status}`);
        return;
      }
      setOffen(null);
      onChanged?.();
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  };

  const zeile = (f: FallItem, erledigt: boolean) => {
    const auf = offen === f.id;
    const hatPills = f.dokumente.length > 0 || f.sdworx || f.bereich || (!erledigt && (f.prio === 1 || f.frist || f.wartet));
    return (
      <div key={f.id} className={auf ? "bg-inset/40" : ""}>
        {/* Titel und Stand bekommen die volle Breite, die Pills stehen in einer eigenen Zeile darunter */}
        <div className="flex items-start gap-3 px-5 py-3 border-t border-line first:border-t-0">
          <div className="shrink-0 pt-px">
            {erledigt ? (
              <button
                type="button"
                onClick={() => setzen(f.id, true)}
                className="w-[22px] h-[22px] rounded-full bg-accent border-accent text-on-accent flex items-center justify-center"
                aria-label="Wieder öffnen"
                title="Wieder öffnen"
              >
                <Icon name="check" size={15} />
              </button>
            ) : (
              <CheckCircle size={22} onComplete={() => setzen(f.id, false)} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <button type="button" onClick={() => setOffen(auf ? null : f.id)} aria-expanded={auf} className="block w-full text-left">
              <div className={`text-[13px] font-medium ${auf ? "" : "line-clamp-2"} ${erledigt ? "line-through text-ink-3" : ""}`}>{f.titel}</div>
              {!auf && (f.naechsterSchritt || f.stand) && (
                <div className={`text-[11px] line-clamp-2 ${f.naechsterSchritt ? "text-ink-2" : "text-ink-3"}`}>
                  {f.naechsterSchritt ? `→ ${f.naechsterSchritt}` : f.stand}
                </div>
              )}
            </button>
            {hatPills && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {f.dokumente.length > 0 && (
                  <span title={f.dokumente.length === 1 ? "1 Dokument" : `${f.dokumente.length} Dokumente`} className="inline-flex">
                    <Icon name="attach_file" size={16} className="text-ink-3" />
                  </span>
                )}
                {f.sdworx && (
                  <Badge tone={f.sdworx.status === "weitergeleitet" ? "good" : "warn"}>
                    {f.sdworx.status === "weitergeleitet" ? "bei SD Worx" : f.sdworx.status === "wartet" ? "SD Worx wartet" : "nicht an SD Worx"}
                  </Badge>
                )}
                {!erledigt && f.status === "nachhaken" && <Badge tone="warn">nachhaken · {f.wartet.replace(/^wartet auf /, "")}</Badge>}
                {!erledigt && f.status === "wartet" && (
                  <Badge>
                    {f.wartet}
                    {f.nachhakenAm ? ` · ab ${fmtDate(f.nachhakenAm).slice(0, 6)}` : ""}
                  </Badge>
                )}
                {f.bereich && <Badge>{f.bereich}</Badge>}
                {!erledigt && f.prio === 1 && <Badge tone="bad">dringend</Badge>}
                {!erledigt && f.frist && <FristBadge iso={f.frist} />}
              </div>
            )}
          </div>
        </div>
        {auf && (
          <div className="px-5 pb-3 -mt-1 pl-[54px] space-y-1">
            {f.naechsterSchritt && (
              <p className="text-[13px] text-ink">
                <span className="text-accent font-medium">Nächster Schritt: </span>
                {f.naechsterSchritt}
              </p>
            )}
            {f.sdworx && <p className="text-[12px] text-ink-2">SD Worx: {f.sdworx.text}</p>}
            {f.stand && <p className="text-[13px] text-ink-2 leading-relaxed whitespace-pre-line">{f.stand}</p>}
            {f.dokumente.length > 0 && (
              <div className="pt-1 space-y-1.5">
                {f.dokumente.map((dok) => (
                  <div key={dok.oeffnen} className="flex items-center gap-2 rounded-[10px] bg-inset px-3 py-2">
                    <Icon name={dok.art === "brief" ? "description" : "attach_file"} size={16} className="text-ink-3 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-[12px]">{dok.name}</span>
                    <a
                      href={dok.oeffnen}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 px-3 h-8 rounded-full text-[12px] font-medium text-accent hover:bg-accent-soft"
                    >
                      <Icon name="open_in_new" size={15} />
                      Öffnen
                    </a>
                    <a
                      href={dok.download}
                      download
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full text-ink-2 hover:bg-accent-soft hover:text-accent"
                      aria-label={`${dok.name} herunterladen`}
                      title="Herunterladen"
                    >
                      <Icon name="download" size={17} />
                    </a>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-ink-3">
              angelegt {f.erstellt ? fmtDate(f.erstellt) : "–"}
              {f.erledigtAm ? ` · erledigt ${fmtDate(f.erledigtAm)}` : ""}
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader
        title="Offene Fälle"
        badge={<Badge tone="accent">Claude</Badge>}
        subtitle={
          faelle.offen.length
            ? (() => {
                const bei = faelle.offen.filter((f) => f.status === "ich" || f.status === "nachhaken").length;
                const warten = faelle.offen.length - bei;
                return `${bei} bei dir${warten ? ` · ${warten} warten auf andere` : ""}`;
              })()
            : "Alles erledigt"
        }
        action={
          <Link href="/aufgaben" className="text-[12px] text-accent">
            Vorgänge →
          </Link>
        }
      />
      {fehler && <p className="px-5 pb-2 text-[12px] text-bad">{fehler}</p>}
      {faelle.offen.length === 0 && <EmptyState text="Kein offener Fall – alles abgehakt." />}
      <div className="max-h-[420px] overflow-y-auto">{faelle.offen.map((f) => zeile(f, false))}</div>
      {faelle.erledigt.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setZeigeErledigt(!zeigeErledigt)}
            className="w-full flex items-center gap-1.5 px-5 py-2.5 text-[12px] text-ink-3 hover:text-ink-2 border-t border-line"
            aria-expanded={zeigeErledigt}
          >
            <Icon name={zeigeErledigt ? "expand_less" : "expand_more"} size={16} />
            Erledigt ({faelle.erledigt.length}) · letzte 14 Tage
          </button>
          {zeigeErledigt && faelle.erledigt.map((f) => zeile(f, true))}
        </>
      )}
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
        <div key={`${f.art}-${i}`} className="flex items-center hover:bg-inset/40 transition-all">
          <Link href={f.href} className="flex-1 min-w-0">
            <Row>
              <Icon name={ICON[f.art] ?? "event"} size={18} className="text-ink-3" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{f.titel}</div>
                <div className="text-[11px] text-ink-3">{fmtDate(f.datum)}</div>
              </div>
              <Badge tone={tageTon(f.tage)}>{tageText(f.tage)}</Badge>
            </Row>
          </Link>
          {f.dokument && (
            <a
              href={f.dokument.oeffnen}
              target="_blank"
              rel="noopener"
              title={f.dokument.name}
              aria-label={`Dokument öffnen: ${f.dokument.name}`}
              className="shrink-0 w-10 h-10 mr-2 rounded-full flex items-center justify-center text-ink-3 hover:text-ink hover:bg-inset"
            >
              <Icon name="description" size={18} />
            </a>
          )}
        </div>
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

/* ── Heute in festen Blöcken (docs/VORGAENGE.md) ─────────── */

async function vorgangAbhaken(id: number, undo = false) {
  await fetch("/api/tasks/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, undo }),
  });
}

/** Dokumente und „Mit Qonto bezahlen“ unter einem Vorgang (auch auf der Vorgänge-Seite). */
export function VorgangAktionen<T extends BezahlVorgang>({ v, onBezahlen }: { v: T; onBezahlen?: (v: T) => void }) {
  if (!v.dokumente.length && !v.zahlung) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {v.zahlung && onBezahlen && (
        <button
          type="button"
          onClick={() => onBezahlen(v)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-accent-soft text-accent text-[12px] font-semibold hover:bg-accent/20 transition-all"
        >
          <Icon name="account_balance" size={15} />
          Mit Qonto bezahlen
        </button>
      )}
      {v.dokumente.slice(0, 3).map((k) => (
        <a
          key={k.oeffnen}
          href={k.oeffnen}
          target="_blank"
          rel="noopener"
          title={k.name}
          className="inline-flex items-center gap-1.5 h-8 px-3 max-w-[220px] rounded-full border border-line bg-card text-[12px] text-ink-2 hover:border-ink-3 transition-all"
        >
          <Icon name={k.art === "mail" ? "attach_file" : "description"} size={15} className="shrink-0" />
          <span className="truncate">{k.name || "Dokument"}</span>
        </a>
      ))}
      {v.dokumente.length > 3 && <span className="inline-flex items-center h-8 px-2 text-[12px] text-ink-3">+{v.dokumente.length - 3}</span>}
    </div>
  );
}

function JetztZeile({ v, onDone, onBezahlen }: { v: JetztItem; onDone: () => void; onBezahlen?: (v: JetztItem) => void }) {
  return (
    <div className="flex items-start gap-3 px-5 py-3 border-t border-line first:border-t-0">
      <div className="shrink-0 pt-px">
        <CheckCircle size={22} onComplete={async () => { await vorgangAbhaken(v.id); onDone(); }} />
      </div>
      <div className="flex-1 min-w-0">
      <Link href="/aufgaben" className="block">
        <div className="text-[14px] font-medium line-clamp-2">{v.titel}</div>
        {v.schritt && <div className="text-[12px] text-ink-2 mt-0.5 line-clamp-2">→ {v.schritt}</div>}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5 empty:hidden">
          {v.status === "nachhaken" && <Badge tone="warn">nachhaken · {v.wartet.replace(/^wartet auf /, "")}</Badge>}
          {v.tage !== null && v.frist && (
            <Badge tone={tageTon(v.tage)}>
              {fmtDate(v.frist).slice(0, 6)} · {tageText(v.tage)}
            </Badge>
          )}
          {v.projekt && <Badge>{v.projekt}</Badge>}
          {v.dringend && <Badge tone="bad">dringend</Badge>}
        </div>
      </Link>
      <VorgangAktionen v={v} onBezahlen={onBezahlen} />
      </div>
    </div>
  );
}

/** Block 1: was jetzt bei Albert liegt – höchstens sieben, Fristen zuerst. Unten die täglichen Routinen. */
export function JetztWidget({ jetzt, onChanged }: { jetzt: Jetzt; onChanged?: () => void }) {
  const [erledigt, setErledigt] = useState<Set<number>>(new Set());
  const [bezahlen, setBezahlen] = useState<JetztItem | null>(null);
  const neu = () => onChanged?.();
  const routineAbhaken = async (id: number) => {
    setErledigt((s) => new Set(s).add(id));
    await vorgangAbhaken(id);
    neu();
  };
  return (
    <Card>
      <CardHeader
        title="Jetzt dran"
        subtitle={jetzt.gesamt ? `${jetzt.gesamt} ${jetzt.gesamt === 1 ? "Vorgang liegt" : "Vorgänge liegen"} bei dir` : "Nichts liegt bei dir"}
        action={
          <Link href="/aufgaben" className="text-[12px] text-accent">
            Alle →
          </Link>
        }
      />
      {jetzt.items.length === 0 && <EmptyState text="Alles erledigt – freier Kopf." />}
      {jetzt.items.map((v) => (
        <JetztZeile key={v.id} v={v} onDone={neu} onBezahlen={setBezahlen} />
      ))}
      <BezahlSheet
        key={bezahlen?.id ?? 0}
        vorgang={bezahlen}
        onClose={() => setBezahlen(null)}
        onBezahlt={async (id) => {
          setBezahlen(null);
          await vorgangAbhaken(id);
          neu();
        }}
      />
      {jetzt.gesamt > jetzt.items.length && (
        <Link href="/aufgaben" className="block px-5 py-2.5 border-t border-line text-[12px] text-accent">
          + {jetzt.gesamt - jetzt.items.length} weitere bei dir →
        </Link>
      )}
      {jetzt.routinen.length > 0 && (
        <div className="px-5 py-3 border-t border-line bg-inset/40">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 mb-2 flex items-center gap-1">
            <Icon name="autorenew" size={12} /> Täglich
          </div>
          <div className="flex flex-wrap gap-1.5">
            {jetzt.routinen.map((r) => {
              const fertig = erledigt.has(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={fertig}
                  onClick={() => routineAbhaken(r.id)}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12px] font-medium transition-all ${
                    fertig ? "bg-accent-soft border-accent/30 text-accent" : "bg-card border-line text-ink-2 hover:border-ink-3"
                  }`}
                >
                  <Icon name={fertig ? "check" : "radio_button_unchecked"} size={15} />
                  {r.titel}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

/** Block 3: der Eingang als eine Zahl mit Weg dorthin. */
export function EingangKarte({ e }: { e: EingangZahlen }) {
  const teile = [
    e.briefe ? `${e.briefe} ${e.briefe === 1 ? "Brief" : "Briefe"}` : "",
    e.mails ? `${e.mails} ${e.mails === 1 ? "Mail" : "Mails"}` : "",
    e.mitarbeiter ? `${e.mitarbeiter} von Mitarbeitern` : "",
  ].filter(Boolean);
  return (
    <Link href="/eingang" className="block">
      <Card className="hover:border-accent/40 transition-all">
        <div className="px-5 py-4 flex items-center gap-4">
          <div className={`w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 ${e.gesamt ? "bg-accent-soft text-accent" : "bg-inset text-ink-3"}`}>
            <Icon name="move_to_inbox" size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold">{e.gesamt ? `Eingang: ${e.gesamt} zu klären` : "Eingang ist leer"}</div>
            <div className="text-[12px] text-ink-3 truncate">{teile.length ? teile.join(" · ") : "Neue Briefe, Mails und Aufgaben landen hier"}</div>
          </div>
          <Icon name="chevron_right" size={22} className="text-ink-3" />
        </div>
      </Card>
    </Link>
  );
}

/** Block 5: worauf Albert wartet – nach Nachhak-Datum. */
export function WartetAndereWidget({ jetzt }: { jetzt: Jetzt }) {
  if (!jetzt.wartetGesamt) return null;
  return (
    <Card>
      <CardHeader
        title="Wartet auf andere"
        subtitle={`${jetzt.wartetGesamt} ${jetzt.wartetGesamt === 1 ? "Vorgang" : "Vorgänge"}`}
        action={
          <Link href="/aufgaben" className="text-[12px] text-accent">
            Alle →
          </Link>
        }
      />
      {jetzt.wartet.map((v) => (
        <Link key={v.id} href="/aufgaben" className="block px-5 py-2.5 border-t border-line first:border-t-0 hover:bg-inset/40">
          <div className="text-[13px] font-medium line-clamp-1">{v.titel}</div>
          <div className="text-[11px] text-ink-3 mt-0.5">
            {v.wartet}
            {v.nachhakenAm ? ` · nachhaken ab ${fmtDate(v.nachhakenAm).slice(0, 6)}` : ""}
          </div>
        </Link>
      ))}
    </Card>
  );
}
