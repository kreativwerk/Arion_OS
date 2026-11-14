import { NextRequest, NextResponse } from "next/server";
import { getDb, todayIso, type DB } from "@/lib/db";
import { verifyExternalToken } from "@/lib/external-auth";
import { handleMcp, type MirrorDoc, type MirrorSource } from "@/lib/codriver-mcp";
import { codriverDatei } from "@/lib/codriver-sync";
import { pdfToLayoutText } from "@/lib/lohn-parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ token: string }> };

/**
 * Codriver-MCP für Arion (nur lesend) – MCP „Streamable HTTP“, zustandslos.
 *
 *   POST /api/external/mcp/{arion_…-Token}
 *
 * Der Token steht im Pfad, weil Claude-Connectors keine eigenen Header setzen
 * können; alternativ `Authorization: Bearer arion_…`. Token anlegen unter
 * Einstellungen → API-Zugänge (Bezeichnung z. B. „Claude Codriver-MCP“).
 * Doku: docs/CODRIVER.md, Abschnitt 6.
 */
async function auth(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const header = req.headers.get("authorization");
  return verifyExternalToken(header?.match(/^Bearer\s+\S/i) ? header : `Bearer ${decodeURIComponent(token || "")}`);
}

function quelle(d: DB): MirrorSource {
  const cache = new Map<string, Promise<MirrorDoc[]>>();
  return {
    docs(collection) {
      if (!/^[A-Za-z0-9_]{1,60}$/.test(collection)) return Promise.resolve([]);
      if (!cache.has(collection)) {
        cache.set(
          collection,
          d
            .all<{ doc_id: string; data: string; update_time: string }>(
              "SELECT doc_id, data, update_time FROM codriver_docs WHERE collection = ? AND removed_at IS NULL",
              [collection]
            )
            .then((rows) =>
              rows.flatMap((r) => {
                try {
                  return [{ collection, id: r.doc_id, data: JSON.parse(r.data) as Record<string, unknown>, updated: r.update_time || "" }];
                } catch {
                  return [];
                }
              })
            )
        );
      }
      return cache.get(collection)!;
    },
    async stats() {
      const rows = await d.all<{ collection: string; n: number | string; last: string | null }>(
        "SELECT collection, COUNT(*) AS n, MAX(synced_at) AS last FROM codriver_docs WHERE removed_at IS NULL GROUP BY collection ORDER BY collection"
      );
      return rows.map((r) => ({ collection: r.collection, anzahl: Number(r.n), letzterSync: r.last || "" }));
    },
    async lastSync() {
      const r = await d.get<{ value: string }>("SELECT value FROM app_config WHERE key = 'codriver_last_sync'");
      return r?.value || "";
    },
    datei: (ref) => codriverDatei(ref),
    pdfText: (bytes) => pdfToLayoutText(bytes),
  };
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!(await auth(req, ctx))) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Ungültiger oder fehlender API-Token" } }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  try {
    const d = await getDb();
    const out = await handleMcp(body, quelle(d), todayIso());
    if (out === null) return new NextResponse(null, { status: 202 });
    return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } },
      { status: 500 }
    );
  }
}

/** Kein Server-Push (SSE) – laut MCP-Spezifikation dann 405. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { allow: "POST, DELETE" } });
}

/** Zustandslos: Sitzungsende ist immer ok. */
export async function DELETE() {
  return new NextResponse(null, { status: 204 });
}
