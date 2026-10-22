import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { notifyNewDrafts } from "@/lib/draft-notify";

export const dynamic = "force-dynamic";

/**
 * Meldet neue Claude-Entwürfe sofort per Push (sonst im Mail-Cron alle 10 Minuten).
 * Verschickt keine Mail – nur die Benachrichtigung „Entwurf wartet“.
 */
export const POST = withApi(async () => {
  return NextResponse.json(await notifyNewDrafts(await getDb()));
});
