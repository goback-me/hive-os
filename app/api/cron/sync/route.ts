import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncLeadsFromSheet } from "@/lib/lead-sync";
import { freezeDueMonths } from "@/lib/kpi";
import { processWriteBacks } from "@/lib/sheet-writeback";

// Called by n8n every 5 min (see DEPLOYMENT.md). Public in middleware.ts —
// the x-cron-secret header is the only auth. Clients sync one at a time
// (gentle on the Sheets API quota); one client's failure never stops the rest
// and is recorded on its ClientSheet.lastSyncError by syncLeadsFromSheet.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const given = req.headers.get("x-cron-secret");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sheets = await prisma.clientSheet.findMany({
    where: { client: { archivedAt: null } },
    select: { clientId: true, client: { select: { slug: true } } },
  });

  const results = [];
  for (const s of sheets) {
    const started = Date.now();
    try {
      const summary = await syncLeadsFromSheet(s.clientId);
      results.push({ client: s.client.slug, ok: true, ms: Date.now() - started, ...summary });
    } catch (err) {
      results.push({ client: s.client.slug, ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Month-end freeze: once a month is 3 days past its end, its Snapshot KPIs
  // are stored in MonthlyKpi and never recomputed. Only the last couple of
  // months are checked here (cheap every 5 min); older ones = the backfill
  // script. A failure (e.g. Meta down) just retries on the next run.
  const frozen: { client: string; months?: string[]; error?: string }[] = [];
  const clients = await prisma.client.findMany({ where: { archivedAt: null }, select: { id: true, slug: true } });
  for (const c of clients) {
    try {
      const months = await freezeDueMonths(c.id, { lookback: 2 });
      if (months.length) frozen.push({ client: c.slug, months });
    } catch (err) {
      frozen.push({ client: c.slug, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // HQ → sheet status write-back (max 50 cells a minute). Gets what's left
  // of the run's time; anything still queued goes on the next run.
  const writeBack = await processWriteBacks({ maxMs: 120_000 }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));

  return NextResponse.json({ synced: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results, frozen, writeBack });
}
