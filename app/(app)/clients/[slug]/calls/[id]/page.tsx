import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canAccessClient, requireUser } from "@/lib/auth";
import { verifyActionToken } from "@/lib/action-token";
import { recordEmailClick } from "@/lib/email";
import { getMonthToDateVsLast, toneFor } from "@/lib/kpi";
import { terms } from "@/lib/client-terms";
import { updatePanelWhere } from "@/lib/reminders";
import { RETURNABLE_STAGES, STAGE_LABELS } from "@/lib/lead-status";
import { MOOD_LABELS, callDateLabel, splitSteps } from "@/lib/weekly-meetings";
import { submitWeeklyMeeting } from "@/lib/actions";
import MeetingForm from "@/components/MeetingForm";
import Forbidden from "@/components/Forbidden";

export const dynamic = "force-dynamic";

// Log an account-manager call (lib/weekly-meetings.ts) — where the AM's email
// (?a=) lands; signed-out visitors go through Clerk sign-in and come back here
// (middleware.ts). Team only: a CLIENT gets Forbidden. This month's numbers,
// the leads waiting on the client and the open alerts sit on top for context.
export default async function CallPage({ params, searchParams }: { params: { slug: string; id: string }; searchParams: { a?: string } }) {
  const user = await requireUser();
  const call = await prisma.weeklyMeeting.findUnique({ where: { id: params.id }, include: { client: { select: { id: true, name: true, slug: true, clientType: true } }, agent: { select: { name: true } } } });
  if (!call || call.client.slug !== params.slug) notFound();
  if (user.role !== "COACH" || !canAccessClient(user, call.clientId)) return <Forbidden />;

  const token = verifyActionToken(searchParams.a);
  if (token?.refIds.includes(call.id)) await recordEmailClick(searchParams.a);

  const [month, waitingCount, waiting, alerts, leads] = await Promise.all([
    getMonthToDateVsLast(call.clientId),
    prisma.lead.count({ where: updatePanelWhere(call.clientId) }),
    prisma.lead.findMany({ where: updatePanelWhere(call.clientId), select: { name: true, stage: true }, orderBy: { handoverAt: "asc" }, take: 8 }),
    prisma.dataAlert.findMany({ where: { clientId: call.clientId, status: "OPEN" }, select: { title: true, severity: true }, orderBy: { severity: "asc" } }),
    prisma.lead.findMany({ where: { clientId: call.clientId, deletedAt: null }, select: { id: true, name: true, phone: true, stage: true }, orderBy: { createdAt: "desc" }, take: 2000 }),
  ]);
  const t = terms(call.client.clientType);
  const kpis = [
    ["Leads", month.current.leads, month.previous.leads],
    ["Live transfers", month.current.liveTransfers, month.previous.liveTransfers],
    ["Consults booked", month.current.consultsBooked, month.previous.consultsBooked],
    [t.quotes, month.current.quotes, month.previous.quotes],
    [t.sales, month.current.sales, month.previous.sales],
  ] as const;
  const toneColor = { red: "var(--danger)", amber: "var(--tag-amber-fg)", green: "var(--tag-green-fg)" };
  const day = callDateLabel(call.weekOf);
  const card = "card rounded-2xl p-5";
  const label = "text-xs font-bold mb-2";

  return (
    <div className="p-10 max-w-[1000px] mx-auto space-y-5">
      <div>
        <Link href={`/clients/${call.client.slug}?tab=weekly`} className="text-xs font-semibold" style={{ color: "var(--primary)" }}>
          ← {call.client.name}
        </Link>
        <h1 className="font-heading text-3xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>Account manager call — {day}</h1>
        <p style={{ color: "var(--text-secondary)" }}>{call.agent ? `${call.agent.name}'s call` : "No account manager assigned"} with {call.client.name}.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className={card}>
          <p className={label} style={{ color: "var(--text-secondary)" }}>THIS MONTH (vs same days last month)</p>
          {kpis.map(([name, now, before]) => {
            const tone = toneFor("count", now, before);
            return (
              <p key={name} className="text-xs flex justify-between" style={{ color: "var(--text-primary)" }}>
                <span>{name}</span>
                <span style={{ color: tone ? toneColor[tone] : undefined }}>
                  {now} <span style={{ color: "var(--text-muted)" }}>/ {before}</span>
                </span>
              </p>
            );
          })}
        </div>
        <div className={card}>
          <p className={label} style={{ color: "var(--text-secondary)" }}>WAITING ON THE CLIENT ({waitingCount})</p>
          {waiting.length ? (
            waiting.map((l, i) => <p key={i} className="text-xs" style={{ color: "var(--text-primary)" }}>{l.name || "Unnamed lead"} · {STAGE_LABELS[l.stage]}</p>)
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Nothing waiting.</p>
          )}
        </div>
        <div className={card}>
          <p className={label} style={{ color: "var(--text-secondary)" }}>OPEN ALERTS ({alerts.length})</p>
          {alerts.length ? (
            alerts.slice(0, 6).map((a, i) => <p key={i} className="text-xs" style={{ color: a.severity === "DANGER" ? "var(--danger)" : "var(--text-primary)" }}>{a.title}</p>)
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>None.</p>
          )}
        </div>
      </div>

      {call.status === "PENDING" ? (
        <MeetingForm
          meetingId={call.id}
          clientSlug={call.client.slug}
          leads={leads.map((l) => ({ id: l.id, label: [l.name || "Unnamed lead", l.phone].filter(Boolean).join(" · "), stage: STAGE_LABELS[l.stage], returnable: RETURNABLE_STAGES.includes(l.stage) }))}
          onSubmit={submitWeeklyMeeting}
        />
      ) : (
        <div className={`${card} space-y-3 text-sm`} style={{ color: "var(--text-secondary)" }}>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {call.status === "HELD" ? "Call held" : "Call didn't happen"} · logged by {call.submittedBy ?? "—"}
            {call.status === "HELD" && (call.emailedToClientAt ? " · emailed to the client" : " · not emailed")}
          </p>
          {call.status === "HELD" ? (
            <>
              <p className="whitespace-pre-wrap">{call.summary}</p>
              {splitSteps(call.nextSteps).length > 0 && (
                <ul className="list-disc pl-5">
                  {splitSteps(call.nextSteps).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
              <p>
                {[call.nextMeetingAt && `Next call ${callDateLabel(call.nextMeetingAt)}`, call.durationMins && `${call.durationMins} mins`, call.leadsReturned.length > 0 && `${call.leadsReturned.length} lead(s) returned to chase up`].filter(Boolean).join(" · ")}
              </p>
              {(call.internalNotes || call.clientMood) && (
                <div className="rounded-xl p-3" style={{ background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }}>
                  <p className="text-xs font-bold mb-1">Internal — not visible to client</p>
                  {call.clientMood && <p>Outcome: {MOOD_LABELS[call.clientMood]}</p>}
                  {call.internalNotes && <p className="whitespace-pre-wrap">{call.internalNotes}</p>}
                </div>
              )}
            </>
          ) : (
            <p>{call.notHeldReason}</p>
          )}
        </div>
      )}
    </div>
  );
}
