import type { BerichtDaten, BriefNeu } from "@/lib/tagesbericht";
import type { CodriverFrist } from "@/lib/codriver-faelligkeiten";
import type { Frist } from "@/lib/home-data";

/**
 * HTML-Fassung des Tagesberichts. Mail-tauglich: Tabellen-Layout, Styles
 * inline (Gmail/Outlook ignorieren <style> teilweise), feste Farben im
 * Arion-OS-Look (dunkel, Supabase-Grün) – siehe .claude/skills/taste.
 * Reine Funktion, testbar (tests/tagesbericht.test.mjs).
 */

export const APP_URL = "https://arion-os.vercel.app/";
const SDWORX_URL = "https://sdworxgroup.my.site.com/swcustomer/s/mycases";
const FENSTER_TAGE = 7;

export const deDatum = (isoTag: string) => {
  const [y, m, d] = isoTag.split("-");
  return `${d}.${m}.${y}`;
};
export const kurzDatum = (isoTag: string) => deDatum(isoTag).slice(0, 6);

/** „überfällig seit 3 Tagen“, „heute“, „morgen“, „in 4 Tagen“ */
export function wannText(tage: number): string {
  if (tage < 0) return `überfällig seit ${-tage} ${tage === -1 ? "Tag" : "Tagen"}`;
  if (tage === 0) return "heute";
  if (tage === 1) return "morgen";
  return `in ${tage} Tagen`;
}

/* ── Farben (fest, weil Mail-Programme keine CSS-Variablen kennen) ── */
const C = {
  ground: "#0c0d0e",
  card: "#151718",
  inset: "#1d2021",
  line: "#2a2d2f",
  ink: "#ededed",
  ink2: "#a0a0a0",
  ink3: "#6b6f73",
  accent: "#3ecf8e",
  accentSoft: "#12301f",
  onAccent: "#05130c",
  warn: "#f5a623",
  warnSoft: "#33270f",
  bad: "#f2545b",
  badSoft: "#3a1719",
};
const FONT = `-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* ── Bausteine ─────────────────────────────────────────── */

function pill(text: string, ton: "bad" | "warn" | "good" | "neutral"): string {
  const [bg, fg] =
    ton === "bad" ? [C.badSoft, C.bad] : ton === "warn" ? [C.warnSoft, C.warn] : ton === "good" ? [C.accentSoft, C.accent] : [C.inset, C.ink2];
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${bg};color:${fg};font-size:12px;line-height:16px;font-weight:600;white-space:nowrap;">${esc(text)}</span>`;
}

function tonFuer(tage: number): "bad" | "warn" | "neutral" {
  if (tage < 0) return "bad";
  if (tage <= 2) return "warn";
  return "neutral";
}

/** Abschnittsüberschrift mit Zähler */
function kopf(titel: string, anzahl?: number, hinweis = ""): string {
  const zahl = anzahl === undefined ? "" : `<span style="color:${C.ink3};font-weight:500;">&nbsp;·&nbsp;${anzahl}</span>`;
  const sub = hinweis ? `<div style="font-size:12px;line-height:17px;color:${C.ink3};margin-top:2px;">${esc(hinweis)}</div>` : "";
  return `<tr><td style="padding:28px 4px 10px 4px;">
<div style="font-size:12px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:${C.ink2};">${esc(titel)}${zahl}</div>${sub}
</td></tr>`;
}

/** Eine Karte; Karten stehen mit 10 px Abstand untereinander */
function karte(inhalt: string, akzent = ""): string {
  const rand = akzent ? `border-left:3px solid ${akzent};` : "";
  return `<tr><td style="padding:0 0 10px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background:${C.card};border:1px solid ${C.line};${rand}border-radius:14px;">
<tr><td style="padding:14px 16px;">${inhalt}</td></tr></table>
</td></tr>`;
}

function leer(text: string): string {
  return karte(`<div style="font-size:14px;line-height:20px;color:${C.ink3};">${esc(text)}</div>`);
}

const titelZeile = (t: string, href = "") => {
  const inner = esc(t);
  return `<div style="font-size:15px;line-height:21px;font-weight:600;color:${C.ink};">${
    href ? `<a href="${esc(href)}" style="color:${C.ink};text-decoration:none;">${inner}</a>` : inner
  }</div>`;
};
const meta = (t: string) => (t ? `<div style="font-size:13px;line-height:19px;color:${C.ink2};margin-top:4px;">${esc(t)}</div>` : "");

const ART: Record<Frist["art"], string> = { aufgabe: "Aufgabe", buchhaltung: "Buchhaltung", vertrag: "Vertrag", termin: "Termin" };

function fristKarte(f: { titel: string; datum: string; tage: number }, unter: string, href = ""): string {
  const ton = tonFuer(f.tage);
  const randFarbe = ton === "bad" ? C.bad : ton === "warn" ? C.warn : "";
  const datum = `<span style="color:${C.ink3};font-size:12px;">&nbsp;&nbsp;${esc(deDatum(f.datum))}</span>`;
  return karte(`${pill(wannText(f.tage), ton)}${datum}<div style="height:8px;line-height:8px;">&nbsp;</div>${titelZeile(f.titel, href)}${meta(unter)}`, randFarbe);
}

