import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { encryptSecret } from "@/lib/secret-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Postfach-Verwaltung direkt in der App: Zugangsdaten werden AES-verschlüsselt
 * in der Datenbank abgelegt (lib/secret-store.ts) und nie an den Client
 * zurückgegeben – die Liste enthält nur `has_password`.
 */

type AccountRow = {
  id: number;
  label: string;
  address: string;
  active: number;
  host: string;
  port: number;
  username: string;
  password_enc: string;
};

async function safeList() {
  const d = await getDb();
  const rows = await d.all<AccountRow>(
    "SELECT id, label, address, active, host, port, username, password_enc FROM mail_accounts ORDER BY id ASC"
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    address: r.address,
    active: r.active,
    host: r.host,
    port: r.port,
    has_password: Boolean(r.password_enc),
  }));
}

/** Verbindung wirklich ausprobieren – gibt null (ok) oder die Fehlermeldung zurück. */
async function testConnection(host: string, port: number, user: string, pass: string): Promise<string | null> {
  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 15_000,
  });
  try {
    await client.connect();
    await client.logout();
    return null;
  } catch (e) {
    try {
      await client.logout();
    } catch {
      /* bereits getrennt */
    }
    return e instanceof Error ? e.message : String(e);
  }
}

export const GET = withApi(async () => {
  return NextResponse.json(await safeList());
});

export const POST = withApi(async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    label?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    skipTest?: boolean;
  };
  const label = body.label?.trim();
  const host = body.host?.trim();
  const username = body.username?.trim();
  const password = body.password ?? "";
  const port = Number(body.port) || 993;
  if (!label || !host || !username || !password) {
    return NextResponse.json(
      { error: "Bezeichnung, Server, E-Mail-Adresse und Passwort sind erforderlich." },
      { status: 400 }
    );
  }

  let tested = false;
  if (!body.skipTest) {
    const err = await testConnection(host, port, username, password);
    if (err) {
      return NextResponse.json(
        {
          error: `Verbindung fehlgeschlagen: ${err}`,
          hint:
            host.includes("gmx") && /auth|login|credentials/i.test(err)
              ? "Bei GMX muss IMAP erst aktiviert werden: GMX-Webmail → E-Mail → Einstellungen → POP3/IMAP Abruf → „IMAP aktivieren“."
              : "Zugangsdaten prüfen. Du kannst das Postfach mit „Trotzdem speichern“ auch ohne Test anlegen.",
        },
        { status: 400 }
      );
    }
    tested = true;
  }

  const d = await getDb();
  await d.run(
    "INSERT INTO mail_accounts (label, address, active, host, port, username, password_enc) VALUES (?,?,1,?,?,?,?)",
    [label, username, host, port, username, encryptSecret(password)]
  );
  return NextResponse.json({ ok: true, tested, accounts: await safeList() });
});

export const PATCH = withApi(async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { id?: number; active?: number; password?: string };
  if (!body.id) return NextResponse.json({ error: "id erforderlich" }, { status: 400 });
  const d = await getDb();
  if (typeof body.active === "number") {
    await d.run("UPDATE mail_accounts SET active = ? WHERE id = ?", [body.active ? 1 : 0, body.id]);
  }
  if (body.password) {
    await d.run("UPDATE mail_accounts SET password_enc = ? WHERE id = ?", [encryptSecret(body.password), body.id]);
  }
  return NextResponse.json({ ok: true, accounts: await safeList() });
});

export const DELETE = withApi(async (req: NextRequest) => {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id erforderlich" }, { status: 400 });
  const d = await getDb();
  await d.run("DELETE FROM mail_accounts WHERE id = ?", [id]);
  return NextResponse.json({ ok: true, accounts: await safeList() });
});
