import { prisma } from "./prisma";
import { fetchCampaignInsights } from "./meta-ads";

// Meta keeps re-attributing the last few days, so each top-up re-pulls them.
const SETTLE_DAYS = 3;

// Copies a client's Meta history (per campaign per day) into MetaAdInsight
// for case studies. First run = the account's full history (~37 months, all
// Meta serves); after that, from the newest stored day minus SETTLE_DAYS.
// Rows are keyed by ad account and never deleted on disconnect. `minHours`
// skips the run when this account was archived more recently than that.
export async function archiveMetaInsights(clientId: string, { minHours = 0 } = {}) {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { metaAdAccountId: true, metaAccessToken: true } });
  if (!c?.metaAdAccountId || !c.metaAccessToken) return null;
  const account = c.metaAdAccountId;

  const last = await prisma.metaAdInsight.aggregate({ where: { adAccountId: account }, _max: { date: true, syncedAt: true } });
  if (minHours && last._max.syncedAt && Date.now() - last._max.syncedAt.getTime() < minHours * 3_600_000) return null;
  const since = last._max.date
    ? new Date(Date.parse(`${last._max.date}T00:00:00Z`) - SETTLE_DAYS * 86_400_000).toISOString().slice(0, 10)
    : undefined;

  // ponytail: one daily-breakdown request for the whole window; switch to
  // Meta's async report jobs if a huge account's first backfill times out.
  const rows = await fetchCampaignInsights(account, c.metaAccessToken, since, undefined, true);
  await prisma.$transaction([
    prisma.metaAdInsight.deleteMany({ where: { adAccountId: account, ...(since ? { date: { gte: since } } : {}) } }),
    prisma.metaAdInsight.createMany({
      data: rows
        .filter((r) => r.date)
        .map((r) => ({ clientId, adAccountId: account, campaignId: r.campaignId, campaignName: r.campaignName, date: r.date!, spend: r.spend, impressions: r.impressions, clicks: r.clicks })),
    }),
  ]);
  return { account, since: since ?? "full history", rows: rows.length };
}
