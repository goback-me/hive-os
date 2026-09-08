import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { LEAD_STATUSES } from "@/lib/lead-status";
import { DATE_RANGE_PRESETS, resolveDateRange, type DateRangePreset } from "@/lib/date-range";

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
  const statusParam = req.nextUrl.searchParams.get("status");
  const status = statusParam && LEAD_STATUSES.includes(statusParam as never) ? statusParam : undefined;

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
  // has configured a statusMapping into the fixed 6-stage pipeline yet.
  const sheetStatusParam = req.nextUrl.searchParams.get("sheetStatus");
  const sheetStatusWhere =
    sheetStatusParam === "__none__"
      ? { sheetStatus: null }
      : sheetStatusParam
      ? { sheetStatus: sheetStatusParam }
      : undefined;

  const rangeParam = req.nextUrl.searchParams.get("range");
  const preset: DateRangePreset = DATE_RANGE_PRESETS.includes(rangeParam as DateRangePreset)
    ? (rangeParam as DateRangePreset)
    : "maximum";
  const { from, to } = resolveDateRange(preset);
  const createdAt = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } : undefined;

  const where = { clientId, ...(status ? { status: status as never } : {}), ...(createdAt ? { createdAt } : {}), ...campaignWhere, ...sheetStatusWhere };
  // Same filter minus `status`/`sheetStatus` — powers each tab's own count
  // regardless of which tab is currently selected.
  const whereForStatusCounts = { clientId, ...(createdAt ? { createdAt } : {}), ...campaignWhere, ...sheetStatusWhere };
  const whereForSheetStatusCounts = { clientId, ...(createdAt ? { createdAt } : {}), ...campaignWhere, ...(status ? { status: status as never } : {}) };

  const [total, leads, statusGroups, sheetStatusGroups] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.lead.groupBy({ by: ["status"], where: whereForStatusCounts, _count: true }),
    prisma.lead.groupBy({ by: ["sheetStatus"], where: whereForSheetStatusCounts, _count: true }),
  ]);

  const statusCounts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  for (const g of statusGroups) statusCounts[g.status] = g._count;

  // Keyed by the literal sheet value; a null sheetStatus (no status column
  // configured, or that row's cell was blank) is bucketed under "__none__".
  const sheetStatusCounts: Record<string, number> = {};
  for (const g of sheetStatusGroups) sheetStatusCounts[g.sheetStatus ?? "__none__"] = g._count;

  return NextResponse.json({
    total,
    page,
    pageSize,
    statusCounts,
    sheetStatusCounts,
    leads: leads.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      email: l.email,
      source: l.source,
      campaign: l.campaign,
      status: l.status,
      sheetStatus: l.sheetStatus,
      value: l.value ? Number(l.value) : null,
      raw: l.raw,
      createdAt: l.createdAt.toISOString(),
      lastSyncedAt: l.lastSyncedAt?.toISOString() ?? null,
    })),
  });
}
