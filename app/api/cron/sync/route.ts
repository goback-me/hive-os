import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncLeadsFromSheet } from "@/lib/lead-sync";

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

  return NextResponse.json({ synced: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
}
