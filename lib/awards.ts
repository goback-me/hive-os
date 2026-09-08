import { prisma } from "./prisma";

export async function checkAndGrantAwards(clientId: string) {
  const tiers = await prisma.awardTier.findMany({ orderBy: { order: "asc" } });
  const existing = await prisma.clientAward.findMany({ where: { clientId } });
  const earnedTierIds = new Set(existing.map((e) => e.awardTierId));

  // Lifetime revenue the CLIENT's own business has generated (synced from
  // Stripe or entered manually) — not what they've paid Hive in coaching
  // fees. Awards celebrate the client's growth, so they must be keyed off
  // the client's results, not their invoice history.
  const revenueAgg = await prisma.revenueMonthly.aggregate({
    _sum: { amount: true },
    where: { clientId },
  });
  const lifetimeRevenue = Number(revenueAgg._sum.amount ?? 0);

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
