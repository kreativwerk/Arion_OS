import { NextRequest, NextResponse } from "next/server";
import { getDb, getConfig } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["app_name", "user_name", "company", "partners", "employee_app", "about_me"];

export async function GET() {
  return NextResponse.json(await getConfig());
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Record<string, string>;
  const d = await getDb();
  for (const key of ALLOWED_KEYS) {
    if (typeof body[key] === "string") {
      await d.run(
        "INSERT INTO app_config (key, value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [key, body[key]]
      );
    }
  }
  return NextResponse.json(await getConfig());
}
