"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorNote, Icon, Input, PageHeader, Segmented, Select, TextArea } from "@/components/ui";

/**
 * Postfach: alle Mails aller verbundenen Konten (Archiv in der Datenbank,
 * automatisch per Cron abgerufen), Suche, Lesen, Antworten und Versand mit
 * Freigabe. Gesendet wird nur über den Senden-Button hier.
 */

type ListMail = {
  id: number;
  account: string;
  folder: string;
  from_addr: string;
  to_addr: string;
  subject: string;
  date: string;
  flags: string;
  attachments: number;
  preview: string;
};
type FullMail = ListMail & {
  cc_addr: string;
  reply_to: string;
  body_text: string;
  html: string;
  message_id: string;
  attachments: { part: string; filename: string; mime: string; size: number }[];
};
type Draft = {
  id: number;
  account_id: number;
  account: string | null;
  from_addr: string | null;
  to_addr: string;
  cc_addr: string;
  bcc_addr: string;
  subject: string;
  body_text: string;
  reply_mail_id: number | null;
  forward_mail_id: number | null;
  source: string;
  note: string;
  status: string;
  error: string;
  updated_at: string;
  files: { id: number; filename: string }[];
  forward_files: string[];
};
type Account = { id: number; label: string; address: string; active: number; has_password: boolean };

type View = "inbox" | "sent" | "drafts";
const POLL_MS = 60_000;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Server-Fehler ${res.status}`);
  return data as T;
}

function fmtDate(iso: string, long = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (!long && d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("de-DE", long
    ? { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: d.getFullYear() === today.getFullYear() ? undefined : "2-digit" });
}

function senderName(from: string): string {
  const m = from.match(/^"?([^"<]+?)"?\s*</);
  return (m ? m[1] : from).trim() || from;
}

function quote(mail: FullMail): string {
  const lines = (mail.body_text || "").split("\n").slice(0, 60);
  return `\n\n\nAm ${fmtDate(mail.date, true)} schrieb ${senderName(mail.from_addr)}:\n${lines.map((l) => "> " + l).join("\n")}`;
}

/** HTML-Ansicht ohne Skripte und ohne externe Bilder (kein Tracking). */
function safeSrcDoc(html: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;
  const style = `<style>body{background:#fff;color:#111;font:14px -apple-system,BlinkMacSystemFont,sans-serif;margin:16px;word-wrap:break-word}img{max-width:100%;height:auto}</style>`;
  return `<!doctype html><html><head><meta charset="utf-8">${csp}${style}<base target="_blank"></head><body>${html}</body></html>`;
}

