import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cronAuthorized } from "@/lib/cron-auth";
import { sheetNeedsSync, syncLeadsFromSheet } from "@/lib/lead-sync";
import { getSpreadsheetModifiedTime, getValidAccessToken } from "@/lib/google-sheets";
import { processWriteBacks } from "@/lib/sheet-writeback";
import { ACTIVE_CLIENT } from "@/lib/am-calls";

// Every minute (VPS crontab, DEPLOYMENT.md): sync the lead sheets that
// changed. One Drive call per sheet says whether it was edited since its last
// sync (sheetNeedsSync); only those are read, so a quiet minute costs almost
// nothing. Then the write-backs those syncs queued. Everything else stays on
// the 5-minute /api/cron/sync.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const sheets = await prisma.clientSheet.findMany({
    where: { client: ACTIVE_CLIENT },
    select: { clientId: true, spreadsheetId: true, lastSyncedAt: true, lastSyncError: true, sheetModifiedAt: true, updatedAt: true, client: { select: { slug: true } } },
  });
  const token = await getValidAccessToken().catch(() => null);

  const synced: { client: string; ok: boolean; ms: number; error?: string }[] = [];
  let skipped = 0;
  for (const s of sheets) {
    // Read before the sync, so an edit made during it triggers the next one.
    const modified = token ? await getSpreadsheetModifiedTime(token, s.spreadsheetId).catch(() => null) : null;
    if (!sheetNeedsSync({ modified, seen: s.sheetModifiedAt, lastSyncedAt: s.lastSyncedAt, failedAt: s.lastSyncError ? s.updatedAt : null, now })) {
      skipped++;
      continue;
    }
    const started = Date.now();
    try {
      await syncLeadsFromSheet(s.clientId);
      if (modified) await prisma.clientSheet.update({ where: { clientId: s.clientId }, data: { sheetModifiedAt: modified } });
      synced.push({ client: s.client.slug, ok: true, ms: Date.now() - started });
    } catch (err) {
      synced.push({ client: s.client.slug, ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    }
  }

  const writeBack = synced.length ? await processWriteBacks({ maxMs: 20_000 }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) })) : null;
  return NextResponse.json({ skipped, synced, writeBack });
}
