import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  toggleOnboardingStep,
  saveGameplanLink,
  saveClientGoals,
  toggleLessonComplete,
  createModule,
  createLesson,
  createProgressNote,
  syncClientLeads,
  updateLeadStage,
  addLeadNote,
  getOrCreateClientReferralLink,
  saveReportVisibility,
  saveClientStartDate,
  setCampaignReporting,
  rebuildKpiHistory,
  saveClientType,
  recheckClientHealth,
  logContact,
  saveWeeklyUpdate,
  getWeeklyDraft,
  saveClientIntegrations,
  sendSlackTest,
  createManualClickUpTask,
  saveCycleOverrides,
  recalculateClientCycle,
} from "@/lib/actions";
import { CYCLE_SAMPLE_NOUN, CYCLE_STEPS, CYCLE_STEP_LABELS, getClientCycle, parseCycleOverrides } from "@/lib/buying-cycle";
import BuyingCycleCard from "@/components/BuyingCycleCard";
import { requireClientAccess } from "@/lib/auth";
import { checkAndGrantAwards } from "@/lib/awards";
import { STAGE_LABELS, STAGE_STYLE } from "@/lib/lead-status";
import { sydneyDay } from "@/lib/sheet-parse";
import { getClientStats, statsForViewer } from "@/lib/client-stats";
import { resolveReportRange } from "@/lib/date-range";
import { getSnapshot } from "@/lib/kpi";
import { parseVisibility } from "@/lib/report-visibility";
import DashboardStats from "@/components/DashboardStats";
import SnapshotPanel from "@/components/SnapshotPanel";
import ReportVisibilityCard from "@/components/ReportVisibilityCard";
import LeadsPanel from "@/components/LeadsPanel";
import ClientTabsShell from "@/components/ClientTabsShell";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import GameplanPanel from "@/components/GameplanPanel";
import PlaybooksPanel from "@/components/PlaybooksPanel";
import AdsPanel from "@/components/AdsPanel";
import AwardsPanel from "@/components/AwardsPanel";
import ProgressNotesPanel from "@/components/ProgressNotesPanel";
import ClientReferralPanel from "@/components/ClientReferralPanel";
import MetaAdsCard from "@/components/MetaAdsCard";
import GoalsCard from "@/components/GoalsCard";
import StartDateField from "@/components/StartDateField";
import ClientUpdatesPanel from "@/components/ClientUpdatesPanel";
import ClientTypeField from "@/components/ClientTypeField";
import GrowthPanel from "@/components/GrowthPanel";
import HoldNote from "@/components/HoldNote";
import ClientAlertsBanner from "@/components/ClientAlertsBanner";
import ContactLogPanel from "@/components/ContactLogPanel";
import WeeklyUpdatesPanel from "@/components/WeeklyUpdatesPanel";
import { updatePanelWhere } from "@/lib/reminders";
import IntegrationsCard from "@/components/IntegrationsCard";
import { parseSlackEvents } from "@/lib/slack";
import { weekStart } from "@/lib/weekly";
import { reportsOnHold } from "@/lib/report-hold";

