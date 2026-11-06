"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";
import type { FallDokument } from "@/lib/home-data";
import type { Zahlung } from "@/lib/zahlung";

/** Was das Sheet vom Vorgang braucht (Heute → Jetzt dran, Vorgänge-Seite). */
export type BezahlVorgang = { id: number; titel: string; dokumente: FallDokument[]; zahlung: Zahlung | null };

/**
 * Bezahl-Sheet für Vorgänge mit Zahlung (Heute → Jetzt dran → „Mit Qonto bezahlen“).
 *
 * Zeigt Empfänger, IBAN, Betrag und Verwendungszweck aus dem verknüpften Brief,
 * jeweils zum Kopieren, dazu das Dokument und den Sprung in Qonto. Überwiesen wird
 * nur in Qonto selbst (mit Alberts Freigabe dort) – Arion OS bewegt kein Geld.
 */

const QONTO_URL = "https://app.qonto.com/";

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

function kopieren(text: string): Promise<boolean> {
  return navigator.clipboard?.writeText(text).then(
    () => true,
    () => false
  ) ?? Promise.resolve(false);
}

function Zeile({ label, wert, kopierWert, hinweis }: { label: string; wert: string; kopierWert?: string; hinweis?: string }) {
  const [ok, setOk] = useState(false);
  const leer = !wert;
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 border-t border-line first:border-t-0">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-ink-3">{label}</div>
        <div className={`text-[14px] break-words ${leer ? "text-ink-3" : "font-medium tabular-nums"}`}>{leer ? hinweis ?? "–" : wert}</div>
      </div>
      {!leer && (
        <button
          type="button"
          onClick={async () => {
            if (await kopieren(kopierWert ?? wert)) {
              setOk(true);
              setTimeout(() => setOk(false), 1500);
            }
          }}
          aria-label={`${label} kopieren`}
          className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all ${ok ? "bg-accent-soft text-accent" : "text-ink-3 hover:text-ink hover:bg-inset"}`}
        >
          <Icon name={ok ? "check" : "content_copy"} size={18} />
        </button>
      )}
    </div>
  );
}

export default function BezahlSheet({ vorgang, onClose, onBezahlt }: { vorgang: BezahlVorgang | null; onClose: () => void; onBezahlt: (id: number) => void }) {
  const [allesOk, setAllesOk] = useState(false);
  useEffect(() => {
    if (!vorgang) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [vorgang, onClose]);

  if (!vorgang?.zahlung) return null;
  const z = vorgang.zahlung;
  const betrag = z.betrag !== null ? eur(z.betrag) : "";
  const alles = [
    `Empfänger: ${z.empfaenger}`,
    z.iban ? `IBAN: ${z.iban}` : "",
    z.bic ? `BIC: ${z.bic}` : "",
    betrag ? `Betrag: ${betrag}` : "",
    z.zweck ? `Verwendungszweck: ${z.zweck}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const dok = vorgang.dokumente[0];

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Mit Qonto bezahlen">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm sende-einblenden" onClick={onClose} />
      <div className="relative w-full max-w-[520px] max-h-[92dvh] flex flex-col bg-[#17191a] border border-line rounded-t-[22px] sm:rounded-[22px] shadow-[0_-8px_40px_rgba(0,0,0,0.5)] sende-hochfahren">
        <div className="w-10 h-1 rounded-full bg-ink-3/40 mx-auto mt-3 shrink-0 sm:hidden" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-ink-3 hover:text-ink hover:bg-inset"
        >
          <Icon name="close" size={20} />
        </button>

        <div className="px-5 pt-5 sm:pt-6 pb-3 pr-14">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3 flex items-center gap-1">
            <Icon name="account_balance" size={13} /> Überweisung
          </div>
          <div className="text-[26px] font-bold leading-tight mt-1 tabular-nums">{betrag || "Betrag prüfen"}</div>
          <div className="text-[13px] text-ink-2 mt-0.5 line-clamp-2">{vorgang.titel}</div>
        </div>

        <div className="px-5 overflow-y-auto space-y-3 pb-2">
          <div className="rounded-[12px] bg-inset">
            <Zeile label="Empfänger" wert={z.empfaenger} />
            <Zeile label="IBAN" wert={z.iban ?? ""} kopierWert={(z.iban ?? "").replace(/\s/g, "")} hinweis="Nicht im Scan erkannt – bitte im Dokument nachsehen" />
            {z.bic && <Zeile label="BIC" wert={z.bic} />}
            <Zeile label="Betrag" wert={betrag} kopierWert={z.betrag !== null ? z.betrag.toFixed(2).replace(".", ",") : ""} />
            <Zeile label="Verwendungszweck" wert={z.zweck} hinweis="Rechnungs- oder Referenznummer aus dem Dokument" />
          </div>
          <p className="text-[12px] text-ink-3 leading-relaxed">
            Daten aus dem Brief gelesen – vor dem Absenden in Qonto kurz mit dem Dokument abgleichen. Die Überweisung gibst du in Qonto selbst frei.
          </p>
        </div>

        <div className="px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-2 border-t border-line mt-1">
          <div className="flex gap-2 pt-2">
            {dok && (
              <a
                href={dok.oeffnen}
                target="_blank"
                rel="noopener"
                className="flex-1 h-11 rounded-full border border-line bg-card text-[13px] font-medium text-ink-2 hover:border-ink-3 inline-flex items-center justify-center gap-1.5 min-w-0"
              >
                <Icon name="description" size={17} />
                <span className="truncate">Dokument</span>
              </a>
            )}
            <button
              type="button"
              onClick={async () => {
                if (await kopieren(alles)) {
                  setAllesOk(true);
                  setTimeout(() => setAllesOk(false), 1500);
                }
              }}
              className="flex-1 h-11 rounded-full border border-line bg-card text-[13px] font-medium text-ink-2 hover:border-ink-3 inline-flex items-center justify-center gap-1.5"
            >
              <Icon name={allesOk ? "check" : "content_copy"} size={17} />
              {allesOk ? "Kopiert" : "Alles kopieren"}
            </button>
          </div>
          <a
            href={QONTO_URL}
            target="_blank"
            rel="noopener"
            onClick={() => {
              if (z.iban) void kopieren(z.iban.replace(/\s/g, ""));
            }}
            className="h-12 rounded-full bg-accent text-on-accent text-[14px] font-semibold inline-flex items-center justify-center gap-2 w-full"
          >
            <Icon name="open_in_new" size={18} />
            In Qonto überweisen
          </a>
          <button
            type="button"
            onClick={() => onBezahlt(vorgang.id)}
            className="h-10 w-full rounded-full text-[13px] text-ink-3 hover:text-ink inline-flex items-center justify-center gap-1.5"
          >
            <Icon name="task_alt" size={16} />
            Bezahlt – Vorgang abhaken
          </button>
        </div>
      </div>
    </div>
  );
}
