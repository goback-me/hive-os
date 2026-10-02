import { prisma } from "../lib/prisma";
import { rebuildHistory } from "../lib/kpi";

// Rebuilds Snapshot KPI history (MonthlyKpi, source BACKFILL) for every
// closed month since each client's start date — the same as a coach's
// "Rebuild history" button, for every client at once. FROZEN months (stored
// by the cron at month end) are never touched. Safe to re-run. Meta spend is
// fetched per month; a client whose Meta call fails is reported and left for
// a re-run.
//   npm run db:backfill-kpis
async function main() {
  const clients = await prisma.client.findMany({ where: { archivedAt: null }, select: { id: true, slug: true } });
  for (const c of clients) {
    try {
      const months = await rebuildHistory(c.id, { cached: false });
      console.log(`${c.slug}: ${months.length ? `rebuilt ${months.join(", ")}` : "nothing to rebuild"}`);
    } catch (err) {
      console.error(`${c.slug}: FAILED — ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}

main().finally(() => prisma.$disconnect());
