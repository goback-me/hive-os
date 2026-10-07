import { prisma } from "./prisma";
import { weekStart } from "./sheet-parse";
import { getRangeKpis } from "./kpi";
import { overdueLeads } from "./reminders";
import { terms } from "./client-terms";

// Weekly status updates: weeks start Monday, Sydney time.
export { weekStart };

// A starting draft for this week's update: the week's numbers so far, leads
// waiting on the client, and the account manager's open next steps — the
// coach edits it. (Internal data alerts stay out: the client reads this.)
export async function draftWeeklyUpdate(clientId: string, now = new Date()) {
  const from = weekStart(now);
  const [client, k, overdue, steps, call] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { clientType: true } }),
    getRangeKpis(clientId, { from, to: now }, now),
    overdueLeads(clientId, now),
    prisma.contactLog.findMany({
      where: { clientId, nextStep: { not: null }, OR: [{ nextStepDue: null }, { nextStepDue: { gte: from } }], contactedAt: { gte: new Date(now.getTime() - 21 * 86_400_000) } },
      orderBy: { contactedAt: "desc" },
      select: { nextStep: true, nextStepDue: true },
      take: 5,
    }),
    // The latest held weekly call (lib/weekly-meetings.ts) prefills the rest.
    prisma.weeklyMeeting.findFirst({ where: { clientId, status: "HELD", weekOf: { gte: new Date(now.getTime() - 14 * 86_400_000) } }, orderBy: { weekOf: "desc" }, select: { summary: true, nextSteps: true } }),
  ]);
  const t = terms(client?.clientType);
  const n = (v: number, one: string, many = `${one}s`) => `${v} ${v === 1 ? one : many}`;
  const wins = [
    `This week so far: ${n(k.leads, "lead")}, ${n(k.liveTransfers, "live transfer")}, ${n(k.consultsBooked, "consult")} booked, ${k.quotes} ${t.quotes.toLowerCase()}, ${k.sales} ${t.sales.toLowerCase()}${k.revenue ? ` ($${Math.round(k.revenue).toLocaleString()})` : ""}.`,
  ];
  const issues = overdue.length ? [`- ${n(overdue.length, "lead")} waiting 7+ days on your update — please mark them won or lost`] : [];
  const nextSteps = steps.map((s) => `- ${s.nextStep}${s.nextStepDue ? ` (by ${s.nextStepDue.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" })})` : ""}`);
  // A held weekly call's summary / next steps come first — the
  // agent's notes from talking to the client.
  if (call?.summary) wins.push(call.summary);
  if (call?.nextSteps) nextSteps.unshift(call.nextSteps);
  return { weekOf: from.toISOString(), wins: wins.join("\n"), issues: issues.join("\n") || "Nothing blocking.", nextSteps: nextSteps.join("\n") };
}
