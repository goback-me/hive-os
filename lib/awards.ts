import { prisma } from "./prisma";
import { getRevenueByMonth, lifetimeRevenue as lifetimeRevenueOf } from "./revenue";

export async function checkAndGrantAwards(clientId: string) {
  const tiers = await prisma.awardTier.findMany({ orderBy: { order: "asc" } });
  const existing = await prisma.clientAward.findMany({ where: { clientId } });
  const earnedTierIds = new Set(existing.map((e) => e.awardTierId));

  // Lifetime revenue the CLIENT's own business has generated (manual/Stripe
  // entries, or won leads from their sheet — lib/revenue.ts) — not what
  // they've paid Hive. Awards celebrate the client's results.
  const lifetimeRevenue = lifetimeRevenueOf(await getRevenueByMonth([clientId]), clientId);

  for (const tier of tiers) {
    if (earnedTierIds.has(tier.id)) continue;

    let qualifies = false;
    if (tier.thresholdRevenue && lifetimeRevenue >= Number(tier.thresholdRevenue)) {
      qualifies = true;
    }
    if (tier.requiredModuleId) {
      const lessons = await prisma.lesson.findMany({ where: { moduleId: tier.requiredModuleId } });
      const completed = await prisma.clientLessonProgress.count({
        where: { clientId, lessonId: { in: lessons.map((l) => l.id) }, completedAt: { not: null } },
      });
      if (lessons.length > 0 && completed === lessons.length) qualifies = true;
    }

    if (qualifies) {
      await prisma.clientAward.create({ data: { clientId, awardTierId: tier.id } });
    }
  }
}
