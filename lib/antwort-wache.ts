import type { DB } from "@/lib/db";
import { pushConfigured, sendPushToAll } from "@/lib/push";
import { mailSenden } from "@/lib/tagesbericht";

/**
 * Antwort-Wächter (docs/ANTWORT-WACHE.md): Jede gesendete Mail an Externe kommt
 * auf die Liste „wartet auf Antwort“. Kommt eine Antwort, gibt es einen Push.
 * Nach ERINNERN_TAGE ohne Antwort einmal Push + Erinnerungsmail an Albert.
 *
 * Status: wartet → beantwortet | erinnert → beantwortet | erledigt (von Hand)
 *         | ersetzt (neuere Mail im selben Verlauf) | abgelaufen (nach 30 Tagen)
 *         | ignoriert (intern, no-reply, Mitarbeiter-Weiterleitung)
 */

export const ERINNERN_TAGE = 5;
export const BEOBACHTEN_TAGE = 30;
/** Beim ersten Lauf und danach: gesendete Mails der letzten Tage erfassen */
const ERFASSEN_TAGE = 8;
const DAY = 86_400_000;

/** Eigene Domains – Mails dorthin brauchen keine Überwachung. */
export const EIGENE_DOMAINS = ["arion-logistics.de", "fleet-fix.app", "wohnwerkbau.de", "albertdobra.de", "kw-agentur.de"];
const FREEMAIL = /@(gmail|googlemail|gmx|web|outlook|hotmail|live|yahoo|icloud|me|t-online|freenet|aol|proton|protonmail)\./i;
const NO_REPLY = /^(no-?reply|do-?not-?reply|noreply|mailer-daemon|postmaster|notifications?|bounce)/i;
const SENT_SQL = "(LOWER(folder) LIKE '%sent%' OR LOWER(folder) LIKE '%gesendet%')";

/* ── Reine Helfer (getestet in tests/antwort-wache.test.mjs) ── */

/** „AW: WG: Re: Betreff“ → „betreff“ */
export function normBetreff(s: string): string {
  let t = (s || "").trim();
  for (let i = 0; i < 6; i++) {
    const n = t.replace(/^\s*(re|aw|wg|fw|fwd|antw|antwort|sv|tr|vs)\s*(\[\d+\])?\s*:\s*/i, "");
    if (n === t) break;
    t = n;
  }
  return t.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Alle Mail-Adressen aus einem Header („Name <a@b.de>, c@d.de“), klein geschrieben. */
export function adressen(header: string): string[] {
  return [...(header || "").matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0]!.toLowerCase());
}

export const domain = (adresse: string) => adresse.split("@")[1] ?? "";

/** Abwesenheitsnotizen, Lesebestätigungen und Unzustellbar-Meldungen sind keine Antwort. */
export function istAutoAntwort(subject: string, from = ""): boolean {
  return (
    /(automatische antwort|automatic reply|auto-?reply|autoreply|abwesen|out of office|außer haus|ausser haus|nicht im büro|lesebestätigung|read receipt|unzustellbar|undeliverable|delivery status|mail delivery|zustellung fehlgeschlagen)/i.test(
      subject || ""
    ) || NO_REPLY.test((adressen(from)[0] ?? "").split("@")[0] ?? "")
  );
}

/** Soll diese gesendete Mail überwacht werden? */
export function beobachten(to: string, subject: string, eigene: string[] = []): { ja: boolean; an: string; grund: string } {
  const eigen = new Set(eigene.map((e) => e.toLowerCase()));
  const extern = adressen(to).filter((a) => !eigen.has(a) && !EIGENE_DOMAINS.includes(domain(a)));
  const an = extern.find((a) => !NO_REPLY.test(a.split("@")[0] ?? "")) ?? "";
  if (!extern.length) return { ja: false, an: "", grund: "intern" };
  if (!an) return { ja: false, an: extern[0]!, grund: "no-reply" };
  // Weiterleitungen an private Adressen sind meist Mitarbeiter-Infos ohne erwartete Antwort
  if (/^\s*(wg|fw|fwd)\s*:/i.test(subject || "") && FREEMAIL.test(an)) return { ja: false, an, grund: "weiterleitung" };
  return { ja: true, an, grund: "" };
}

