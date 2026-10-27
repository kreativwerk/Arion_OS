"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, CheckCircle, EmptyState, Icon, Row } from "@/components/ui";
import { fmtDate } from "@/lib/client";
import type { Faelle, FallItem, WartetItem } from "@/lib/home-data";

/* Neue Startseiten-Widgets. Daten kommen fertig aus /api/dashboard (lib/home-data.ts). */

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const tageText = (t: number) => (t < 0 ? `seit ${-t} T` : t === 0 ? "heute" : t === 1 ? "morgen" : `in ${t} T`);
const tageTon = (t: number): "bad" | "warn" | "neutral" => (t <= 1 ? "bad" : t <= 7 ? "warn" : "neutral");

export type { WartetItem, Faelle };
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

/**
 * Entwürfe zur Freigabe. Claude legt Entwürfe an, gesendet wird nur hier per
 * Knopfdruck (zweistufig: „Senden“ → „Jetzt senden“). Aufklappen zeigt Absender,
 * Empfänger, Textanfang und Anhänge. Push-Link /?entwurf=ID klappt den Entwurf auf.
 */
export function WartetWidget({ items, onChanged }: { items: WartetItem[]; onChanged?: () => void }) {
  const [offen, setOffen] = useState<number | null>(null);
  const [bestaetigen, setBestaetigen] = useState<number | null>(null);
  const [sendet, setSendet] = useState<number | null>(null);
  const [meldung, setMeldung] = useState<{ id: number; ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("entwurf"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- einmalig aus dem Push-Link übernehmen
    if (id) setOffen(id);
  }, []);

  const senden = async (id: number) => {
    setSendet(id);
    setMeldung(null);
    try {
      const res = await fetch("/api/mail/drafts/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setMeldung({ id, ok: false, text: data?.error ?? `Server-Fehler ${res.status}` });
      } else {
        setMeldung({ id, ok: true, text: data.hinweis ? `Gesendet. ${data.hinweis}` : "Gesendet." });
        setOffen(null);
        onChanged?.();
      }
    } catch (e) {
      setMeldung({ id, ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSendet(null);
      setBestaetigen(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Wartet auf dich"
        subtitle={items.length ? `${items.length} ${items.length === 1 ? "Entwurf" : "Entwürfe"} zum Senden` : "Nichts offen"}
        action={
          <Link href="/postfach?ansicht=entwuerfe" className="text-[12px] text-accent">
            Postfach →
          </Link>
        }
      />
      {meldung?.ok && <Hinweis icon="check_circle" text={meldung.text} />}
      {items.length === 0 && !meldung?.ok && <EmptyState text="Keine Mail wartet auf deine Freigabe." />}
      {items.slice(0, 5).map((d) => {
        const auf = offen === d.id;
        return (
          <div key={d.id} className={auf ? "bg-inset/40" : ""}>
            <button
              type="button"
              onClick={() => {
                setOffen(auf ? null : d.id);
                setBestaetigen(null);
              }}
              aria-expanded={auf}
              className="block w-full text-left hover:bg-inset/40 transition-colors"
            >
              <Row>
                <Icon name={d.status === "fehler" ? "error" : "outgoing_mail"} size={18} className={d.status === "fehler" ? "text-bad" : "text-ink-3"} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{d.betreff || "(ohne Betreff)"}</div>
                  <div className="text-[11px] text-ink-3 truncate">an {d.an}</div>
                </div>
                {d.status === "fehler" ? <Badge tone="bad">Fehler</Badge> : d.quelle === "claude" ? <Badge tone="accent">Claude</Badge> : null}
                <Icon name={auf ? "expand_less" : "expand_more"} size={18} className="text-ink-3" />
              </Row>
            </button>
            {auf && (
              <div className="px-5 pb-4 pt-1 space-y-2">
                <div className="text-[12px] text-ink-2 space-y-0.5">
                  <div>
                    <span className="text-ink-3">Von </span>
                    {d.von || "–"}
                  </div>
                  <div>
                    <span className="text-ink-3">An </span>
                    {d.an}
                  </div>
                </div>
                {d.vorschau && <p className="text-[13px] text-ink-2 leading-relaxed">{d.vorschau}</p>}
                {d.anhaenge.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {d.anhaenge.map((f) => (
                      <Badge key={f}>
                        <Icon name="attach_file" size={13} className="mr-1" />
                        {f}
                      </Badge>
                    ))}
                  </div>
                )}
                {meldung && !meldung.ok && meldung.id === d.id && <p className="text-[12px] text-bad">{meldung.text}</p>}
                <div className="flex items-center gap-2 pt-1">
                  {bestaetigen === d.id ? (
                    <>
                      <Button onClick={() => senden(d.id)} disabled={sendet === d.id}>
                        {sendet === d.id ? "Sendet …" : "Jetzt senden"}
                      </Button>
                      <Button variant="ghost" onClick={() => setBestaetigen(null)} disabled={sendet === d.id}>
                        Abbrechen
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => setBestaetigen(d.id)}>
                        <Icon name="send" size={15} className="mr-1.5 -ml-0.5" />
                        Senden
                      </Button>
                      <Link href="/postfach?ansicht=entwuerfe" className="text-[13px] text-accent px-2">
                        Bearbeiten
                      </Link>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

/**
 * Fälle mit Claude: alles, was Albert im Chat angestoßen hat. Claude legt
 * die Fälle an und schreibt den Stand dazu; abgehakt wird hier. Erledigte
 * bleiben 14 Tage sichtbar und lassen sich zurückholen.
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
    return (
      <div key={f.id} className={auf ? "bg-inset/40" : ""}>
        <Row>
          {erledigt ? (
            <button
              type="button"
              onClick={() => setzen(f.id, true)}
              className="w-[22px] h-[22px] rounded-full bg-accent border-accent text-on-accent flex items-center justify-center shrink-0"
              aria-label="Wieder öffnen"
              title="Wieder öffnen"
            >
              <Icon name="check" size={15} />
            </button>
          ) : (
            <CheckCircle size={22} onComplete={() => setzen(f.id, false)} />
          )}
          <button
            type="button"
            onClick={() => setOffen(auf ? null : f.id)}
            aria-expanded={auf}
            className="flex-1 min-w-0 text-left"
          >
            <div className={`text-[13px] font-medium ${auf ? "" : "truncate"} ${erledigt ? "line-through text-ink-3" : ""}`}>{f.titel}</div>
            {!auf && f.stand && <div className="text-[11px] text-ink-3 truncate">{f.stand}</div>}
          </button>
          {f.bereich && <span className="hidden sm:inline-flex"><Badge>{f.bereich}</Badge></span>}
          {!erledigt && f.prio === 1 && !f.frist && <Badge tone="bad">dringend</Badge>}
          {!erledigt && f.frist && f.tage !== null && (
            <Badge tone={tageTon(f.tage)}>
              <Icon name="timer" size={13} className="mr-1" />
              {f.tage < 0 ? `überfällig ${-f.tage} T` : tageText(f.tage)}
            </Badge>
          )}
        </Row>
        {auf && (
          <div className="px-5 pb-3 -mt-1 pl-[54px] space-y-1">
            {f.stand && <p className="text-[13px] text-ink-2 leading-relaxed whitespace-pre-line">{f.stand}</p>}
            {f.frist && (
              <p className={`text-[12px] font-medium ${!erledigt && f.tage !== null && f.tage <= 1 ? "text-bad" : "text-ink-2"}`}>
                Frist {fmtDate(f.frist)}
              </p>
            )}
            {f.bereich && (
              <div className="sm:hidden">
                <Badge>{f.bereich}</Badge>
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
        title="Fälle mit Claude"
        subtitle={faelleUntertitel(faelle)}
        action={
          <Link href="/aufgaben" className="text-[12px] text-accent">
            Aufgaben →
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

/** „4 offen · 1 überfällig · 2 Fristen diese Woche“ */
export function faelleUntertitel(faelle: Faelle): string {
  if (!faelle.offen.length) return "Alles erledigt";
  const teile = [`${faelle.offen.length} offen`];
  const ueber = faelle.offen.filter((f) => f.tage !== null && f.tage < 0).length;
  const woche = faelle.offen.filter((f) => f.tage !== null && f.tage >= 0 && f.tage <= 7).length;
  if (ueber) teile.push(`${ueber} überfällig`);
  if (woche) teile.push(`${woche} ${woche === 1 ? "Frist" : "Fristen"} diese Woche`);
  return teile.join(" · ");
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
