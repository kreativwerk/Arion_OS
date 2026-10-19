import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { authEnabled } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { sendDraft } from "@/lib/mail-send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Freigabe: verschickt einen Entwurf. Nur mit App-Login (Session-Cookie, siehe
 * middleware.ts) – ohne gesetztes APP_PASSWORD ist der Versand in Produktion
 * gesperrt, damit niemand ohne Anmeldung Mails im Namen der Firma verschickt.
 */
export const POST = withApi(async (req: NextRequest) => {
  if (!authEnabled() && process.env.VERCEL) {
    return NextResponse.json({ error: "Versand gesperrt: APP_PASSWORD ist nicht gesetzt." }, { status: 403 });
  }
  const { id } = (await req.json().catch(() => ({}))) as { id?: number };
  if (!id) return NextResponse.json({ error: "id erforderlich" }, { status: 400 });
  const res = await sendDraft(await getDb(), Number(id));
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
});
