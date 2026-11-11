"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Icon } from "@/components/ui";
import { SendeRegler } from "@/components/SendeSheet";

/**
 * Alle offenen Entwürfe auf einmal senden (Heute → „Nur du kannst: senden“ und
 * Postfach → Entwürfe).
 *
 * Albert sieht jeden Entwurf mit Empfänger, Absender und Anhängen, kann einzelne
 * abwählen und schiebt einmal den Regler. Gesendet wird nacheinander über
 * /api/mail/drafts/send – derselbe Weg wie beim Einzelversand, also mit Login-
 * Pflicht und denselben Prüfungen. Schlägt eine Mail fehl, laufen die übrigen
 * weiter; der Fehler steht an der Zeile. Entwürfe mit Status „Fehler“ sind hier
 * nicht dabei, die schaut man sich einzeln an.
 */

type Entwurf = {
  id: number;
  to_addr: string;
  from_addr?: string | null;
  account?: string | null;
  subject: string;
  status: string;
  files?: { filename: string }[];
  forward_files?: string[];
};

type Zustand = "wartet" | "sendet" | "gesendet" | "fehler";

export default function AlleSendenSheet({
  offen,
  onClose,
  onFertig,
}: {
  offen: boolean;
  onClose: () => void;
  /** nach dem Lauf (auch bei Teilfehlern), damit die Listen neu laden */
  onFertig: (text: string) => void;
}) {
  const [entwuerfe, setEntwuerfe] = useState<Entwurf[] | null>(null);
  const [gewaehlt, setGewaehlt] = useState<Set<number>>(new Set());
  const [zustand, setZustand] = useState<Record<number, { z: Zustand; text?: string }>>({});
  const [laeuft, setLaeuft] = useState(false);
  const [fertig, setFertig] = useState(false);
  const [ladeFehler, setLadeFehler] = useState("");

  useEffect(() => {
    if (!offen) return;
    let ab = false;
    setEntwuerfe(null);
    setZustand({});
    setFertig(false);
    setLadeFehler("");
    fetch("/api/mail/drafts?status=entwurf")
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data)) throw new Error(data?.error ?? `Server-Fehler ${res.status}`);
        return data as Entwurf[];
      })
      .then((liste) => {
        if (ab) return;
        const sortiert = [...liste].sort((a, b) => a.id - b.id);
        setEntwuerfe(sortiert);
        setGewaehlt(new Set(sortiert.map((d) => d.id)));
      })
      .catch((e: unknown) => !ab && setLadeFehler(e instanceof Error ? e.message : String(e)));
    return () => {
      ab = true;
    };
  }, [offen]);

  // Escape schließt (nicht während des Sendens)
  useEffect(() => {
    if (!offen) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && !laeuft && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [offen, laeuft, onClose]);

  if (!offen) return null;

  const liste = entwuerfe ?? [];
  const auswahl = liste.filter((d) => gewaehlt.has(d.id));
  const anzahl = auswahl.length;

  const umschalten = (id: number) => {
    if (laeuft || fertig) return;
    setGewaehlt((alt) => {
      const neu = new Set(alt);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  };

  const sendenAlle = async () => {
    if (laeuft || fertig || anzahl === 0) return;
    setLaeuft(true);
    let ok = 0;
    let fehler = 0;
    for (const d of auswahl) {
      setZustand((z) => ({ ...z, [d.id]: { z: "sendet" } }));
      try {
        const res = await fetch("/api/mail/drafts/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: d.id }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Server-Fehler ${res.status}`);
        ok++;
        setZustand((z) => ({ ...z, [d.id]: { z: "gesendet", text: data.hinweis } }));
      } catch (e) {
        fehler++;
        setZustand((z) => ({ ...z, [d.id]: { z: "fehler", text: e instanceof Error ? e.message : String(e) } }));
      }
    }
    setLaeuft(false);
    setFertig(true);
    const text = fehler
      ? `${ok} gesendet, ${fehler} mit Fehler – bitte im Postfach ansehen.`
      : `${ok} ${ok === 1 ? "Mail" : "Mails"} gesendet.`;
    onFertig(text);
  };

  const anzahlGesendet = Object.values(zustand).filter((z) => z.z === "gesendet").length;
  const anzahlFehler = Object.values(zustand).filter((z) => z.z === "fehler").length;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Alle Entwürfe senden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm sende-einblenden" onClick={() => !laeuft && onClose()} />
      <div className="relative w-full max-w-[560px] max-h-[92dvh] flex flex-col bg-[#17191a] border border-line rounded-t-[22px] sm:rounded-[22px] shadow-[0_-8px_40px_rgba(0,0,0,0.5)] sende-hochfahren">
        <div className="w-10 h-1 rounded-full bg-ink-3/40 mx-auto mt-3 shrink-0 sm:hidden" />
        <button
          type="button"
          onClick={onClose}
          disabled={laeuft}
          aria-label="Schließen"
          className="absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-ink-3 hover:text-ink hover:bg-inset disabled:opacity-30"
        >
          <Icon name="close" size={20} />
        </button>

        <div className="px-5 pt-5 pb-3 pr-14 shrink-0">
          <div className="text-[16px] font-semibold leading-snug">Alle Entwürfe senden</div>
          <div className="text-[12px] text-ink-3 mt-0.5">
            {fertig
              ? `${anzahlGesendet} gesendet${anzahlFehler ? `, ${anzahlFehler} mit Fehler` : ""}`
              : laeuft
                ? `Sende ${anzahlGesendet + anzahlFehler + 1} von ${anzahl} …`
                : entwuerfe
                  ? `${anzahl} von ${liste.length} ausgewählt · Antippen zum Ab- oder Anwählen`
                  : "Lade Entwürfe …"}
          </div>
        </div>

        <div className="px-3 overflow-y-auto flex-1 min-h-0">
          {ladeFehler && (
            <p className="px-2 py-3 text-[12px] text-bad flex items-start gap-1.5" role="alert">
              <Icon name="error" size={16} className="mt-px" />
              {ladeFehler}
            </p>
          )}
          {entwuerfe && liste.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-ink-3">Keine offenen Entwürfe.</p>}
          {liste.map((d) => {
            const an = gewaehlt.has(d.id);
            const z = zustand[d.id];
            const anhaenge = (d.files?.length ?? 0) + (d.forward_files?.length ?? 0);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => umschalten(d.id)}
                disabled={laeuft || fertig}
                aria-pressed={an}
                className={`w-full text-left flex items-start gap-3 px-2 py-2.5 rounded-[12px] transition-colors hover:bg-inset/60 disabled:hover:bg-transparent ${
                  !an && !z ? "opacity-45" : ""
                }`}
              >
                <span className="mt-0.5 shrink-0 w-[22px] h-[22px] flex items-center justify-center">
                  {z?.z === "sendet" ? (
                    <Icon name="progress_activity" size={20} className="text-accent animate-spin" />
                  ) : z?.z === "gesendet" ? (
                    <span className="w-[22px] h-[22px] rounded-full bg-accent text-on-accent flex items-center justify-center">
                      <Icon name="check" size={15} />
                    </span>
                  ) : z?.z === "fehler" ? (
                    <Icon name="error" size={20} className="text-bad" />
                  ) : (
                    <span
                      className={`w-[20px] h-[20px] rounded-full border-[1.5px] flex items-center justify-center ${
                        an ? "bg-accent border-accent text-on-accent" : "border-ink-3"
                      }`}
                    >
                      {an && <Icon name="check" size={14} />}
                    </span>
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[13px] font-medium">{d.subject || "(ohne Betreff)"}</span>
                  <span className="block truncate text-[12px] text-ink-2 mt-0.5">an {d.to_addr || "–"}</span>
                  <span className="flex items-center gap-1.5 mt-0.5 text-[11px] text-ink-3 min-w-0">
                    <span className="truncate">von {d.from_addr || d.account || "?"}</span>
                    {anhaenge > 0 && (
                      <span className="inline-flex items-center gap-0.5 shrink-0">
                        <Icon name="attach_file" size={12} />
                        {anhaenge}
                      </span>
                    )}
                  </span>
                  {z?.z === "fehler" && z.text && <span className="block text-[12px] text-bad mt-1 break-words">{z.text}</span>}
                  {z?.z === "gesendet" && z.text && <span className="block text-[11px] text-ink-3 mt-0.5 break-words">{z.text}</span>}
                </span>
                {z?.z === "gesendet" && <Badge tone="good">gesendet</Badge>}
              </button>
            );
          })}
        </div>

        <div className="px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] space-y-3 shrink-0 border-t border-line">
          {fertig ? (
            <Button onClick={onClose} className="w-full h-11">
              Fertig
            </Button>
          ) : (
            <SendeRegler
              onSenden={sendenAlle}
              gesperrt={laeuft || !entwuerfe || anzahl === 0}
              text={anzahl === 0 ? "Nichts ausgewählt" : `${anzahl} ${anzahl === 1 ? "Mail" : "Mails"} senden – schieben`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
