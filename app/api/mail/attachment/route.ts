import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { accountsFromDb, accountsFromEnv } from "@/lib/mail-fetch";
import { openImap } from "@/lib/mail-archive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

/** Anhang einer archivierten Mail direkt vom IMAP-Server laden (nur lesend). */
export const GET = withApi(async (req: NextRequest) => {
  const id = Number(req.nextUrl.searchParams.get("id"));
  const part = req.nextUrl.searchParams.get("part") || "";
  if (!id || !/^[0-9.]+$/.test(part)) return NextResponse.json({ error: "id und part erforderlich" }, { status: 400 });
  const d = await getDb();
  const mail = await d.get<{ account: string; folder: string; uid: number; uidvalidity: string; attachments: string }>(
    "SELECT account, folder, uid, uidvalidity, attachments FROM mails WHERE id = ?",
    [id]
  );
  if (!mail) return NextResponse.json({ error: "Mail nicht gefunden" }, { status: 404 });
  const meta = (JSON.parse(mail.attachments || "[]") as { part: string; filename: string; mime: string }[]).find(
    (a) => a.part === part
  );
  if (!meta) return NextResponse.json({ error: "Anhang nicht gefunden" }, { status: 404 });

  const hints: string[] = [];
  const acc = [...(await accountsFromDb(d, hints)), ...accountsFromEnv()].find((a) => a.label === mail.account);
  if (!acc) return NextResponse.json({ error: `Postfach „${mail.account}“ ist nicht (mehr) verbunden.` }, { status: 404 });

  const client = openImap(acc);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mail.folder, { readOnly: true });
    let data: Buffer;
    try {
      const mb = client.mailbox;
      if (!mb || typeof mb === "boolean" || String(mb.uidValidity) !== mail.uidvalidity) {
        return NextResponse.json({ error: "Ordner wurde auf dem Server neu aufgebaut – Mail bitte neu suchen." }, { status: 409 });
      }
      const dl = await client.download(String(mail.uid), part, { uid: true, maxBytes: MAX_BYTES });
      const chunks: Buffer[] = [];
      for await (const c of dl.content as AsyncIterable<Buffer>) chunks.push(c);
      data = Buffer.concat(chunks);
    } finally {
      lock.release();
    }
    await client.logout();
    const inline = req.nextUrl.searchParams.get("inline") === "1" && /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/.test(meta.mime);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": meta.mime || "application/octet-stream",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    try {
      await client.logout();
    } catch {
      /* bereits getrennt */
    }
    throw e;
  }
});
