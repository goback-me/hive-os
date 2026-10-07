import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/auth";
import { sydneyDay, sydneyLocalToDate, weekStart } from "@/lib/sheet-parse";
import { ACTIVE_CLIENT, OUTCOME_LABELS, slotLabel } from "@/lib/am-calls";
import { amScope } from "@/lib/am-scope";
import { getClientsHealth } from "@/lib/client-health";
import { rescheduleCallTo, saveCallSlot, scheduleCall } from "@/lib/actions";
import MyCalls, { type MyCallsData } from "@/components/MyCalls";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Account Management — the account managers' one view (where they land after
// sign-in): calls needing an update, today's, the week, then each client's
// last call, next call and history. Active clients only. ?am= = whose
// (admins default to everyone, coaches to their own; agents only theirs).
export default async function AccountManagementPage({ searchParams }: { searchParams: { am?: string; week?: string } }) {
  const user = await requireTeam();
  const scope = await amScope(user, searchParams.am);
  const team = user.isAgent ? [] : await prisma.user.findMany({ where: { role: { in: ["ADMIN", "COACH", "AGENT"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const now = new Date();
  const week = weekStart(isDay(searchParams.week) ? new Date(`${searchParams.week}T12:00:00+10:00`) : now);
  const [ty, tm, td] = sydneyDay(now).split("-").map(Number);
  const today = sydneyLocalToDate(ty, tm, td)!; // Sydney midnight
  // Calls: the chosen AM's (as call person), active clients only.
  const calls = { client: ACTIVE_CLIENT, ...(scope.am ? { callPersonId: scope.am } : {}), ...(scope.clientIds ? { clientId: { in: scope.clientIds } } : {}) };

  const callSelect = { id: true, clientId: true, scheduledAt: true, status: true, client: { select: { name: true, slug: true } }, callPerson: { select: { name: true } } } as const;
  const [needs, todays, weekCalls, clients] = await Promise.all([
    prisma.amCall.findMany({ where: { ...calls, status: "PENDING", scheduledAt: { lt: now } }, orderBy: { scheduledAt: "asc" }, select: callSelect }),
    prisma.amCall.findMany({ where: { ...calls, scheduledAt: { gte: today, lt: new Date(today.getTime() + DAY + 2 * 3_600_000) } }, orderBy: { scheduledAt: "asc" }, select: callSelect }),
    prisma.amCall.findMany({ where: { ...calls, scheduledAt: { gte: week, lt: new Date(week.getTime() + 7 * DAY + 2 * 3_600_000) } }, orderBy: { scheduledAt: "asc" }, select: callSelect }),
    prisma.client.findMany({
      where: { ...ACTIVE_CLIENT, ...(scope.am ? { accountManagerId: scope.am } : {}), ...(scope.clientIds ? { id: { in: scope.clientIds } } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, accountManagerId: true, callDay: true, callTime: true, callFrequency: true, accountManager: { select: { name: true } } },
    }),
  ]);
  const ids = clients.map((c) => c.id);
  const [nextCalls, lastCalls, health] = await Promise.all([
    prisma.amCall.findMany({ where: { clientId: { in: ids }, status: "PENDING", scheduledAt: { gt: now } }, orderBy: { scheduledAt: "asc" }, distinct: ["clientId"], select: { id: true, clientId: true, scheduledAt: true } }),
    prisma.amCall.findMany({
      where: { clientId: { in: ids }, scheduledAt: { lte: now }, status: { not: "RESCHEDULED" } },
      orderBy: { scheduledAt: "desc" },
      distinct: ["clientId"],
      select: { id: true, clientId: true, scheduledAt: true, status: true, summary: true, outcome: true, notHeldReason: true },
    }),
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
        slotLabel: c.accountManagerId ? slotLabel(c) : "No account manager",
        next: next ? { id: next.id, at: next.scheduledAt.toISOString() } : null,
        last: last
          ? { id: last.id, at: last.scheduledAt.toISOString(), status: last.status, review: last.status === "NOT_HELD" ? last.notHeldReason : last.summary, outcome: last.outcome ? OUTCOME_LABELS[last.outcome] : null }
          : null,
        health: health.get(c.id)!,
      };
    }),
  };

  return (
    <MyCalls
      data={data}
      filter={scope.canPick ? { value: scope.value, team } : null}
      showAm={!scope.am}
      canEditSlot={!user.isAgent}
      team={user.isAgent ? null : team}
      onSaveSlot={saveCallSlot}
      onReschedule={rescheduleCallTo}
      onSchedule={scheduleCall}
    />
  );
}
