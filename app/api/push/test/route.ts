import { NextResponse } from "next/server";
import { pushConfigured, sendPushToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Test-Benachrichtigung an alle registrierten Geräte. */
export async function POST() {
  if (!pushConfigured()) {
    return NextResponse.json(
      { error: "Push nicht konfiguriert – VAPID-Schlüssel in der Umgebung setzen (docs/DEPLOY.md)." },
      { status: 400 }
    );
  }
  const result = await sendPushToAll({
    title: "Arion OS",
    body: "Testbenachrichtigung – Push funktioniert.",
    url: "/",
  });
  return NextResponse.json(result);
}
