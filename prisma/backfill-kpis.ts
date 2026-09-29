import { prisma } from "../lib/prisma";
import { freezeDueMonths } from "../lib/kpi";

// Freezes Snapshot KPIs (MonthlyKpi) for every closed month since each
// client's first lead. Idempotent — already-frozen months are skipped, so
// it's safe to re-run. `--force` recomputes and re-freezes every month
// (e.g. after fixing a sheet's historic notes). Meta spend is fetched per
// month; a client whose Meta call fails is reported and left for a re-run.
//   npm run db:backfill-kpis [-- --force]
const force = process.argv.includes("--force");

async function main() {
  const clients = await prisma.client.findMany({ where: { archivedAt: null }, select: { id: true, slug: true } });
  for (const c of clients) {
    try {
      const months = await freezeDueMonths(c.id, { force });
      console.log(`${c.slug}: ${months.length ? `froze ${months.join(", ")}` : "nothing to freeze"}`);
    } catch (err) {
      console.error(`${c.slug}: FAILED — ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}

main().finally(() => prisma.$disconnect());
