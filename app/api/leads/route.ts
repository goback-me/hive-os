import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { LEAD_STAGES, type LeadStageValue } from "@/lib/lead-status";
import { rangeFromParams } from "@/lib/date-range";

// Paginated — the Leads tab can have 1000+ rows once a real sheet is synced,
// so the client never receives more than one page (with its `raw` JSON blob
// per row) at a time. See components/LeadsPanel.tsx.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? "25") || 25));
  const stageParam = req.nextUrl.searchParams.get("stage");
  const stage = stageParam && LEAD_STAGES.includes(stageParam as LeadStageValue) ? (stageParam as LeadStageValue) : undefined;

  // "Unattributed" is the display label for a blank/missing campaign (see
  // displayCampaignName in LeadsPanel) — matched here as null-or-empty since
  // that's not a real value stored on any lead.
  const campaignParam = req.nextUrl.searchParams.get("campaign");
  const campaignWhere =
    campaignParam === "Unattributed"
      ? { OR: [{ campaign: null }, { campaign: "" }] }
      : campaignParam
      ? { campaign: campaignParam }
      : undefined;

  // The literal, unmapped status text from the sheet (see sheetStatus on the
  // Lead model) — filterable on its own, independent of whether the client
  // has configured a statusMapping into the funnel yet.
  const sheetStatusParam = req.nextUrl.searchParams.get("sheetStatus");
  const sheetStatusWhere =
    sheetStatusParam === "__none__"
      ? { sheetStatus: null }
      : sheetStatusParam
      ? { sheetStatus: sheetStatusParam }
      : undefined;

  const { from, to } = rangeFromParams(req.nextUrl.searchParams).range;
  const createdAt = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } : undefined;

  // "Needs fixing" (coach data cleanup): DQ'd with no reason, won with no
  // job value, lost with no reason. In an AND so it can't clash with the
  // campaign filter's own OR.
  const needsFixing = req.nextUrl.searchParams.get("needsFixing") === "1" && user.role === "COACH";
  const needsWhere = {
    OR: [
      { stage: "DISQUALIFIED" as const, OR: [{ dqReason: "UNKNOWN" as const }, { dqReason: null }] },
      { stage: "WON" as const, value: null },
      { stage: "LOST" as const, OR: [{ lostReason: "UNKNOWN" as const }, { lostReason: null }] },
    ],
  };

  const where = {
    clientId,
    deletedAt: null,
    ...(stage ? { stage } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...sheetStatusWhere,
    AND: [campaignWhere ?? {}, needsFixing ? needsWhere : {}],
  };
  // Same filter minus `stage`/`sheetStatus` — powers each tab's own count
  // regardless of which tab is currently selected.
  const whereForStatusCounts = { clientId, deletedAt: null, ...(createdAt ? { createdAt } : {}), ...campaignWhere, ...sheetStatusWhere };
  const whereForSheetStatusCounts = { clientId, deletedAt: null, ...(createdAt ? { createdAt } : {}), ...campaignWhere, ...(stage ? { stage } : {}) };

  const [total, leads, statusGroups, sheetStatusGroups, needsFixingCount] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      // id tiebreak: a sheet import stamps many rows with the same createdAt,
      // and without it Postgres pages them in arbitrary order (dupes/skips).
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.lead.groupBy({ by: ["stage"], where: whereForStatusCounts, _count: true }),
    prisma.lead.groupBy({ by: ["sheetStatus"], where: whereForSheetStatusCounts, _count: true }),
    user.role === "COACH"
      ? prisma.lead.count({ where: { clientId, deletedAt: null, ...(createdAt ? { createdAt } : {}), AND: [campaignWhere ?? {}, needsWhere] } })
      : Promise.resolve(null),
  ]);

  const stageCounts = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])) as Record<string, number>;
  for (const g of statusGroups) stageCounts[g.stage] = g._count;

  // Keyed by the literal sheet value; a null sheetStatus (no status column
  // configured, or that row's cell was blank) is bucketed under "__none__".
  const sheetStatusCounts: Record<string, number> = {};
  for (const g of sheetStatusGroups) sheetStatusCounts[g.sheetStatus ?? "__none__"] = g._count;

  return NextResponse.json({
    total,
    page,
    pageSize,
    stageCounts,
    sheetStatusCounts,
    needsFixingCount,
    leads: leads.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      email: l.email,
      source: l.source,
      campaign: l.campaign,
      stage: l.stage,
      dqReason: l.dqReason,
      dqPhase: l.dqPhase,
      lostReason: l.lostReason,
      callAttempts: l.callAttempts,
      hqNewer: !!l.hqStatusUpdatedAt && (!l.sheetStatusUpdatedAt || l.hqStatusUpdatedAt > l.sheetStatusUpdatedAt),
      sheetWriteError: l.sheetWriteError,
      sheetStage: l.sheetStage,
      sheetStatus: l.sheetStatus,
      value: l.value ? Number(l.value) : null,
      raw: l.raw,
      createdAt: l.createdAt.toISOString(),
      lastSyncedAt: l.lastSyncedAt?.toISOString() ?? null,
    })),
  });
}