export const tageSeit = (iso: string, now: Date) => Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);

/** Stunde in Berlin – Erinnerungen nur tagsüber (8–20 Uhr). */
export function berlinStunde(now: Date): number {
  const teil = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now)
    .find((p) => p.type === "hour");
  return Number(teil?.value ?? NaN);
}

const tt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
};

export type ErinnerungPosten = { an: string; betreff: string; gesendet: string; tage: number };

/** Text der Erinnerungsmail an Albert. */
export function erinnerungsMail(posten: ErinnerungPosten[]): { betreff: string; text: string } {
  const n = posten.length;
  const betreff = n === 1 ? `Keine Antwort seit ${posten[0]!.tage} Tagen: ${posten[0]!.an}` : `Keine Antwort seit ${ERINNERN_TAGE}+ Tagen: ${n} Mails`;
  const zeilen = posten.map((p) => `• An ${p.an} – „${p.betreff || "(ohne Betreff)"}“ – gesendet am ${tt(p.gesendet)} (${p.tage} Tage)`);
  const text = [
    "Hallo Albert,",
    "",
    n === 1 ? "auf diese Mail kam bisher keine Antwort:" : `auf diese ${n} Mails kam bisher keine Antwort:`,
    "",
    ...zeilen,
    "",
    "Nachhaken oder in Arion OS → Leitstand → „Wartet auf Antwort“ als erledigt markieren.",
    "",
    "Arion OS (automatisch)",
  ].join("\n");
  return { betreff, text };
}

/* ── Lauf (im Mail-Cron) ────────────────────────────────── */

type WacheRow = {
  id: number;
  message_id: string;
  thread_key: string;
  an: string;
  subject: string;
  gesendet_am: string;
  status: string;
};

export type WacheErgebnis = { erfasst: number; beantwortet: number; erinnert: number; mail?: string; fehler?: string };

