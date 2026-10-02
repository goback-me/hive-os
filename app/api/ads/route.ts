import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getMetaAllCampaigns } from "@/lib/meta-ads";
import { getReportingScope } from "@/lib/reporting-scope";

// Ads tab: the client's campaigns (Meta's live list when connected, else the
// manually tracked AdCampaign rows) with spend, plus — for coaches — whether
// each one counts in reports (lib/reporting-scope.ts).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }
  const isCoach = user.role === "COACH";

  const [scope, client, manualRows] = await Promise.all([
    getReportingScope(clientId),
    prisma.client.findUnique({ where: { id: clientId }, select: { metaAdAccountId: true, metaAccessToken: true } }),
    prisma.adCampaign.findMany({ where: { clientId, metaCampaignId: null } }),
  ]);
  const flags = new Map(scope.campaigns.map((c) => [c.id, c]));

  let campaigns;
  if (scope.source === "meta" && client?.metaAdAccountId && client.metaAccessToken) {
    const meta = await getMetaAllCampaigns(client.metaAdAccountId, client.metaAccessToken).catch(() => null);
    campaigns = meta?.map((c) => ({ id: c.id, name: c.name, status: c.status, spend: c.spend, impressions: c.impressions, clicks: c.clicks }));
  }
  const source = campaigns ? "meta" : "manual";
  campaigns ??= manualRows.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    spend: Number(c.spend),
    impressions: c.impressions,
    profileVisits: c.profileVisits,
    engagement: c.engagement,
    saves: c.saves,
    syncedAt: c.syncedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({
    source,
    startDate: scope.startDate?.toISOString() ?? null,
    campaigns: campaigns.map((c) => {
      const f = flags.get(c.id);
      if (!f) return c;
      return isCoach ? { ...c, startedAt: f.startedAt, defaultIncluded: f.defaultIncluded, override: f.override, included: f.included } : { ...c, included: f.included };
    }),
  });
}
