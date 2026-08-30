"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, PageHeader, Button, Input, Select, EmptyState, Row, Badge, Icon, ErrorNote } from "@/components/ui";
import { useTable } from "@/lib/client";

const PROVIDERS = [
  { key: "ionos", name: "IONOS", host: "imap.ionos.de" },
  { key: "gmx", name: "GMX", host: "imap.gmx.net" },
  { key: "custom", name: "Anderer Anbieter", host: "" },
] as const;

type FetchResult = {
  configured: boolean;
  accounts: { label: string; neu: number }[];
  neu: number;
  wichtig: number;
  notizen: number;
  hinweise: string[];
};

type SuggestResult = {
  configured: boolean;
  analysierte_mails: number;
  senders: { value: string; name: string; count: number; accounts: string[] }[];
  keywords: { value: string; count: number }[];
  hinweise: string[];
};

type Mail = {
  id: number;
  account: string;
  from_addr: string;
  subject: string;
  summary: string;
  matched_rule: string;
  important: number;
  read: number;
  received_at: string;
};
type Rule = { id: number; kind: string; value: string };
type Account = {
  id: number;
  label: string;
  address: string;
  active: number;
  host: string;
  port: number;
  has_password: boolean;
};

export default function MailPage() {
  const mails = useTable<Mail>("mail_digest");
  const rules = useTable<Rule>("mail_rules");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accError, setAccError] = useState("");
  const [ruleKind, setRuleKind] = useState("absender");
  const [ruleValue, setRuleValue] = useState("");
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [fetchError, setFetchError] = useState("");

  // Formular "Postfach verbinden"
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]["key"]>("ionos");
  const [accLabel, setAccLabel] = useState("");
  const [accUser, setAccUser] = useState("");
  const [accPass, setAccPass] = useState("");
  const [accHost, setAccHost] = useState("");
  const [accPort, setAccPort] = useState("993");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveHint, setSaveHint] = useState("");
  const [canForce, setCanForce] = useState(false);

  const loadAccounts = async () => {
    try {
      const res = await fetch("/api/mail/accounts", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Server-Fehler ${res.status}`);
      setAccounts(data as Account[]);
      setAccError("");
    } catch (e) {
      setAccError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    loadAccounts();
  }, []);

  const saveAccount = async (skipTest = false) => {
    const host = provider === "custom" ? accHost.trim() : PROVIDERS.find((p) => p.key === provider)!.host;
    const label = accLabel.trim() || PROVIDERS.find((p) => p.key === provider)!.name;
    if (!accUser.trim() || !accPass || !host || saving) return;
    setSaving(true);
    setSaveError("");
    setSaveHint("");
    try {
      const res = await fetch("/api/mail/accounts", {
        method: "POST",
        body: JSON.stringify({
          label,
          host,
          port: Number(accPort) || 993,
          username: accUser.trim(),
          password: accPass,
          skipTest,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCanForce(true);
        setSaveHint(data?.hint ?? "");
        throw new Error(data?.error ?? `Server-Fehler ${res.status}`);
      }
      setAccounts(data.accounts as Account[]);
      setAccLabel("");
      setAccUser("");
      setAccPass("");
      setAccHost("");
      setCanForce(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Postfach-Analyse: Regel-Vorschläge aus dem Gesendet-Ordner
  const [suggesting, setSuggesting] = useState(false);
  const [suggest, setSuggest] = useState<SuggestResult | null>(null);
  const [suggestError, setSuggestError] = useState("");

  const runSuggest = async () => {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestError("");
    try {
      const res = await fetch("/api/mail/suggest", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Server-Fehler ${res.status}`);
      setSuggest(data as SuggestResult);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  };

  const adoptSuggestion = (kind: "absender" | "stichwort", value: string) => {
    rules.create({ kind, value } as Partial<Rule>);
    setSuggest((s) =>
      s
        ? {
            ...s,
            senders: s.senders.filter((x) => x.value !== value),
            keywords: s.keywords.filter((x) => x.value !== value),
          }
        : s
    );
  };

  const toggleAccount = async (a: Account) => {
    const res = await fetch("/api/mail/accounts", {
      method: "PATCH",
      body: JSON.stringify({ id: a.id, active: a.active ? 0 : 1 }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) setAccounts(data.accounts as Account[]);
  };

  const removeAccount = async (a: Account) => {
    if (!confirm(`Postfach „${a.label}“ entfernen?`)) return;
    const res = await fetch(`/api/mail/accounts?id=${a.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (res.ok) setAccounts(data.accounts as Account[]);
  };

  const fetchNow = async () => {
    if (fetching) return;
    setFetching(true);
    setFetchError("");
    setResult(null);
    try {
      const res = await fetch("/api/mail/fetch", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Server-Fehler ${res.status}`);
      setResult(data as FetchResult);
      mails.reload();
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  };

  const unread = mails.rows.filter((m) => !m.read);
  const read = mails.rows.filter((m) => m.read).slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Mail-Digest"
        subtitle="Zusammenfassungen wichtiger Mails aus allen Postfächern – gefiltert nach deinen Regeln"
        action={
          <Button onClick={fetchNow} disabled={fetching} className="shrink-0 whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sync" size={16} className={fetching ? "animate-spin" : ""} />
              {fetching ? "Rufe ab …" : "Abrufen"}
            </span>
          </Button>
        }
      />

      <ErrorNote error={mails.error || rules.error || accError || fetchError} />

      {result && (
        <div className="bg-accent-soft border border-accent/25 rounded-[12px] px-4 py-3 mb-4 text-[13px]">
          {result.configured ? (
            <p>
              <span className="font-semibold text-accent">Abruf fertig:</span> {result.neu} neue{" "}
              {result.neu === 1 ? "Mail" : "Mails"}
              {result.accounts.length > 1 &&
                ` (${result.accounts.map((a) => `${a.label}: ${a.neu}`).join(", ")})`}{" "}
              · {result.wichtig} wichtig im Digest · {result.notizen}{" "}
              {result.notizen === 1 ? "neue Wissens-Notiz" : "neue Wissens-Notizen"}
            </p>
          ) : (
            <p className="text-warn font-medium">Noch keine Postfächer konfiguriert.</p>
          )}
          {result.hinweise.map((h, i) => (
            <p key={i} className="text-[12px] text-ink-2 mt-1.5">
              {h}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Ungelesen & wichtig" subtitle={`${unread.length} Mails`} />
            {unread.length === 0 && <EmptyState text="Alles gelesen." />}
            {unread.map((m) => (
              <Row key={m.id}>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold">{m.subject}</div>
                  <div className="text-[12px] text-ink-2 mt-0.5">{m.summary}</div>
                  <div className="text-[11px] text-ink-3 mt-1">
                    {m.from_addr} · {m.account} · <span className="text-accent">{m.matched_rule}</span>
                  </div>
                </div>
                <Button variant="ghost" onClick={() => mails.update(m.id, { read: 1 } as Partial<Mail>)}>
                  Gelesen
                </Button>
              </Row>
            ))}
          </Card>

          {read.length > 0 && (
            <Card className="opacity-60">
              <CardHeader title="Zuletzt gelesen" />
              {read.map((m) => (
                <Row key={m.id}>
                  <div className="flex-1 min-w-0 text-[13px] text-ink-2 truncate">{m.subject}</div>
                  <div className="text-[11px] text-ink-3">{m.from_addr}</div>
                </Row>
              ))}
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Postfächer" subtitle="Zugangsdaten werden verschlüsselt gespeichert" />
            {accounts.map((a) => (
              <Row key={a.id}>
                <Icon
                  name={a.has_password ? "mark_email_read" : "warning"}
                  size={18}
                  className={a.has_password ? "text-accent" : "text-warn"}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium flex items-center gap-2">
                    {a.label}
                    {!a.active ? <Badge>pausiert</Badge> : null}
                  </div>
                  <div className="text-[11px] text-ink-3 truncate">
                    {a.address}
                    {a.host ? ` · ${a.host}` : ""}
                  </div>
                  {!a.has_password && (
                    <div className="text-[11px] text-warn">
                      Ohne Zugangsdaten – bitte entfernen und unten neu verbinden.
                    </div>
                  )}
                </div>
                <button
                  onClick={() => toggleAccount(a)}
                  aria-label={a.active ? "Pausieren" : "Aktivieren"}
                  title={a.active ? "Pausieren" : "Aktivieren"}
                  className="text-ink-3 hover:text-accent transition-colors p-1"
                >
                  <Icon name={a.active ? "pause_circle" : "play_circle"} size={19} />
                </button>
                <button
                  onClick={() => removeAccount(a)}
                  aria-label="Entfernen"
                  title="Entfernen"
                  className="text-ink-3 hover:text-bad transition-colors p-1"
                >
                  <Icon name="delete" size={18} />
                </button>
              </Row>
            ))}
            {accounts.length === 0 && <EmptyState text="Noch kein Postfach verbunden." />}

            <div className="p-4 border-t border-line space-y-2.5">
              <div className="text-[12px] font-semibold text-ink-2">Postfach verbinden</div>
              <div className="flex gap-1.5 flex-wrap">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setProvider(p.key)}
                    className={`px-3 h-8 rounded-full text-[12px] font-medium border transition-all ${
                      provider === p.key
                        ? "bg-accent-soft border-accent/40 text-accent"
                        : "bg-inset border-line text-ink-2"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <Input
                placeholder={`Bezeichnung (z.B. ${PROVIDERS.find((p) => p.key === provider)!.name || "Geschäftlich"})`}
                value={accLabel}
                onChange={(e) => setAccLabel(e.target.value)}
              />
              <Input
                type="email"
                placeholder="E-Mail-Adresse"
                autoComplete="off"
                value={accUser}
                onChange={(e) => setAccUser(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Postfach-Passwort"
                autoComplete="new-password"
                value={accPass}
                onChange={(e) => setAccPass(e.target.value)}
              />
              {provider === "custom" && (
                <div className="flex gap-2">
                  <Input
                    placeholder="IMAP-Server (z.B. imap.strato.de)"
                    value={accHost}
                    onChange={(e) => setAccHost(e.target.value)}
                  />
                  <Input
                    className="!w-20 text-center"
                    placeholder="Port"
                    inputMode="numeric"
                    value={accPort}
                    onChange={(e) => setAccPort(e.target.value)}
                  />
                </div>
              )}
              {saveError && (
                <div className="text-[12px] text-bad break-words">
                  {saveError}
                  {saveHint && <p className="text-ink-2 mt-1">{saveHint}</p>}
                </div>
              )}
              <Button
                className="w-full !h-10"
                onClick={() => saveAccount(false)}
                disabled={saving || !accUser.trim() || !accPass || (provider === "custom" && !accHost.trim())}
              >
                {saving ? "Prüfe Verbindung …" : "Verbinden & speichern"}
              </Button>
              {canForce && !saving && (
                <Button variant="ghost" className="w-full" onClick={() => saveAccount(true)}>
                  Trotzdem speichern (ohne Test)
                </Button>
              )}
              <div className="text-[11px] text-ink-3 pt-1 space-y-1">
                <p>
                  Beim Speichern wird die Verbindung getestet. GMX: vorher in den GMX-Einstellungen
                  unter „POP3/IMAP Abruf“ IMAP aktivieren. IONOS: normales Postfach-Passwort.
                </p>
                <p>
                  Alternativ funktionieren weiterhin Umgebungsvariablen (<code>MAIL_1_…</code>),
                  Details: <code>docs/INTEGRATIONEN.md</code>
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Wichtig-Regeln"
              subtitle="VIP-Absender und Stichwörter"
              action={
                <button
                  onClick={runSuggest}
                  disabled={suggesting}
                  title="Postfach analysieren: Wem antwortest du oft?"
                  className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-accent-soft text-accent text-[12px] font-medium disabled:opacity-50 transition-all shrink-0 whitespace-nowrap"
                >
                  <Icon name="auto_awesome" size={15} className={suggesting ? "animate-spin" : ""} />
                  {suggesting ? "Analysiere …" : "Vorschläge"}
                </button>
              }
            />

            {(suggest || suggestError) && (
              <div className="px-4 pb-2">
                {suggestError && <p className="text-[12px] text-bad break-words mb-2">{suggestError}</p>}
                {suggest && (
                  <div className="bg-inset rounded-[12px] p-3 space-y-2.5">
                    <p className="text-[11px] text-ink-3">
                      {suggest.analysierte_mails > 0
                        ? `${suggest.analysierte_mails} gesendete Mails analysiert – tippe einen Vorschlag an, um ihn als Regel zu übernehmen:`
                        : "Keine Daten zum Analysieren."}
                    </p>
                    {suggest.senders.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold text-ink-2 mb-1.5">Oft angeschrieben (VIP-Vorschläge)</p>
                        <div className="flex flex-wrap gap-1.5">
                          {suggest.senders.map((s) => (
                            <button
                              key={s.value}
                              onClick={() => adoptSuggestion("absender", s.value)}
                              title={s.name ? `${s.name} · ${s.count}× angeschrieben` : `${s.count}× angeschrieben`}
                              className="inline-flex items-center gap-1 px-2.5 h-7 rounded-full border border-accent/40 bg-card text-[11px] text-accent font-medium hover:bg-accent-soft transition-all max-w-full"
                            >
                              <Icon name="add" size={13} />
                              <span className="truncate">{s.value}</span>
                              <span className="text-ink-3">{s.count}×</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {suggest.keywords.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold text-ink-2 mb-1.5">Häufige Themen (Stichwort-Vorschläge)</p>
                        <div className="flex flex-wrap gap-1.5">
                          {suggest.keywords.map((k) => (
                            <button
                              key={k.value}
                              onClick={() => adoptSuggestion("stichwort", k.value)}
                              className="inline-flex items-center gap-1 px-2.5 h-7 rounded-full border border-warn/40 bg-card text-[11px] text-warn font-medium hover:bg-warn/10 transition-all"
                            >
                              <Icon name="add" size={13} />
                              {k.value}
                              <span className="text-ink-3">{k.count}×</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {suggest.configured && suggest.senders.length === 0 && suggest.keywords.length === 0 && (
                      <p className="text-[12px] text-ink-2">
                        Keine neuen Vorschläge – deine Regeln decken die häufigen Kontakte schon ab.
                      </p>
                    )}
                    {suggest.hinweise.map((h, i) => (
                      <p key={i} className="text-[11px] text-ink-3">
                        {h}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="px-5 pb-3 flex flex-wrap gap-1.5">
              {rules.rows.map((r) => (
                <button
                  key={r.id}
                  onClick={() => rules.remove(r.id)}
                  title="Klicken zum Entfernen"
                  className="group"
                >
                  <Badge tone={r.kind === "absender" ? "accent" : "warn"}>
                    {r.kind === "absender" ? "@" : "#"} {r.value} ✕
                  </Badge>
                </button>
              ))}
            </div>
            <div className="p-4 border-t border-line flex gap-2">
              <Select value={ruleKind} onChange={(e) => setRuleKind(e.target.value)}>
                <option value="absender">Absender</option>
                <option value="stichwort">Stichwort</option>
              </Select>
              <Input
                placeholder={ruleKind === "absender" ? "z.B. arval.de" : "z.B. Rechnung"}
                value={ruleValue}
                onChange={(e) => setRuleValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ruleValue.trim()) {
                    rules.create({ kind: ruleKind, value: ruleValue.trim() } as Partial<Rule>);
                    setRuleValue("");
                  }
                }}
              />
              <Button
                onClick={() => {
                  if (!ruleValue.trim()) return;
                  rules.create({ kind: ruleKind, value: ruleValue.trim() } as Partial<Rule>);
                  setRuleValue("");
                }}
              >
                +
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