export async function antwortWache(d: DB, now = new Date()): Promise<WacheErgebnis> {
  const res: WacheErgebnis = { erfasst: 0, beantwortet: 0, erinnert: 0 };
  const seit = new Date(now.getTime() - ERFASSEN_TAGE * DAY).toISOString();

  // 1) Gesendete Mails erfassen (Gesendet-Ordner aller Postfächer + Entwürfe aus Arion OS)
  const konten = await d.all<{ address: string; username: string }>("SELECT address, username FROM mail_accounts");
  const eigene = konten.flatMap((k) => [k.address, k.username]).filter(Boolean);
  const gesendet = await d.all<{ id: number | null; account: string; message_id: string; to_addr: string; subject: string; date: string }>(
    `SELECT id, account, message_id, to_addr, subject, date FROM mails
     WHERE ${SENT_SQL} AND date >= ? AND message_id IS NOT NULL AND message_id <> ''
     ORDER BY date ASC LIMIT 400`,
    [seit]
  );
  const entwuerfe = await d.all<{ account: string; message_id: string; to_addr: string; subject: string; date: string }>(
    `SELECT CAST(account_id AS TEXT) AS account, smtp_message_id AS message_id, to_addr, subject, sent_at AS date FROM mail_drafts
     WHERE status = 'gesendet' AND sent_at >= ? AND smtp_message_id <> '' AND COALESCE(source, '') NOT IN ('tagesbericht', 'antwort-wache')`,
    [seit]
  );
  const bekannt = new Set(
    (await d.all<{ message_id: string }>("SELECT message_id FROM antwort_wache WHERE gesendet_am >= ?", [seit])).map((r) => r.message_id)
  );
  for (const m of [...gesendet.map((g) => ({ ...g, mail_id: g.id })), ...entwuerfe.map((e) => ({ ...e, mail_id: null }))]) {
    if (!m.message_id || bekannt.has(m.message_id)) continue;
    bekannt.add(m.message_id);
    const b = beobachten(m.to_addr, m.subject, eigene);
    const datum = new Date(m.date).toISOString();
    await d.run(
      `INSERT INTO antwort_wache (mail_id, account, message_id, thread_key, an, subject, gesendet_am, status, grund)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (message_id) DO NOTHING`,
      [m.mail_id, m.account, m.message_id, `${b.an}|${normBetreff(m.subject)}`, b.an || adressen(m.to_addr)[0] || "", m.subject ?? "", datum, b.ja ? "wartet" : "ignoriert", b.grund]
    );
    if (b.ja) res.erfasst++;
  }

  // Ältere Mails im selben Verlauf (gleicher Empfänger + Betreff) werden von der neuesten ersetzt
  const offen = await d.all<WacheRow>(
    "SELECT id, message_id, thread_key, an, subject, gesendet_am, status FROM antwort_wache WHERE status IN ('wartet','erinnert') ORDER BY gesendet_am DESC"
  );
  const neueste = new Map<string, WacheRow>();
  for (const r of offen) {
    if (!neueste.has(r.thread_key)) neueste.set(r.thread_key, r);
    else await d.run("UPDATE antwort_wache SET status = 'ersetzt', updated_at = ? WHERE id = ?", [now.toISOString(), r.id]);
  }

  // 2) Antworten erkennen
  for (const r of neueste.values()) {
    if (tageSeit(r.gesendet_am, now) > BEOBACHTEN_TAGE) {
      await d.run("UPDATE antwort_wache SET status = 'abgelaufen', updated_at = ? WHERE thread_key = ? AND status IN ('wartet','erinnert','ersetzt')", [
        now.toISOString(),
        r.thread_key,
      ]);
      continue;
    }
    const mids = (await d.all<{ message_id: string }>("SELECT message_id FROM antwort_wache WHERE thread_key = ?", [r.thread_key])).map((x) => x.message_id);
    const antwort = await antwortFinden(d, r, mids, eigene);
    if (!antwort) continue;
    await d.run(
      `UPDATE antwort_wache SET status = 'beantwortet', antwort_mail_id = ?, antwort_von = ?, antwort_am = ?, updated_at = ?
       WHERE thread_key = ? AND status IN ('wartet','erinnert','ersetzt')`,
      [antwort.id, antwort.from_addr, new Date(antwort.date).toISOString(), now.toISOString(), r.thread_key]
    );
    res.beantwortet++;
    if (pushConfigured())
      await sendPushToAll({
        title: `Antwort von ${absenderName(antwort.from_addr)}`,
        body: antwort.subject || r.subject,
        url: "/postfach",
      }).catch(() => undefined);
  }

  // 3) Erinnern: einmal je Verlauf, nur tagsüber, alles in einer Mail
  const stunde = berlinStunde(now);
  if (stunde >= 8 && stunde < 20) {
    const faellig = [...neueste.values()].filter((r) => r.status === "wartet" && tageSeit(r.gesendet_am, now) >= ERINNERN_TAGE && tageSeit(r.gesendet_am, now) <= BEOBACHTEN_TAGE);
    // nicht schon beantwortet (in diesem Lauf)
    const nochOffen: WacheRow[] = [];
    for (const r of faellig) {
      const s = await d.get<{ status: string }>("SELECT status FROM antwort_wache WHERE id = ?", [r.id]);
      if (s?.status === "wartet") nochOffen.push(r);
    }
    if (nochOffen.length) {
      // Zuerst als erinnert markieren – so gibt es auch bei parallelen Läufen nur eine Mail
      const ids: number[] = [];
      for (const r of nochOffen) {
        const upd = await d.get<{ id: number }>(
          "UPDATE antwort_wache SET status = 'erinnert', erinnert_am = ?, updated_at = ? WHERE id = ? AND status = 'wartet' RETURNING id",
          [now.toISOString(), now.toISOString(), r.id]
        );
        if (upd) ids.push(Number(upd.id));
      }
      const posten = nochOffen
        .filter((r) => ids.includes(Number(r.id)))
        .map((r) => ({ an: r.an, betreff: r.subject, gesendet: r.gesendet_am, tage: tageSeit(r.gesendet_am, now) }));
      if (posten.length) {
        res.erinnert = posten.length;
        const m = erinnerungsMail(posten);
        if (pushConfigured())
          await sendPushToAll({ title: m.betreff, body: posten.map((p) => `${p.an}: ${p.betreff}`).join(" · ").slice(0, 180), url: "/leitstand" }).catch(
            () => undefined
          );
        res.mail = await mailSenden(d, m.betreff, m.text, undefined, "", { source: "antwort-wache", note: "Antwort-Wächter (automatisch)" }).catch((e) => (e instanceof Error ? e.message : String(e)));
      }
    }
  }
  return res;
}

