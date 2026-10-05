import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canAccessClient, requireUser } from "@/lib/auth";
import { verifyActionToken } from "@/lib/action-token";
import { recordEmailClick } from "@/lib/email";
import { getRangeKpis } from "@/lib/kpi";
import { updatePanelWhere } from "@/lib/reminders";
import { RETURNABLE_STAGES, STAGE_LABELS } from "@/lib/lead-status";
import { MOOD_LABELS, callDateLabel } from "@/lib/weekly-meetings";
import { weekStart } from "@/lib/sheet-parse";
import { submitWeeklyMeeting } from "@/lib/actions";
import MeetingForm from "@/components/MeetingForm";
import Forbidden from "@/components/Forbidden";

export const dynamic = "force-dynamic";

// Log a weekly client call (lib/weekly-meetings.ts) — where the agent's
// email (?a=) lands. Team only; the week's numbers, the leads waiting on the
// client and the open alerts sit on top for context.
export default async function MeetingPage({ params, searchParams }: { params: { slug: string; id: string }; searchParams: { a?: string } }) {
  const user = await requireUser();
  const meeting = await prisma.weeklyMeeting.findUnique({ where: { id: params.id }, include: { client: { select: { id: true, name: true, slug: true } }, agent: { select: { name: true } } } });
  if (!meeting || meeting.client.slug !== params.slug) notFound();
  if (user.role !== "COACH" || !canAccessClient(user, meeting.clientId)) return <Forbidden />;

  const token = verifyActionToken(searchParams.a);
  if (token?.refIds.includes(meeting.id)) await recordEmailClick(searchParams.a);

  const from = weekStart(meeting.weekOf);
  const [kpis, waitingCount, waiting, alerts, leads] = await Promise.all([
    getRangeKpis(meeting.clientId, { from, to: new Date(from.getTime() + 7 * 86_400_000) }),
    prisma.lead.count({ where: updatePanelWhere(meeting.clientId) }),
    prisma.lead.findMany({ where: updatePanelWhere(meeting.clientId), select: { name: true, stage: true }, orderBy: { handoverAt: "asc" }, take: 8 }),
    prisma.dataAlert.findMany({ where: { clientId: meeting.clientId, status: "OPEN" }, select: { title: true, severity: true }, orderBy: { severity: "asc" } }),
    prisma.lead.findMany({ where: { clientId: meeting.clientId, deletedAt: null }, select: { id: true, name: true, phone: true, stage: true }, orderBy: { createdAt: "desc" }, take: 2000 }),
  ]);
  const day = callDateLabel(meeting.weekOf);
  const card = "card rounded-2xl p-5";

  return (
    <div className="p-10 max-w-[1000px] mx-auto space-y-5">
      <div>
        <Link href={`/clients/${meeting.client.slug}?tab=dashboard`} className="text-xs font-semibold" style={{ color: "var(--primary)" }}>
          ← {meeting.client.name}
        </Link>
        <h1 className="font-heading text-3xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>Weekly call — {day}</h1>
        <p style={{ color: "var(--text-secondary)" }}>{meeting.agent ? `${meeting.agent.name}'s call` : "No agent assigned"} with {meeting.client.name}.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className={card}>
          <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>THAT WEEK</p>
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            {kpis.leads} leads · {kpis.liveTransfers} live transfers · {kpis.consultsBooked} booked · {kpis.quotes} quotes · {kpis.sales} won
            {kpis.revenue ? ` ($${Math.round(kpis.revenue).toLocaleString("en-US")})` : ""}
          </p>
        </div>
        <div className={card}>
          <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>WAITING ON THE CLIENT ({waitingCount})</p>
          {waiting.length ? (
            waiting.map((l, i) => <p key={i} className="text-xs" style={{ color: "var(--text-primary)" }}>{l.name || "Unnamed lead"} · {STAGE_LABELS[l.stage]}</p>)
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Nothing waiting.</p>
          )}
        </div>
        <div className={card}>
          <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>OPEN ALERTS ({alerts.length})</p>
          {alerts.length ? (
            alerts.slice(0, 6).map((a, i) => <p key={i} className="text-xs" style={{ color: a.severity === "DANGER" ? "var(--danger)" : "var(--text-primary)" }}>{a.title}</p>)
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>None.</p>
          )}
        </div>
      </div>

      {meeting.status === "PENDING" ? (
        <MeetingForm
          meetingId={meeting.id}
          clientSlug={meeting.client.slug}
          leads={leads.map((l) => ({ id: l.id, label: [l.name || "Unnamed lead", l.phone].filter(Boolean).join(" · "), stage: STAGE_LABELS[l.stage], returnable: RETURNABLE_STAGES.includes(l.stage) }))}
          onSubmit={submitWeeklyMeeting}
        />
      ) : (
        <div className={card}>
          <p className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            {meeting.status === "HELD" ? "Call held" : "Call didn't happen"} · logged by {meeting.submittedBy ?? "—"}
          </p>
          {meeting.status === "HELD" ? (
            <div className="space-y-2 text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
              <p>{meeting.summary}</p>
              {meeting.issues && <p><b>Issues:</b> {meeting.issues}</p>}
              {meeting.nextSteps && <p><b>Next steps:</b> {meeting.nextSteps}</p>}
              {meeting.clientMood && <p><b>Mood:</b> {MOOD_LABELS[meeting.clientMood]}</p>}
              {meeting.leadsReturned.length > 0 && <p>{meeting.leadsReturned.length} lead(s) returned to chase up.</p>}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{meeting.notHeldReason}</p>
          )}
        </div>
      )}
    </div>
  );
}
