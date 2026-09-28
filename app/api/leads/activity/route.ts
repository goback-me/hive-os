import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// Lazy-loaded only when a lead's "Details" row is expanded (components/LeadsPanel.tsx)
// — keeps the paginated lead list itself light.
export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("leadId");
  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { clientId: true, deletedAt: true } });
  if (!lead || lead.deletedAt) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const user = await requireUser();
  if (user.role === "CLIENT" && lead.clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const activity = await prisma.leadActivity.findMany({ where: { leadId }, orderBy: { changedAt: "desc" } });
  return NextResponse.json({
    activity: activity.map((a) => ({
      id: a.id,
      fromStatus: a.fromStatus,
      toStatus: a.toStatus,
      value: a.value ? Number(a.value) : null,
      changedBy: a.changedBy,
      changedAt: a.changedAt.toISOString(),
    })),
  });
}