export default function PostfachPage() {
  const [view, setView] = useState<View>("inbox");
  // Direktlink von der Startseite: /postfach?ansicht=entwuerfe
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- einmalig aus der URL, erst nach dem Hydrieren verfügbar
    if (new URLSearchParams(window.location.search).get("ansicht") === "entwuerfe") setView("drafts");
  }, []);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [account, setAccount] = useState("");
  const [mails, setMails] = useState<ListMail[]>([]);
  const [konten, setKonten] = useState<{ account: string; n: number }[]>([]);
  const [zuletzt, setZuletzt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false); // nur „Ältere laden“
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<FullMail | null>(null);
  const [showHtml, setShowHtml] = useState(false);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  // Direktlink /postfach?ansicht=entwuerfe&entwurf=ID (z. B. „Als E-Mail weiterleiten“ aus der Briefpost) öffnet den Entwurf
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (openedFromUrl.current || drafts.length === 0) return;
    const id = Number(new URLSearchParams(window.location.search).get("entwurf"));
    const hit = id ? drafts.find((d) => Number(d.id) === id) : undefined;
    if (hit) {
      openedFromUrl.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- einmalig aus der URL, sobald die Entwürfe geladen sind
      setEditing(hit);
    }
  }, [drafts]);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const listUrl = useCallback(
    (before?: string) => {
      const p = new URLSearchParams({ folder: view === "sent" ? "sent" : "inbox", limit: "50" });
      if (qDebounced) {
        p.delete("folder"); // Suche über alle Ordner
        p.set("q", qDebounced);
      }
      if (account) p.set("account", account);
      if (before) p.set("before", before);
      return `/api/mail/messages?${p}`;
    },
    [view, qDebounced, account]
  );

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  // Liste laden und automatisch aktualisieren, solange die Seite sichtbar ist
  // (der eigentliche Abruf aus den Postfächern läuft serverseitig per Cron)
  useEffect(() => {
    if (view === "drafts") return;
    let cancelled = false;
    const run = () =>
      api<{ mails: ListMail[]; konten: { account: string; n: number }[]; zuletzt: string | null }>(listUrl())
        .then((data) => {
          if (cancelled) return;
          setMails((prev) => {
            if (prev.length <= 50) return data.mails;
            const ids = new Set(data.mails.map((m) => m.id));
            return [...data.mails, ...prev.filter((m) => !ids.has(m.id))];
          });
          setKonten(data.konten);
          setZuletzt(data.zuletzt);
          setMore((m) => m || data.mails.length === 50);
          setError("");
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    run();
    const tick = () => {
      if (document.visibilityState === "visible") run();
    };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [listUrl, view, reloadKey]);

  // Filter/Suche gewechselt → Liste neu, nicht anhängen
  useEffect(() => {
    return () => {
      setMails([]);
      setMore(false);
    };
  }, [listUrl]);

  const loadMore = async () => {
    const last = mails[mails.length - 1];
    if (!last || loading) return;
    setLoading(true);
    try {
      const data = await api<{ mails: ListMail[] }>(listUrl(last.date));
      setMails((m) => [...m, ...data.mails]);
      setMore(data.mails.length === 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      api<Draft[]>("/api/mail/drafts")
        .then((d) => !cancelled && setDrafts(d))
        .catch(() => {});
    run();
    api<Account[]>("/api/mail/accounts")
      .then((a) => !cancelled && setAccounts(a))
      .catch(() => {});
    const t = setInterval(() => document.visibilityState === "visible" && run(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [reloadKey]);

  const open = async (id: number) => {
    try {
      setShowHtml(false);
      setSelected(await api<FullMail>(`/api/mail/message?id=${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reply = async (mail: FullMail) => {
    try {
      const res = await api<{ id: number; drafts: Draft[] }>("/api/mail/drafts", {
        method: "POST",
        body: JSON.stringify({ reply_mail_id: mail.id, body: quote(mail) }),
      });
      setDrafts(res.drafts);
      setEditing(res.drafts.find((d) => d.id === res.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const forward = async (mail: FullMail) => {
    try {
      const res = await api<{ id: number; drafts: Draft[] }>("/api/mail/drafts", {
        method: "POST",
        body: JSON.stringify({ forward_mail_id: mail.id, body: "" }),
      });
      setDrafts(res.drafts);
      setEditing(res.drafts.find((d) => d.id === res.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const compose = async () => {
    const acc = accounts.find((a) => a.active && a.has_password);
    if (!acc) {
      setError("Kein Postfach mit Zugangsdaten – bitte im Mail-Modul unter „Postfächer“ verbinden.");
      return;
    }
    try {
      const res = await api<{ id: number; drafts: Draft[] }>("/api/mail/drafts", {
        method: "POST",
        body: JSON.stringify({ account_id: acc.id, to: "", subject: "", body: "" }),
      });
      setDrafts(res.drafts);
      setEditing(res.drafts.find((d) => d.id === res.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openDrafts = drafts.filter((d) => ["entwurf", "fehler", "sendet"].includes(d.status));

  return (
    <div>
      <PageHeader
        title="Postfach"
        subtitle={
          zuletzt
            ? `Alle Konten · automatisch aktualisiert, zuletzt ${fmtDate(zuletzt, true)}`
            : "Alle Konten · wird automatisch abgerufen"
        }
        action={
          <Button onClick={compose} className="shrink-0 whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="edit" size={16} />
              Neue Mail
            </span>
          </Button>
        }
      />

      <ErrorNote error={error} />

      {editing && (
        <Composer
          draft={editing}
          accounts={accounts}
          onClose={() => setEditing(null)}
          onChanged={(list, keepOpen) => {
            setDrafts(list);
            if (!keepOpen) setEditing(null);
            reload();
          }}
        />
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Segmented<View>
          className="flex w-full sm:w-auto"
          value={view}
          onChange={(v) => {
            setView(v);
            setSelected(null);
          }}
          options={[
            { value: "inbox", label: "Posteingang" },
            { value: "sent", label: "Gesendet" },
            { value: "drafts", label: openDrafts.length ? `Entwürfe (${openDrafts.length})` : "Entwürfe" },
          ]}
        />
        {view !== "drafts" && (
          <div className="flex gap-2 flex-1">
            <div className="relative flex-1">
              <Icon name="search" size={17} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <Input
                className="!pl-8"
                placeholder="Suchen in allen Mails: Absender, Betreff, Text …"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {konten.length > 1 && (
              <Select value={account} onChange={(e) => setAccount(e.target.value)} className="max-w-[40%]">
                <option value="">Alle Konten</option>
                {konten.map((k) => (
                  <option key={k.account} value={k.account}>
                    {k.account}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}
      </div>

      {view === "drafts" ? (
        <DraftList drafts={drafts} onOpen={setEditing} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-5 items-start">
          <Card className={`overflow-hidden ${selected ? "hidden lg:block" : ""}`}>
            {mails.length === 0 && !loading && (
              <EmptyState
                text={
                  qDebounced
                    ? "Keine Treffer."
                    : konten.length === 0
                      ? "Noch keine Mails im Archiv – der erste Abruf läuft automatisch, sobald Postfächer verbunden sind."
                      : "Keine Mails in diesem Ordner."
                }
              />
            )}
            {mails.map((m) => {
              const unread = !/\\Seen/.test(m.flags);
              const active = selected?.id === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => open(m.id)}
                  className={`w-full text-left flex gap-3 px-4 py-3 border-t border-line first:border-t-0 transition-colors ${
                    active ? "bg-accent-soft" : "hover:bg-inset"
                  }`}
                >
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${unread ? "bg-accent" : "bg-transparent"}`} />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className={`flex-1 min-w-0 truncate text-[13px] ${unread ? "font-semibold" : "text-ink-2"}`}>
                        {view === "sent" ? `An: ${senderName(m.to_addr)}` : senderName(m.from_addr)}
                      </span>
                      <span className="text-[11px] text-ink-3 shrink-0">{fmtDate(m.date)}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="flex-1 min-w-0 truncate text-[13px]">{m.subject}</span>
                      {m.attachments > 0 && <Icon name="attach_file" size={14} className="text-ink-3" />}
                      {/\\Answered/.test(m.flags) && <Icon name="reply" size={14} className="text-ink-3" />}
                    </span>
                    <span className="block truncate text-[12px] text-ink-3 mt-0.5">
                      {(account ? "" : m.account + " · ") + m.preview}
                    </span>
                  </span>
                </button>
              );
            })}
            {more && mails.length > 0 && (
              <div className="p-3 border-t border-line text-center">
                <Button variant="ghost" onClick={loadMore} disabled={loading}>
                  {loading ? "Lade …" : "Ältere laden"}
                </Button>
              </div>
            )}
          </Card>

          {selected ? (
            <Card className="min-w-0">
              <div className="px-5 pt-4 pb-3 border-b border-line">
                <button
                  onClick={() => setSelected(null)}
                  className="lg:hidden inline-flex items-center gap-1 text-[13px] text-accent mb-3"
                >
                  <Icon name="arrow_back" size={17} />
                  Zurück
                </button>
                <h2 className="text-[17px] font-semibold tracking-tight break-words">{selected.subject}</h2>
                <div className="mt-2 text-[12px] text-ink-2 space-y-0.5 [overflow-wrap:anywhere]">
                  <div>
                    <span className="text-ink-3">Von </span>
                    {selected.from_addr}
                  </div>
                  <div>
                    <span className="text-ink-3">An </span>
                    {selected.to_addr}
                  </div>
                  {selected.cc_addr && (
                    <div>
                      <span className="text-ink-3">Cc </span>
                      {selected.cc_addr}
                    </div>
                  )}
                  <div className="text-ink-3">
                    {fmtDate(selected.date, true)} · {selected.account} · {selected.folder}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button onClick={() => reply(selected)}>
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="reply" size={16} />
                      Antworten
                    </span>
                  </Button>
                  <Button variant="ghost" onClick={() => forward(selected)}>
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="forward" size={16} />
                      Weiterleiten
                    </span>
                  </Button>
                  {selected.html && (
                    <Button variant="ghost" onClick={() => setShowHtml((v) => !v)}>
                      {showHtml ? "Textansicht" : "Originalansicht"}
                    </Button>
                  )}
                </div>
              </div>
              {selected.attachments.length > 0 && (
                <div className="px-5 py-3 border-b border-line flex flex-wrap gap-1.5">
                  {selected.attachments.map((a) => (
                    <a
                      key={a.part}
                      href={`/api/mail/attachment?id=${selected.id}&part=${encodeURIComponent(a.part)}&inline=1`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-inset border border-line text-[12px] text-ink-2 hover:border-accent/40 hover:text-accent transition-all max-w-full"
                    >
                      <Icon name={a.mime === "application/pdf" ? "picture_as_pdf" : "attach_file"} size={14} />
                      <span className="truncate">{a.filename}</span>
                      <span className="text-ink-3">{Math.max(1, Math.round(a.size / 1024))} KB</span>
                    </a>
                  ))}
                </div>
              )}
              {showHtml && selected.html ? (
                <iframe
                  title="Originalansicht"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={safeSrcDoc(selected.html)}
                  className="w-full h-[70dvh] rounded-b-card bg-white"
                />
              ) : (
                <div className="px-5 py-4 text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {selected.body_text || <span className="text-ink-3">(kein Text)</span>}
                </div>
              )}
            </Card>
          ) : (
            <Card className="hidden lg:block">
              <EmptyState text="Mail auswählen, um sie zu lesen." />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function statusBadge(status: string) {
  if (status === "entwurf") return <Badge>Entwurf</Badge>;
  if (status === "sendet") return <Badge tone="warn">wird gesendet</Badge>;
  if (status === "gesendet") return <Badge tone="good">gesendet</Badge>;
  if (status === "fehler") return <Badge tone="bad">Fehler</Badge>;
  return <Badge>{status}</Badge>;
}

function DraftList({ drafts, onOpen }: { drafts: Draft[]; onOpen: (d: Draft) => void }) {
  return (
    <Card>
      {drafts.length === 0 && <EmptyState text="Keine offenen Entwürfe." />}
      {drafts.map((d) => (
        <button
          key={d.id}
          onClick={() => onOpen(d)}
          className="w-full text-left flex items-start gap-3 px-5 py-3 border-t border-line first:border-t-0 hover:bg-inset transition-colors"
        >
          <Icon name={d.source === "claude" ? "auto_awesome" : "edit_note"} size={18} className="text-ink-3 mt-0.5" />
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate text-[13px] font-semibold">{d.subject || "(ohne Betreff)"}</span>
              {d.source === "claude" && <Badge tone="accent">von Claude</Badge>}
              {statusBadge(d.status)}
            </span>
            <span className="block truncate text-[12px] text-ink-2 mt-0.5">
              An: {d.to_addr || "–"} · von {d.from_addr || d.account || "?"}
            </span>
            {d.note && <span className="block text-[12px] text-ink-3 mt-0.5 break-words">{d.note}</span>}
            {d.error && <span className="block text-[12px] text-bad mt-0.5 break-words">{d.error}</span>}
          </span>
        </button>
      ))}
    </Card>
  );
}

function Composer({
  draft,
  accounts,
  onClose,
  onChanged,
}: {
  draft: Draft;
  accounts: Account[];
  onClose: () => void;
  onChanged: (drafts: Draft[], keepOpen?: boolean) => void;
}) {
  const [accountId, setAccountId] = useState(draft.account_id);
  const [to, setTo] = useState(draft.to_addr);
  const [cc, setCc] = useState(draft.cc_addr);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body_text);
  const [showCc, setShowCc] = useState(Boolean(draft.cc_addr));
  const [busy, setBusy] = useState<"" | "save" | "send">("");
  const [error, setError] = useState(draft.status === "fehler" ? draft.error : "");
  const [sent, setSent] = useState("");
  const readOnly = !["entwurf", "fehler"].includes(draft.status);

  const usable = useMemo(() => accounts.filter((a) => a.has_password), [accounts]);
  const dirty =
    accountId !== draft.account_id || to !== draft.to_addr || cc !== draft.cc_addr || subject !== draft.subject || body !== draft.body_text;

  const save = async (): Promise<Draft[]> => {
    const res = await api<{ drafts: Draft[] }>("/api/mail/drafts", {
      method: "PATCH",
      body: JSON.stringify({ id: draft.id, account_id: accountId, to, cc, subject, body }),
    });
    return res.drafts;
  };

  const run = async (kind: "save" | "send" | "discard") => {
    if (busy) return;
    setError("");
    setBusy(kind === "discard" ? "save" : kind);
    try {
      if (kind === "discard") {
        const res = await api<{ drafts: Draft[] }>("/api/mail/drafts", {
          method: "PATCH",
          body: JSON.stringify({ id: draft.id, discard: true }),
        });
        onChanged(res.drafts);
        return;
      }
      let list = dirty || kind === "save" ? await save() : null;
      if (kind === "save") {
        onChanged(list!);
        return;
      }
      const res = await fetch("/api/mail/drafts/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: draft.id }),
      });
      const data = await res.json().catch(() => null);
      list = await api<Draft[]>("/api/mail/drafts?status=alle");
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Server-Fehler ${res.status}`);
        onChanged(list.filter((d) => ["entwurf", "fehler", "sendet"].includes(d.status)), true);
        return;
      }
      setSent(data.hinweis ? `Gesendet. ${data.hinweis}` : "Gesendet.");
      onChanged(list.filter((d) => ["entwurf", "fehler", "sendet"].includes(d.status)), true);
      setTimeout(onClose, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full sm:max-w-[680px] max-h-[92dvh] overflow-y-auto bg-ground border border-line rounded-t-card sm:rounded-card shadow-card pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
            {draft.forward_mail_id ? "Weiterleitung" : draft.reply_mail_id ? "Antwort" : "Neue Mail"}
            {draft.source === "claude" && <Badge tone="accent">von Claude</Badge>}
            {statusBadge(draft.status)}
          </h2>
          <button onClick={onClose} aria-label="Schließen" className="text-ink-3 hover:text-ink p-1">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="px-5 pb-4 space-y-2.5">
          {draft.note && <p className="text-[12px] text-ink-2 bg-inset rounded-[10px] px-3 py-2">{draft.note}</p>}
          <label className="flex items-center gap-2">
            <span className="w-14 text-[12px] text-ink-3 shrink-0">Von</span>
            <Select
              value={accountId}
              disabled={readOnly}
              onChange={(e) => setAccountId(Number(e.target.value))}
              className="flex-1 min-w-0"
            >
              {usable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.address || a.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-14 text-[12px] text-ink-3 shrink-0">An</span>
            <Input value={to} readOnly={readOnly} onChange={(e) => setTo(e.target.value)} placeholder="name@firma.de, …" />
            {!showCc && !readOnly && (
              <button onClick={() => setShowCc(true)} className="text-[12px] text-accent shrink-0 px-1">
                Cc
              </button>
            )}
          </label>
          {showCc && (
            <label className="flex items-center gap-2">
              <span className="w-14 text-[12px] text-ink-3 shrink-0">Cc</span>
              <Input value={cc} readOnly={readOnly} onChange={(e) => setCc(e.target.value)} />
            </label>
          )}
          <label className="flex items-center gap-2">
            <span className="w-14 text-[12px] text-ink-3 shrink-0">Betreff</span>
            <Input value={subject} readOnly={readOnly} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <TextArea
            value={body}
            readOnly={readOnly}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="leading-relaxed min-h-[40dvh]"
          />
          {draft.files.length + (draft.forward_files?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {draft.files.map((f) => (
                <Badge key={f.id}>
                  <Icon name="attach_file" size={13} className="mr-1" />
                  {f.filename}
                </Badge>
              ))}
              {(draft.forward_files ?? []).map((f, i) => (
                <Badge key={`fwd-${i}`}>
                  <Icon name="forward" size={13} className="mr-1" />
                  {f}
                </Badge>
              ))}
            </div>
          )}
          {error && <p className="text-[12px] text-bad break-words">{error}</p>}
          {sent && <p className="text-[12px] text-accent break-words">{sent}</p>}
          {!readOnly && !sent && (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => run("discard")}
                disabled={Boolean(busy)}
                className="text-[13px] text-ink-3 hover:text-bad transition-colors px-1 disabled:opacity-40"
              >
                Verwerfen
              </button>
              <div className="flex-1" />
              <Button variant="ghost" onClick={() => run("save")} disabled={Boolean(busy)}>
                {busy === "save" ? "Speichere …" : "Speichern"}
              </Button>
              <Button onClick={() => run("send")} disabled={Boolean(busy) || !to.trim() || !subject.trim()} className="!h-9 !px-5">
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="send" size={16} />
                  {busy === "send" ? "Sende …" : "Senden"}
                </span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
