import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { runMailFetch } from "@/lib/mail-fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Manueller Mail-Abruf über den "Jetzt abrufen"-Button. */
export const POST = withApi(async () => {
  return NextResponse.json(await runMailFetch());
});
