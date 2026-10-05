import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { HANDOVER_STAGES } from "@/lib/lead-status";
import { REMINDER_DAYS } from "@/lib/reminders";

// "Update your leads" (components/ClientUpdatesPanel.tsx): every handed-over
// lead the client hasn't reported back on (awaitingClientUpdate), from day 1,
// oldest handover first.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const where = { clientId, deletedAt: null, awaitingClientUpdate: true };
  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ handoverAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        stage: true,
        value: true,
        handoverAt: true,
        createdAt: true,
        // Handover type: the current stage, else the latest handover it had.
        stageEvents: { where: { stage: { in: HANDOVER_STAGES } }, orderBy: { at: "desc" }, take: 1, select: { stage: true } },
      },
    }),
  ]);
  // Leads with a 7-day reminder out (lib/reminders.ts) are flagged as tasks.
  const reminded = new Map(
    (
      await prisma.leadReminder.findMany({
        where: { leadId: { in: leads.map((l) => l.id) }, createdAt: { gt: new Date(Date.now() - REMINDER_DAYS * 86_400_000) } },
        select: { leadId: true, createdAt: true },
      })
    ).map((r) => [r.leadId, r.createdAt.toISOString()])
  );
  const rows = leads.map(({ stageEvents, handoverAt, createdAt, ...l }) => ({
    ...l,
    value: l.value == null ? null : Number(l.value),
    handoverType: HANDOVER_STAGES.includes(l.stage) ? l.stage : stageEvents[0]?.stage ?? null,
    // Same clock as the reminders: the handover, else the opt-in date.
    waitingSince: (handoverAt ?? createdAt).toISOString(),
    handoverAt: handoverAt?.toISOString() ?? null,
    remindedAt: reminded.get(l.id) ?? null,
  }));
  return NextResponse.json({ total, reminders: reminded.size, leads: rows });
}
