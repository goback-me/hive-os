import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, canAccessClient } from "@/lib/auth";
import { getMonthToDateVsLast, toneFor } from "@/lib/kpi";
import { terms } from "@/lib/client-terms";
import { updatePanelWhere } from "@/lib/reminders";
import { RETURNABLE_STAGES, STAGE_LABELS } from "@/lib/lead-status";
import { TEAM_CALL_SELECT } from "@/lib/am-calls";

// The call update panel (components/CallUpdatePanel.tsx): the call, and the
// context to log it — this month's numbers, the leads waiting on the client,
// the last call's next steps, open alerts — plus the client's leads for the
// pickers. Team only (a CLIENT gets 403: internal notes / outcome are here).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const call = await prisma.amCall.findUnique({
    where: { id: params.id },
    select: { ...TEAM_CALL_SELECT, clientId: true, leadsDiscussed: true, client: { select: { name: true, slug: true, clientType: true, callTime: true } } },
  });
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });
  const user = await requireUser();
  if (user.role !== "COACH" || !canAccessClient(user, call.clientId)) return NextResponse.json({ error: "Not authorized for this call" }, { status: 403 });

  const [month, waitingCount, waiting, alerts, lastHeld, leads, movedTo] = await Promise.all([
    getMonthToDateVsLast(call.clientId),
    prisma.lead.count({ where: updatePanelWhere(call.clientId) }),
    prisma.lead.findMany({ where: updatePanelWhere(call.clientId), select: { id: true, name: true, stage: true }, orderBy: { handoverAt: "asc" }, take: 8 }),
    prisma.dataAlert.findMany({ where: { clientId: call.clientId, status: "OPEN" }, select: { title: true, severity: true }, orderBy: { severity: "asc" }, take: 6 }),
    prisma.amCall.findFirst({ where: { clientId: call.clientId, status: "HELD", id: { not: call.id }, scheduledAt: { lte: call.scheduledAt } }, orderBy: { scheduledAt: "desc" }, select: { scheduledAt: true, nextSteps: true } }),
    prisma.lead.findMany({ where: { clientId: call.clientId, deletedAt: null }, select: { id: true, name: true, phone: true, stage: true }, orderBy: { createdAt: "desc" }, take: 2000 }),
    call.status === "RESCHEDULED" ? prisma.amCall.findFirst({ where: { rescheduledFromId: call.id }, select: { id: true, scheduledAt: true } }) : null,
  ]);
  const t = terms(call.client.clientType);
  const kpi = (label: string, k: "leads" | "liveTransfers" | "consultsBooked" | "quotes" | "sales") => ({ label, now: month.current[k], before: month.previous[k], tone: toneFor("count", month.current[k], month.previous[k]) });

  return NextResponse.json({
    call: { ...call, scheduledAt: call.scheduledAt.toISOString() },
    movedTo: movedTo ? { id: movedTo.id, at: movedTo.scheduledAt.toISOString() } : null,
    context: {
      kpis: [kpi("Leads", "leads"), kpi("Live transfers", "liveTransfers"), kpi("Consults booked", "consultsBooked"), kpi(t.quotes, "quotes"), kpi(t.sales, "sales")],
      waitingCount,
      waiting: waiting.map((l) => ({ id: l.id, name: l.name || "Unnamed lead", stage: STAGE_LABELS[l.stage] })),
      lastSteps: lastHeld ? { at: lastHeld.scheduledAt.toISOString(), steps: lastHeld.nextSteps } : null,
      alerts,
    },
    leads: leads.map((l) => ({ id: l.id, label: [l.name || "Unnamed lead", l.phone].filter(Boolean).join(" · "), stage: STAGE_LABELS[l.stage], returnable: RETURNABLE_STAGES.includes(l.stage) })),
  });
}