// Forces this page to render fresh on every single request — no static
// caching, no ISR.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function ClientDetailPage({ params }: { params: { slug: string } }) {
  const client = await prisma.client.findUnique({ where: { slug: params.slug } });
  if (!client) notFound();

  // A client login gets bounced to /dashboard (which redirects to their own
  // slug) if they try to view anyone else's page. A coach can view any client.
  const viewer = await requireClientAccess(client.id);
  const isCoach = viewer.role === "COACH";
  const visibility = parseVisibility(client.reportVisibility);
  // A report-breaking data problem is open → a client sees "Data being
  // updated" instead of any numbers (coaches see everything + the alert).
  const hold = !isCoach && (await reportsOnHold(client.id));

  // Everything below is independent, so it all runs at once — the page used
  // to wait on each step (awards, then queries, then the funnel, then Meta)
  // in turn. The Leads tab loads its own funnel client-side, so the page
  // doesn't compute one here any more.
  const [
    ,
    rawStats,
    snapshot,
    referralLink,
    onboardingTemplates,
    onboardingProgress,
    modules,
    lessonProgress,
    awardTiers,
    clientAwards,
    recentLeads,
    progressNotes,
    clientSheet,
    awaitingUpdates,
    cycle,
  ] = await Promise.all([
    // Re-checks revenue/module thresholds against award tiers on every visit —
    // not just when a lesson gets toggled — so editing a tier's threshold or a
    // payment landing doesn't require an unrelated action to unlock it.
    checkAndGrantAwards(client.id),
    // Dashboard cards' first paint (This month); the range picker refetches.
    getClientStats(client.id, resolveReportRange({ preset: "this_month" }), false),
    // Snapshot KPI cards (current Sydney month); the month picker refetches.
    getSnapshot(client.id, null, viewer, visibility),
    // Lazily provisions a referral link for clients that existed before this
    // feature — new clients already get one at creation (see createClient).
    getOrCreateClientReferralLink(client.id, client.name),
    prisma.onboardingStepTemplate.findMany({ orderBy: { order: "asc" } }),
    prisma.clientOnboardingStep.findMany({ where: { clientId: client.id } }),
    prisma.module.findMany({ orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" } } } }),
    prisma.clientLessonProgress.findMany({ where: { clientId: client.id, completedAt: { not: null } } }),
    prisma.awardTier.findMany({ orderBy: { order: "asc" } }),
    prisma.clientAward.findMany({ where: { clientId: client.id } }),
    // Same order as the Leads tab; skips blank sheet rows (no name/phone/email).
    prisma.lead.findMany({
      where: { clientId: client.id, deletedAt: null, OR: [{ name: { not: "" } }, { phone: { not: "" } }, { email: { not: "" } }] },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.progressNote.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.clientSheet.findUnique({ where: { clientId: client.id } }),
    // The Dashboard tab's "N leads need an update" badge.
    prisma.lead.count({ where: updatePanelWhere(client.id) }),
    // Coaches: the buying cycle card (lib/buying-cycle.ts).
    isCoach ? getClientCycle(client.id) : null,
  ]);
  const cycleOverrides = parseCycleOverrides(client.cycleOverrides);

  // Coaches: this client's open data alerts (lib/data-health.ts).
  const openAlerts = isCoach
    ? await prisma.dataAlert.findMany({ where: { clientId: client.id, status: "OPEN" }, orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }] })
    : [];

  const [contacts, weeklyUpdates] = await Promise.all([
    isCoach ? prisma.contactLog.findMany({ where: { clientId: client.id }, orderBy: { contactedAt: "desc" }, take: 10 }) : Promise.resolve([]),
    prisma.weeklyUpdate.findMany({ where: { clientId: client.id }, orderBy: { weekOf: "desc" }, take: 12 }),
  ]);

  const referrals = await prisma.referral.findMany({ where: { referralLinkId: referralLink.id }, orderBy: { createdAt: "desc" } });

  // Hidden fields (profit, spend) never reach a CLIENT's browser.
  const stats = statsForViewer(rawStats, viewer.role, visibility);
  const lifetimeRevenue = stats.lifetimeRevenue;
  // Remount the cards when the coach flips a visibility toggle, so badges and
  // the server-filtered card list follow the new settings straight away.
  const visibilityKey = JSON.stringify(visibility);

  const earnedTierIds = new Set(clientAwards.map((a) => a.awardTierId));
  const nextTier = awardTiers.find((t) => !earnedTierIds.has(t.id) && t.thresholdRevenue);
  const nextTierRemaining = nextTier ? Math.max(Number(nextTier.thresholdRevenue) - lifetimeRevenue, 0) : 0;

  const dashboardContent = (
    <div className="space-y-5">
      {/* The client's monthly snapshot comes first. */}
      {hold ? (
        <HoldNote />
      ) : (
        <>
          <SnapshotPanel key={`snap-${visibilityKey}`} clientId={client.id} initial={snapshot} isCoach={isCoach} onRebuild={isCoach ? rebuildKpiHistory : undefined} />
          <DashboardStats key={`stats-${visibilityKey}`} clientId={client.id} initial={stats} isCoach={isCoach} />
        </>
      )}

      <div className="grid grid-cols-3 gap-5">
        {/* Main column — the day-to-day, coaching-relevant activity */}
        <div className="col-span-2 space-y-5">
          <WeeklyUpdatesPanel
            clientId={client.id}
            isCoach={isCoach}
            currentWeekOf={weekStart().toISOString()}
            initial={weeklyUpdates.map((u) => ({ id: u.id, weekOf: u.weekOf.toISOString(), wins: u.wins, issues: u.issues, nextSteps: u.nextSteps, createdBy: u.createdBy }))}
            onDraft={isCoach ? getWeeklyDraft : undefined}
            onSave={isCoach ? saveWeeklyUpdate : undefined}
          />

          {clientSheet && <ClientUpdatesPanel clientId={client.id} onUpdateStage={updateLeadStage} />}

          <div className="card rounded-2xl p-5">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Leads</p>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{recentLeads.length} recent</span>
            </div>
            {recentLeads.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No leads logged yet.</p>
            ) : (
              <div className="space-y-1">
                {recentLeads.map((l) => {
                  const st = STAGE_STYLE[l.stage];
                  return (
                    <div key={l.id} className="flex items-center justify-between py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                      <div className="flex items-center gap-3">
                        <span className="icon-chip w-8 h-8" style={{ background: "var(--surface-hover)" }}>
                          <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--text-secondary)" }}>person_search</span>
                        </span>
                        <div>
                          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{l.name || l.phone || l.email || "Unnamed lead"}</p>
                          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {[
                              l.name ? l.phone || l.email : null,
                              l.source || l.campaign,
                              l.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                              l.value ? `$${Number(l.value).toLocaleString()}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: st.bg, color: st.color }}>
                        {STAGE_LABELS[l.stage]}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <ProgressNotesPanel
            clientId={client.id}
            initialNotes={progressNotes.map((n) => ({ id: n.id, note: n.note, createdBy: n.createdBy, createdAt: n.createdAt.toISOString() }))}
            onAddNote={createProgressNote}
          />
        </div>

        {/* Side column — who they are + how close to the next milestone */}
        <div className="space-y-5">
          <div className="card rounded-2xl p-5">
            <p className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Client Details</p>
            <dl className="space-y-3 text-sm">
              <DetailRow icon="mail" label="Email" value={client.email ?? "—"} />
              {client.scope && <DetailRow icon="task_alt" label="Scope" value={client.scope} />}
              <DetailRow icon="calendar_today" label="Joined" value={client.joinedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />
              <StartDateField clientId={client.id} initial={client.startDate ? sydneyDay(client.startDate) : ""} isCoach={isCoach} onSave={saveClientStartDate} />
              <ClientTypeField clientId={client.id} initial={client.clientType} isCoach={isCoach} onSave={saveClientType} />
            </dl>
          </div>

          {isCoach && (
            <ContactLogPanel
              clientId={client.id}
              me={viewer.name}
              onLog={logContact}
              initial={contacts.map((c) => ({ id: c.id, contactedAt: c.contactedAt.toISOString(), method: c.method, loggedBy: c.loggedBy, notes: c.notes, nextStep: c.nextStep, nextStepDue: c.nextStepDue?.toISOString() ?? null }))}
            />
          )}

          {isCoach && <ReportVisibilityCard clientId={client.id} initial={visibility} onSave={saveReportVisibility} />}

          {isCoach && (
            <IntegrationsCard
              clientId={client.id}
              initial={{ slackChannelId: client.slackChannelId ?? "", slackEvents: parseSlackEvents(client.slackEvents), clickupListId: client.clickupListId ?? "" }}
              onSave={saveClientIntegrations}
              onTest={sendSlackTest}
              onCreateTask={createManualClickUpTask}
            />
          )}

          {cycle && (
            <BuyingCycleCard
              clientId={client.id}
              rows={CYCLE_STEPS.map((step) => ({ ...cycle[step], step, label: CYCLE_STEP_LABELS[step], noun: CYCLE_SAMPLE_NOUN[step], override: cycleOverrides[step] ?? null }))}
              computedAt={cycle.computedAt?.toISOString() ?? null}
              onSave={saveCycleOverrides}
              onRecalculate={recalculateClientCycle}
            />
          )}

          <GoalsCard clientId={client.id} initialGoals={client.goals} onSave={saveClientGoals} />

          <div className="card rounded-2xl p-5">
            <p className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Awards Progress</p>
            <p className="font-heading text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
              {clientAwards.length} <span className="text-sm font-normal" style={{ color: "var(--text-secondary)" }}>of {awardTiers.length} tiers earned</span>
            </p>
            {nextTier ? (
              <>
                <div className="h-2 rounded-full mt-3 mb-2" style={{ background: "var(--surface-hover)" }}>
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${Math.min((lifetimeRevenue / Number(nextTier.thresholdRevenue)) * 100, 100)}%`,
                      background: "var(--primary)",
                    }}
                  />
                </div>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  ${nextTierRemaining.toLocaleString()} to <strong style={{ color: "var(--text-primary)" }}>{nextTier.name}</strong>
                </p>
              </>
            ) : (
              <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>All revenue-based tiers earned.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const onboardingContent = (
    <OnboardingChecklist
      clientId={client.id}
      templates={onboardingTemplates.map((t) => ({ id: t.id, title: t.title, description: t.description, icon: t.icon }))}
      progress={onboardingProgress.map((p) => ({ templateId: p.templateId, completedAt: p.completedAt?.toISOString() ?? null }))}
      onToggle={toggleOnboardingStep}
    />
  );

  const gameplanContent = (
    <GameplanPanel clientId={client.id} currentLink={client.gameplanFigmaLink} onSave={saveGameplanLink} />
  );

  const playbooksContent = (
    <PlaybooksPanel
      clientId={client.id}
      modules={modules.map((m) => ({
        id: m.id,
        title: m.title,
        lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, videoUrl: l.videoUrl, content: l.content })),
      }))}
      completedLessonIds={lessonProgress.map((p) => p.lessonId)}
      onToggle={toggleLessonComplete}
      onCreateModule={createModule}
      onCreateLesson={createLesson}
    />
  );

  const adsContent = (
    <div className="space-y-6">
      {/* Campaigns + spend load client-side (/api/ads) — Meta's live list once
          connected, else the manually tracked AdCampaign rows. */}
      {hold ? <HoldNote /> : <AdsPanel clientId={client.id} isCoach={isCoach} onSetReporting={setCampaignReporting} />}
      {/* Hive OS — Meta Marketing API connection for this client, merged in
          alongside the original coaching app's own manually-tracked AdCampaign rows above. */}
      <MetaAdsCard clientId={client.id} connected={Boolean(client.metaAdAccountId)} adAccountId={client.metaAdAccountId} />
    </div>
  );

  const earnedAtByTierId = new Map(clientAwards.map((a) => [a.awardTierId, a.earnedAt.toISOString()]));
  const awardsContent = (
    <AwardsPanel
      tiers={awardTiers.map((t) => ({ id: t.id, name: t.name, subtitle: t.subtitle, thresholdRevenue: t.thresholdRevenue ? Number(t.thresholdRevenue) : null }))}
      earnedTierIds={clientAwards.map((a) => a.awardTierId)}
      earnedAtByTierId={Object.fromEntries(earnedAtByTierId)}
      lifetimeRevenue={lifetimeRevenue}
    />
  );

  const referralsContent = (
    <ClientReferralPanel
      code={referralLink.code}
      referrals={referrals.map((r) => ({ id: r.id, name: r.name, stage: r.stage, createdAt: r.createdAt.toISOString() }))}
    />
  );

  const leadsContent = (
    <LeadsPanel
      clientId={client.id}
      viewerRole={viewer.role}
      hasSheet={Boolean(clientSheet)}
      clientSlug={client.slug}
      startDate={client.startDate?.toISOString() ?? null}
      reportsHold={hold}
      lastSyncedAt={clientSheet?.lastSyncedAt?.toISOString() ?? null}
      lastSyncError={clientSheet?.lastSyncError ?? null}
      onSync={syncClientLeads}
      onUpdateStage={updateLeadStage}
      onAddNote={addLeadNote}
    />
  );

  return (
    <div className="p-10 max-w-[1500px] mx-auto">
      <div className="flex items-center gap-1.5 text-sm mb-4">
        <Link href="/clients" style={{ color: "var(--text-secondary)" }}>Clients</Link>
        <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--text-muted)" }}>chevron_right</span>
        <span style={{ color: "var(--text-primary)" }} className="font-medium">{client.name}</span>
      </div>

      <div className="flex items-center gap-5 mb-8">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-2xl" style={{ background: "var(--primary-tint)", color: "var(--primary)" }}>
          {client.name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="page-title font-heading" style={{ color: "var(--text-primary)" }}>{client.name}</h1>
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Since {client.joinedAt.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</p>
        </div>
      </div>

      {isCoach && (
        <ClientAlertsBanner
          clientId={client.id}
          onRecheck={recheckClientHealth}
          initial={openAlerts.map((a) => ({
            id: a.id,
            clientName: client.name,
            clientSlug: client.slug,
            severity: a.severity,
            title: a.title,
            detail: a.detail,
            fixHint: a.fixHint,
            fixUrl: a.fixUrl,
            lastSeenAt: a.lastSeenAt.toISOString(),
          }))}
        />
      )}

      <ClientTabsShell
        tabs={[
          { key: "onboarding", label: "Onboarding", content: onboardingContent },
          {
            key: "dashboard",
            label: "Dashboard",
            content: dashboardContent,
            badge: awaitingUpdates ? `${awaitingUpdates} lead${awaitingUpdates === 1 ? " needs" : "s need"} an update` : undefined,
          },
          ...(clientSheet || isCoach ? [{ key: "leads", label: "Leads", content: leadsContent }] : []),
          { key: "growth", label: "Growth", content: hold ? <HoldNote /> : <GrowthPanel clientId={client.id} isCoach={isCoach} /> },
          { key: "gameplan", label: "Gameplan", content: gameplanContent },
          { key: "playbooks", label: "Playbooks", content: playbooksContent },
          { key: "ads", label: "Ads", content: adsContent },
          { key: "awards", label: "Awards", content: awardsContent },
          { key: "referrals", label: "Referrals", content: referralsContent },
        ]}
      />
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="material-symbols-outlined text-[16px] mt-0.5" style={{ color: "var(--text-muted)" }}>{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</dt>
        <dd className="font-medium truncate" style={{ color: "var(--text-primary)" }}>{value}</dd>
      </div>
    </div>
  );
}
