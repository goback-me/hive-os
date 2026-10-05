import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, canAccessClient } from "@/lib/auth";
import { HANDOVER_STAGES, type LeadStageValue } from "@/lib/lead-status";
import { REMINDER_DAYS, stepAnchor, updatePanelWhere } from "@/lib/reminders";

// "Update your leads" (components/ClientUpdatesPanel.tsx): every handed-over
// lead the client hasn't reported back on (awaitingClientUpdate), from day 1,
// plus booked / attended / quoted leads once a reminder has gone out for
// their stage (lib/reminders.ts) or they've gone stale — longest-waiting first.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (!canAccessClient(user, clientId)) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const leads = await prisma.lead.findMany({
    where: updatePanelWhere(clientId),
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      stage: true,
      value: true,
      awaitingClientUpdate: true,
      staleInStage: true,
      hiveStatusRaw: true,
      handoverAt: true,
      createdAt: true,
      stageEvents: { where: { source: { not: "INFERRED" } }, orderBy: { at: "asc" }, select: { stage: true, at: true } },
      reminders: { where: { createdAt: { gt: new Date(Date.now() - REMINDER_DAYS * 86_400_000) } }, take: 1, select: { createdAt: true } },
    },
  });

  const rows = leads
    .map(({ stageEvents, reminders, handoverAt, createdAt, awaitingClientUpdate, hiveStatusRaw, ...l }) => {
      const first = (s: LeadStageValue) => stageEvents.find((e) => e.stage === s)?.at ?? null;
      const since = stageEvents.filter((e) => e.stage === l.stage).at(-1)?.at ?? null;
      const handover = [...stageEvents].reverse().find((e) => HANDOVER_STAGES.includes(e.stage))?.stage ?? null;
      // ponytail: milestones here are the first stage event only (no note
      // dates) — close enough for "days waiting"; the reminders use the full rule.
      const waitingSince = stepAnchor({ stage: l.stage, awaiting: awaitingClientUpdate, handoverAt, createdAt, bookedAt: first("CONSULT_BOOKED"), attendedAt: first("CONSULT_ATTENDED"), quoteAt: first("QUOTE_SENT"), stageSince: since });
      return {
        ...l,
        value: l.value == null ? null : Number(l.value),
        awaiting: awaitingClientUpdate,
        // Which handover (live / attempted / text): the current stage, else the latest it had.
        handoverType: HANDOVER_STAGES.includes(l.stage) ? l.stage : handover,
        handoverAt: handoverAt?.toISOString() ?? null,
        // What HIVE STATUS says — the label when no handover is on record.
        sheetStatus: hiveStatusRaw?.trim() && !/^n\/?a$/i.test(hiveStatusRaw.trim()) ? hiveStatusRaw.trim() : null,
        waitingSince: waitingSince.toISOString(),
        remindedAt: reminders[0]?.createdAt.toISOString() ?? null,
      };
    })
    .sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));

  return NextResponse.json({ total: rows.length, reminders: rows.filter((r) => r.remindedAt).length, leads: rows.slice(0, 100) });
}
