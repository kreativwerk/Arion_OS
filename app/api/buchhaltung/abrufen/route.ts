import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { runBuchhaltung } from "@/lib/buch-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** „Jetzt abrufen“ auf /buchhaltung – derselbe Lauf wie der Cron (Login über Middleware). */
export const POST = withApi(async () => {
  return NextResponse.json(await runBuchhaltung({ push: false }));
});