function briefKarte(b: BriefNeu): string {
  const kopfzeile = [b.firma ? pill(b.firma, "neutral") : "", b.frist ? pill(`Frist ${kurzDatum(b.frist)}`, "warn") : ""].filter(Boolean).join("&nbsp;");
  const absender = `<div style="font-size:12px;line-height:17px;color:${C.ink3};margin-top:${kopfzeile ? "8px" : "0"};">${esc(b.absender)}</div>`;
  const kurz = b.kurz ? `<div style="font-size:13px;line-height:19px;color:${C.ink2};margin-top:6px;">${esc(b.kurz)}</div>` : "";
  const todo = b.aufgabe
    ? `<div style="font-size:13px;line-height:19px;color:${C.ink};margin-top:8px;padding:8px 10px;background:${C.inset};border-radius:10px;"><span style="color:${C.accent};font-weight:600;">To-do&nbsp;→&nbsp;</span>${esc(b.aufgabe)}</div>`
    : "";
  return karte(`${kopfzeile}${absender}<div style="margin-top:2px;">${titelZeile(b.betreff || "Ohne Betreff", `${APP_URL}post`)}</div>${kurz}${todo}`);
}

function zahlKachel(zahl: number, label: string, ton: "bad" | "warn" | "neutral" | "good"): string {
  const farbe = zahl === 0 ? C.ink3 : ton === "bad" ? C.bad : ton === "warn" ? C.warn : C.ink;
  return `<td width="25%" valign="top" style="padding:0 4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background:${C.card};border:1px solid ${C.line};border-radius:14px;">
<tr><td style="padding:12px 8px;text-align:center;">
<div style="font-size:24px;line-height:28px;font-weight:700;color:${farbe};">${zahl}</div>
<div style="font-size:11px;line-height:15px;color:${C.ink2};margin-top:2px;">${esc(label)}</div>
</td></tr></table></td>`;
}

function knopf(text: string, href: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;padding:11px 22px;border-radius:999px;background:${C.accent};color:${C.onAccent};font-size:14px;font-weight:700;text-decoration:none;">${esc(text)}</a>`;
}

/* ── Bericht ───────────────────────────────────────────── */

