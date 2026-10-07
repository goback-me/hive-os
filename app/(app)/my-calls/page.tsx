import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/auth";
import { sydneyDay, sydneyLocalToDate, weekStart } from "@/lib/sheet-parse";
import { slotLabel } from "@/lib/am-calls";
import { getClientsHealth } from "@/lib/client-health";
import { moveCallTime, rescheduleCallTo, saveCallSlot, scheduleCall } from "@/lib/actions";
import MyCalls, { type MyCallsData } from "@/components/MyCalls";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

// My Calls — an account manager's one view (and where they land after
// sign-in): calls needing an update, today's, the week, and all their
// clients. An admin can look at any AM's (or everyone's) with ?am=.
export default async function MyCallsPage({ searchParams }: { searchParams: { am?: string; week?: string } }) {
  const user = await requireTeam();
  const me = await prisma.user.findUnique({ where: { clerkId: user.clerkId }, select: { id: true } });
  const team = user.isAdmin ? await prisma.user.findMany({ where: { role: { in: ["ADMIN", "COACH", "AGENT"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  // Only an admin picks; everyone else sees their own.
  const am = user.isAdmin && searchParams.am && (searchParams.am === "all" || team.some((t) => t.id === searchParams.am)) ? searchParams.am : me?.id ?? "__none__";
  const mine = am === "all" ? {} : { callPersonId: am };
  const now = new Date();
  const week = weekStart(isDay(searchParams.week) ? new Date(`${searchParams.week}T12:00:00+10:00`) : now);
  const [ty, tm, td] = sydneyDay(now).split("-").map(Number);
  const today = sydneyLocalToDate(ty, tm, td)!; // Sydney midnight

  const callSelect = { id: true, clientId: true, scheduledAt: true, status: true, client: { select: { name: true, slug: true } }, callPerson: { select: { name: true } } } as const;
  const [needs, todays, weekCalls, clients] = await Promise.all([
    prisma.amCall.findMany({ where: { ...mine, status: "PENDING", scheduledAt: { lt: now } }, orderBy: { scheduledAt: "asc" }, select: callSelect }),
    prisma.amCall.findMany({ where: { ...mine, scheduledAt: { gte: today, lt: new Date(today.getTime() + DAY + 2 * 3_600_000) } }, orderBy: { scheduledAt: "asc" }, select: callSelect }),
    prisma.amCall.findMany({ where: { ...mine, scheduledAt: { gte: week, lt: new Date(week.getTime() + 7 * DAY + 2 * 3_600_000) } }, orderBy: { scheduledAt: "asc" }, select: callSelect }),
    prisma.client.findMany({
      where: { archivedAt: null, ...(am === "all" ? {} : { accountManagerId: am }), ...(user.isAgent ? { id: { in: user.agentClientIds } } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, accountManagerId: true, callDay: true, callTime: true, callFrequency: true, accountManager: { select: { name: true } } },
    }),
  ]);
  const ids = clients.map((c) => c.id);
  const [nextCalls, lastCalls, awaiting, health] = await Promise.all([
    prisma.amCall.findMany({ where: { clientId: { in: ids }, status: "PENDING", scheduledAt: { gt: now } }, orderBy: { scheduledAt: "asc" }, distinct: ["clientId"], select: { id: true, clientId: true, scheduledAt: true } }),
    prisma.amCall.findMany({ where: { clientId: { in: ids }, scheduledAt: { lte: now }, status: { not: "RESCHEDULED" } }, orderBy: { scheduledAt: "desc" }, distinct: ["clientId"], select: { clientId: true, scheduledAt: true, status: true } }),
    prisma.lead.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, deletedAt: null, awaitingClientUpdate: true }, _count: true }),
    getClientsHealth(ids, { now }),
  ]);

  const item = (c: (typeof needs)[number]) => ({ id: c.id, clientId: c.clientId, clientName: c.client.name, clientSlug: c.client.slug, scheduledAt: c.scheduledAt.toISOString(), status: c.status, callPerson: c.callPerson?.name ?? null });
  // Today = the Sydney calendar day (the +2h above only covers DST edges).
  const todayKey = sydneyDay(now);
  const data: MyCallsData = {
    now: now.toISOString(),
    needsUpdate: needs.map(item),
    today: todays.filter((c) => sydneyDay(c.scheduledAt) === todayKey).map(item),
    week: {
      start: sydneyDay(week),
      days: Array.from({ length: 7 }, (_, i) => sydneyDay(new Date(week.getTime() + i * DAY + 12 * 3_600_000))),
      calls: weekCalls.map(item),
    },
    clients: clients.map((c) => {
      const next = nextCalls.find((n) => n.clientId === c.id);
      const last = lastCalls.find((l) => l.clientId === c.id);
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        am: c.accountManager?.name ?? null,
        slot: { accountManagerId: c.accountManagerId, callDay: c.callDay, callTime: c.callTime, callFrequency: c.callFrequency },
        slotLabel: slotLabel(c),
        next: next ? { id: next.id, at: next.scheduledAt.toISOString() } : null,
        last: last ? { at: last.scheduledAt.toISOString(), status: last.status } : null,
        health: health.get(c.id)!,
        awaiting: awaiting.find((a) => a.clientId === c.id)?._count ?? 0,
      };
    }),
  };

  return (
    <MyCalls
      data={data}
      filter={user.isAdmin ? { value: am, team } : null}
      canEditSlot={!user.isAgent}
      onSaveSlot={saveCallSlot}
      onMove={moveCallTime}
      onReschedule={rescheduleCallTo}
      onSchedule={scheduleCall}
    />
  );
}

