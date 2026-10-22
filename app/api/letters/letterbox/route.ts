import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { runLetterbox } from "@/lib/letterbox";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Knopf „Briefkasten abrufen“ auf /post (mit App-Login, siehe middleware.ts). */
export const POST = withApi(async () => NextResponse.json(await runLetterbox(Date.now() + 270_000)));