async function antwortFinden(
  d: DB,
  r: WacheRow,
  mids: string[],
  eigene: string[]
): Promise<{ id: number; from_addr: string; subject: string; date: string } | null> {
  const eigen = new Set(eigene.map((e) => e.toLowerCase()));
  const ok = (m: { from_addr: string; subject: string }) => {
    const von = adressen(m.from_addr)[0] ?? "";
    return von && !eigen.has(von) && !EIGENE_DOMAINS.includes(domain(von)) && !istAutoAntwort(m.subject, m.from_addr);
  };
  // a) Header-Verknüpfung: In-Reply-To / References enthält eine unserer Message-IDs
  const bed = mids.map(() => "(in_reply_to = ? OR references_hdr LIKE ?)").join(" OR ");
  const params = mids.flatMap((m) => [m, `%${m}%`]);
  const perHeader = await d.all<{ id: number; from_addr: string; subject: string; date: string }>(
    `SELECT id, from_addr, subject, date FROM mails WHERE NOT ${SENT_SQL} AND date > ? AND (${bed}) ORDER BY date ASC LIMIT 10`,
    [r.gesendet_am, ...params]
  );
  const a = perHeader.find(ok);
  if (a) return a;
  // b) Rückfall: gleicher Betreff, Absender aus derselben Firma (bei Freemail: dieselbe Adresse)
  const betreff = normBetreff(r.subject);
  if (betreff.length < 6 || !r.an) return null;
  const von = FREEMAIL.test(r.an) ? `%${r.an}%` : `%@${domain(r.an)}%`;
  const perBetreff = await d.all<{ id: number; from_addr: string; subject: string; date: string }>(
    `SELECT id, from_addr, subject, date FROM mails WHERE NOT ${SENT_SQL} AND date > ? AND LOWER(from_addr) LIKE ? AND LOWER(subject) LIKE ? ORDER BY date ASC LIMIT 10`,
    [r.gesendet_am, von, `%${betreff.replace(/[%_]/g, "")}%`]
  );
  return perBetreff.find((m) => ok(m) && normBetreff(m.subject) === betreff) ?? null;
}

function absenderName(from: string): string {
  const name = from.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  return name || adressen(from)[0] || from;
}

/* ── Abfrage für Leitstand ──────────────────────────────── */

export type WacheListe = {
  wartet: { id: number; an: string; betreff: string; gesendet: string; tage: number; erinnert: boolean }[];
  beantwortet: { id: number; an: string; betreff: string; von: string; am: string }[];
};

export async function wacheListe(d: DB, now = new Date()): Promise<WacheListe> {
  const [offen, neu] = await Promise.all([
    d.all<{ id: number; an: string; subject: string; gesendet_am: string; status: string }>(
      "SELECT id, an, subject, gesendet_am, status FROM antwort_wache WHERE status IN ('wartet','erinnert') ORDER BY gesendet_am ASC LIMIT 100"
    ),
    d.all<{ id: number; an: string; subject: string; antwort_von: string; antwort_am: string }>(
      "SELECT id, an, subject, antwort_von, antwort_am FROM antwort_wache WHERE status = 'beantwortet' AND antwort_am >= ? ORDER BY antwort_am DESC LIMIT 20",
      [new Date(now.getTime() - 3 * DAY).toISOString()]
    ),
  ]);
  // je Verlauf nur ein Eintrag bei den Antworten
  const gesehen = new Set<string>();
  return {
    wartet: offen.map((r) => ({ id: Number(r.id), an: r.an, betreff: r.subject, gesendet: r.gesendet_am, tage: tageSeit(r.gesendet_am, now), erinnert: r.status === "erinnert" })),
    beantwortet: neu
      .filter((r) => {
        const k = `${r.an}|${normBetreff(r.subject)}`;
        if (gesehen.has(k)) return false;
        gesehen.add(k);
        return true;
      })
      .map((r) => ({ id: Number(r.id), an: r.an, betreff: r.subject, von: absenderName(r.antwort_von || ""), am: r.antwort_am })),
  };
}
