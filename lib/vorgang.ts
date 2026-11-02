/**
 * Vorgangsmodell (docs/VORGAENGE.md): Jede Aufgabe ist ein Vorgang mit
 * „wer ist dran“, nächstem Schritt und Nachhak-Datum. Reine Funktionen – testbar.
 */

export type WerDran = "albert" | "claude" | "mitarbeiter" | "extern";
export type VorgangStatus = "ich" | "nachhaken" | "wartet" | "erledigt";

export const WER_DRAN: { value: WerDran; label: string }[] = [
  { value: "albert", label: "Ich" },
  { value: "claude", label: "Claude" },
  { value: "mitarbeiter", label: "Mitarbeiter" },
  { value: "extern", label: "Extern" },
];

/** Leer oder „albert“ = der Vorgang liegt bei Albert. */
export function beiAlbert(werDran: string | null | undefined): boolean {
  const w = (werDran ?? "").trim().toLowerCase();
  return w === "" || w === "albert";
}

/**
 * erledigt · ich (Albert ist dran) · nachhaken (jemand anderes ist dran, das
 * Nachhak-Datum ist erreicht) · wartet (jemand anderes ist dran, noch nicht fällig).
 */
export function vorgangStatus(
  v: { done?: number | boolean | null; wer_dran?: string | null; nachhaken_am?: string | null },
  today: string
): VorgangStatus {
  if (Number(v.done ?? 0) === 1 || v.done === true) return "erledigt";
  if (beiAlbert(v.wer_dran)) return "ich";
  const n = (v.nachhaken_am ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(n) && n <= today ? "nachhaken" : "wartet";
}

/** „wartet auf SD Worx“, „bei Claude“, „wartet auf Mitarbeiter“ – leer, wenn Albert dran ist. */
export function wartetText(werDran: string | null | undefined, wartetAuf: string | null | undefined): string {
  if (beiAlbert(werDran)) return "";
  const w = (werDran ?? "").trim().toLowerCase();
  const name = (wartetAuf ?? "").trim();
  if (w === "claude") return "bei Claude";
  if (name) return `wartet auf ${name}`;
  return w === "mitarbeiter" ? "wartet auf Mitarbeiter" : "wartet auf Rückmeldung";
}