export function berichtHtml(b: BerichtDaten, betreff = ""): string {
  const ueber = b.fristen.filter((f) => f.tage < 0);
  const bald = b.fristen.filter((f) => f.tage >= 0);
  const briefe = b.briefe ?? [];
  const cd = b.codriver;
  const sd = b.sdworx;
  const sdN = sd.posts.length + sd.direkt.length;
  const zeilen: string[] = [];

  // Kopf
  zeilen.push(`<tr><td style="padding:8px 4px 0 4px;">
<div style="font-size:12px;line-height:16px;letter-spacing:.12em;font-weight:700;color:${C.accent};">ARION OS · TAGESBERICHT</div>
<div style="font-size:26px;line-height:32px;font-weight:700;color:${C.ink};margin-top:6px;">Guten Morgen, Albert</div>
<div style="font-size:14px;line-height:20px;color:${C.ink2};margin-top:4px;">${esc(b.wochentag)}, ${esc(deDatum(b.tag))}</div>
</td></tr>`);

  // Kennzahlen
  zeilen.push(`<tr><td style="padding:20px 0 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${zahlKachel(ueber.length, "überfällig", "bad")}
${zahlKachel(bald.length, "diese Woche", "warn")}
${zahlKachel(briefe.length, "neue Briefe", "neutral")}
${zahlKachel(sdN, "SD Worx neu", "neutral")}
</tr></table></td></tr>`);

  // Fristen
  if (ueber.length) {
    zeilen.push(kopf("Überfällig", ueber.length));
    for (const f of ueber) zeilen.push(fristKarte(f, ART[f.art] ?? "", `${APP_URL.replace(/\/$/, "")}${f.href}`));
  }
  zeilen.push(kopf(`Fristen – nächste ${FENSTER_TAGE} Tage`, bald.length));
  if (!bald.length) zeilen.push(leer(`In den nächsten ${FENSTER_TAGE} Tagen läuft nichts ab.`));
  for (const f of bald) zeilen.push(fristKarte(f, ART[f.art] ?? "", `${APP_URL.replace(/\/$/, "")}${f.href}`));

  // Briefe
  zeilen.push(kopf("Neue Briefe", briefe.length, "Aus dem Scanner (scan@) und dem Briefkasten, seit dem letzten Bericht"));
  if (!briefe.length) zeilen.push(leer("Keine neuen Briefe."));
  for (const br of briefe) zeilen.push(briefKarte(br));

  // Codriver
  if (cd) {
    const cdFahrzeug = cd.fristen.filter((f) => f.bereich === "fahrzeug");
    const cdFahrer = cd.fristen.filter((f) => f.bereich === "fahrer");
    zeilen.push(kopf("Codriver – Fälligkeiten", cd.verbunden ? cd.fristen.length : undefined, "TÜV/HU, Zulassung, Miet-/Leasingende, Verträge, Führerscheine, Ausweise – nächste 30 Tage"));
    if (!cd.verbunden) {
      zeilen.push(
        karte(
          `<div style="font-size:14px;line-height:20px;color:${C.ink2};">Codriver ist noch nicht mit Arion OS verbunden. Sobald das Disponenten-Konto „Arion OS“ in Vercel hinterlegt ist (CODRIVER_EMAIL / CODRIVER_PASSWORD), stehen hier TÜV-Termine, Vertragsenden und ablaufende Dokumente.</div>`,
          C.warn
        )
      );
    } else if (!cd.fristen.length) {
      zeilen.push(leer("In den nächsten 30 Tagen läuft in Codriver nichts ab."));
    } else {
      const gruppe = (titel: string, liste: CodriverFrist[]) => {
        if (!liste.length) return;
        zeilen.push(`<tr><td style="padding:6px 4px 8px 4px;font-size:13px;line-height:18px;font-weight:600;color:${C.ink3};">${esc(titel)}</td></tr>`);
        for (const f of liste) zeilen.push(fristKarte(f, f.detail));
      };
      gruppe("Fahrzeuge", cdFahrzeug);
      gruppe("Fahrer", cdFahrer);
    }
  }

  // SD Worx
  zeilen.push(kopf("SD Worx – neu seit dem letzten Bericht", sdN));
  if (!sdN) zeilen.push(leer("Keine neuen Nachrichten im Kundenportal."));
  for (const p of sd.posts) {
    const status = p.geloest ? pill("gelöst", "good") : p.erwaehnt ? pill("du wurdest erwähnt", "warn") : pill("neuer Post", "neutral");
    const fallTitel = b.fallTitel[p.fall] || "";
    const kopfzeile = `${status}<span style="color:${C.ink3};font-size:12px;">&nbsp;&nbsp;Fall <a href="${SDWORX_URL}" style="color:${C.ink3};">${esc(p.fall)}</a> · ${esc(p.von)}</span>`;
    const zitat = p.text
      ? `<div style="font-size:13px;line-height:19px;color:${C.ink2};margin-top:8px;padding-left:10px;border-left:2px solid ${C.line};">${esc(p.text)}</div>`
      : "";
    zeilen.push(karte(`${kopfzeile}<div style="height:8px;line-height:8px;">&nbsp;</div>${titelZeile(fallTitel || `Kundenvorgang ${p.fall}`)}${zitat}`));
  }
  for (const m of sd.direkt) zeilen.push(karte(`${pill("Mail", "neutral")}<div style="height:8px;line-height:8px;">&nbsp;</div>${titelZeile(m.betreff)}${meta(`von ${m.von}`)}`));
  if (sd.buddy.length) {
    const liste = sd.buddy
      .map(
        (x) =>
          `<tr><td style="padding:4px 0;font-size:14px;line-height:20px;color:${C.ink};width:44px;font-weight:700;">${x.anzahl}</td><td style="padding:4px 0;font-size:14px;line-height:20px;color:${C.ink2};">${esc(x.text)}</td></tr>`
      )
      .join("");
    zeilen.push(
      karte(
        `<div style="font-size:13px;line-height:18px;font-weight:600;color:${C.ink3};margin-bottom:6px;">Buddy-Aufgabenzentrum offen</div><table role="presentation" cellpadding="0" cellspacing="0" border="0">${liste}</table>`
      )
    );
  }

  // Wartet auf dich
  if (b.entwuerfe > 0) {
    zeilen.push(kopf("Wartet auf dich"));
    zeilen.push(
      karte(
        `${titelZeile(`${b.entwuerfe} Mail-${b.entwuerfe === 1 ? "Entwurf" : "Entwürfe"} zum Prüfen und Senden`, `${APP_URL}postfach`)}${meta("In Arion OS freigeben – nichts geht ohne dich raus.")}`,
        C.accent
      )
    );
  }

  // Fuß
  zeilen.push(`<tr><td style="padding:26px 4px 6px 4px;text-align:center;">${knopf("Arion OS öffnen", APP_URL)}</td></tr>
<tr><td style="padding:14px 4px 0 4px;text-align:center;font-size:11px;line-height:16px;color:${C.ink3};">Automatisch erstellt von Arion OS · täglich um 9 Uhr</td></tr>`);

  const vorschau = esc(betreff.replace(/^Tagesbericht [\d.]+:\s*/, ""));
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${esc(betreff || "Tagesbericht")}</title></head>
<body style="margin:0;padding:0;background:${C.ground};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.ground};">${vorschau}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ground}" style="background:${C.ground};">
<tr><td align="center" style="padding:24px 12px 32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:${FONT};">
${zeilen.join("\n")}
</table></td></tr></table></body></html>`;
}
