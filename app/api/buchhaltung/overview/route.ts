import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { buildOverview, MONTH_RE } from "@/lib/buch-overview";

export const dynamic = "force-dynamic";

/** GET /api/buchhaltung/overview?monat=YYYY-MM – alles für die Seite /buchhaltung (ohne Blobs). */
export const GET = withApi(async (req: NextRequest) => {
  const monat = req.nextUrl.searchParams.get("monat");
  if (monat && !MONTH_RE.test(monat)) {
    return NextResponse.json({ error: "monat muss das Format YYYY-MM haben." }, { status: 400 });
  }
  return NextResponse.json(await buildOverview(monat));
});
