import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { runMailSuggest } from "@/lib/mail-analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Postfach-Analyse: Vorschläge für VIP-Absender und Stichwörter
 *  aus dem Gesendet-Ordner (wem antwortet Albert oft?). */
export const POST = withApi(async () => {
  return NextResponse.json(await runMailSuggest());
});
