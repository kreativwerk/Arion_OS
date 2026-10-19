import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { runBelegeEinsortieren } from "@/lib/buch-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** „Einsortieren“ auf /buchhaltung – neue Belege automatisch erkennen und ablegen (Login über Middleware). */
export const POST = withApi(async () => {
  return NextResponse.json(await runBelegeEinsortieren());
});
