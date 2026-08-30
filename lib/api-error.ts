import { NextResponse } from "next/server";

/** Einheitliche JSON-Fehlerantwort – damit die UI echte Fehlermeldungen
 *  anzeigen kann (z.B. fehlende DATABASE_URL auf Vercel) statt stumm zu scheitern. */
export function apiError(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : String(e);
  console.error("[api]", message);
  return NextResponse.json({ error: message }, { status });
}

/** Handler-Wrapper: fängt jeden Fehler und antwortet als JSON. */
export function withApi<Req extends Request, Ctx>(
  handler: (req: Req, ctx: Ctx) => Promise<NextResponse> | NextResponse
) {
  return async (req: Req, ctx: Ctx): Promise<NextResponse> => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      return apiError(e);
    }
  };
}
