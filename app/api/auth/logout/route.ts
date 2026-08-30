import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const POST = withApi(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
});
