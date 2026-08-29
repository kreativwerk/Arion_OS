import { NextRequest, NextResponse } from "next/server";
import { db, getConfig } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["app_name", "user_name", "company", "partners", "employee_app", "about_me"];

export async function GET() {
  return NextResponse.json(getConfig());
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Record<string, string>;
  const stmt = db().prepare(
    "INSERT INTO app_config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  for (const key of ALLOWED_KEYS) {
    if (typeof body[key] === "string") stmt.run(key, body[key]);
  }
  return NextResponse.json(getConfig());
}
