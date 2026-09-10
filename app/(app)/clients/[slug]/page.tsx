import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  toggleOnboardingStep,
  saveGameplanLink,
  toggleLessonComplete,
  createModule,
  createLesson,
  createProgressNote,
  syncClientLeads,
  updateLeadStatus,
  addLeadNote,
  getOrCreateClientReferralLink,
} from "@/lib/actions";
import { requireClientAccess } from "@/lib/auth";
import { checkAndGrantAwards } from "@/lib/awards";
import { LEAD_STATUS_LABELS, LEAD_STATUS_STYLE } from "@/lib/lead-status";
import { getClientCampaignFunnel } from "@/lib/lead-sync";
import { getMetaAllCampaigns } from "@/lib/meta-ads";
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

// Forces this page to render fresh on every single request — no static
// caching, no ISR.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function ClientDetailPage({ params }: { params: { slug: string } }) {
  const client = await prisma.client.findUnique({
    where: { slug: params.slug },
    include: { program: true },
  });
  if (!client) notFound();

  // A client login gets bounced to /dashboard (which redirects to their own
  // slug) if they try to view anyone else's page. A coach can view any client.
  const viewer = await requireClientAccess(client.id);

  // Re-checks revenue/module thresholds against award tiers on every visit —
  // not just when a lesson gets toggled — so editing a tier's threshold or a
  // payment landing doesn't require an unrelated action to unlock it.
  await checkAndGrantAwards(client.id);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    revenueThisMonth,
    lifetimeRevenueAgg,
    onboardingTemplates,
    onboardingProgress,
    modules,
    lessonProgress,
    campaigns,
    awardTiers,
    clientAwards,
    recentLeads,
    progressNotes,
    clientSheet,
  ] = await Promise.all([
    prisma.revenueMonthly.aggregate({ _sum: { amount: true }, where: { clientId: client.id, month: monthStart } }),
    prisma.revenueMonthly.aggregate({ _sum: { amount: true }, where: { clientId: client.id } }),
    prisma.onboardingStepTemplate.findMany({ orderBy: { order: "asc" } }),
    prisma.clientOnboardingStep.findMany({ where: { clientId: client.id } }),
    prisma.module.findMany({ orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" } } } }),
    prisma.clientLessonProgress.findMany({ where: { clientId: client.id, completedAt: { not: null } } }),
    prisma.adCampaign.findMany({ where: { clientId: client.id } }),
    prisma.awardTier.findMany({ orderBy: { order: "asc" } }),
    prisma.clientAward.findMany({ where: { clientId: client.id } }),
    prisma.lead.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.progressNote.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.clientSheet.findUnique({ where: { clientId: client.id } }),
  ]);

  const campaignFunnel = await getClientCampaignFunnel(client.id);

  // Lazily provisions a referral link for clients that existed before this
  // feature — new clients already get one at creation (see createClient).
  const referralLink = await getOrCreateClientReferralLink(client.id, client.name);
  const referrals = await prisma.referral.findMany({ where: { referralLinkId: referralLink.id }, orderBy: { createdAt: "desc" } });

  // Once Meta's connected, its live campaign list (active + paused/ended,
  // all-time spend) replaces the old manually-typed AdCampaign rows on the
  // Ads tab — one source of truth instead of two numbers that never agree.
  // Falls back to the manual rows if the call fails (e.g. an expired token).
  const metaCampaigns =
    client.metaAdAccountId && client.metaAccessToken
      ? await getMetaAllCampaigns(client.metaAdAccountId, client.metaAccessToken).catch(() => null)
      : null;

  const revThisMonth = Number(revenueThisMonth._sum.amount ?? 0);
  const lifetimeRevenue = Number(lifetimeRevenueAgg._sum.amount ?? 0);
  const totalSpend = campaigns.reduce((s, c) => s + Number(c.spend), 0);
  const profit = revThisMonth - totalSpend;

  const earnedTierIds = new Set(clientAwards.map((a) => a.awardTierId));
  const nextTier = awardTiers.find((t) => !earnedTierIds.has(t.id) && t.thresholdRevenue);
  const nextTierRemaining = nextTier ? Math.max(Number(nextTier.thresholdRevenue) - lifetimeRevenue, 0) : 0;

  const dashboardContent = (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon="payments" label="Revenue this month" value={`$${revThisMonth.toLocaleString()}`} />
        <StatCard icon="ads_click" label="Ad spend" value={`$${totalSpend.toLocaleString()}`} />
        <StatCard icon="trending_up" label="Profit" value={`$${profit.toLocaleString()}`} />
        <StatCard icon="account_balance_wallet" label="Lifetime revenue" value={`$${lifetimeRevenue.toLocaleString()}`} />
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Main column — the day-to-day, coaching-relevant activity */}
        <div className="col-span-2 space-y-5">
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
                  const st = LEAD_STATUS_STYLE[l.status];
                  return (
                    <div key={l.id} className="flex items-center justify-between py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                      <div className="flex items-center gap-3">
                        <span className="icon-chip w-8 h-8" style={{ background: "var(--surface-hover)" }}>
                          <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--text-secondary)" }}>person_search</span>
                        </span>
                        <div>
                          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{l.source ?? l.campaign ?? "Unknown source"}</p>
                          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {l.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            {l.value ? ` · $${Number(l.value).toLocaleString()}` : ""}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: st.bg, color: st.color }}>
                        {LEAD_STATUS_LABELS[l.status]}
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
              <DetailRow icon="school" label="Program" value={client.program?.name ?? "—"} />
              <DetailRow icon="calendar_today" label="Joined" value={client.joinedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />
            </dl>
          </div>

          <div className="card rounded-2xl p-5">
            <p className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Goals</p>
            <p className="text-sm" style={{ color: client.goals ? "var(--text-primary)" : "var(--text-secondary)" }}>
              {client.goals || "No goals recorded yet."}
            </p>
          </div>

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
      <AdsPanel
        source={metaCampaigns ? "meta" : "manual"}
        campaigns={
          metaCampaigns
            ? metaCampaigns.map((c) => ({ id: c.id, name: c.name, status: c.status, spend: c.spend, impressions: c.impressions, clicks: c.clicks }))
            : campaigns.map((c) => ({
                id: c.id,
                name: c.name,
                status: c.status,
                spend: Number(c.spend),
                impressions: c.impressions,
                profileVisits: c.profileVisits,
                engagement: c.engagement,
                saves: c.saves,
                syncedAt: c.syncedAt?.toISOString() ?? null,
              }))
        }
      />
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
      funnel={campaignFunnel}
      onSync={syncClientLeads}
      onUpdateStatus={updateLeadStatus}
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
            {client.program && (
              <span className="text-[10px] font-bold px-2 py-1 rounded" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
                {client.program.name}
              </span>
            )}
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Since {client.joinedAt.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</p>
        </div>
      </div>

      <ClientTabsShell
        tabs={[
          { key: "onboarding", label: "Onboarding", content: onboardingContent },
          { key: "dashboard", label: "Dashboard", content: dashboardContent },
          ...(clientSheet ? [{ key: "leads", label: "Leads", content: leadsContent }] : []),
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

function StatCard({ icon, label, value, big }: { icon: string; label: string; value: string; big?: boolean }) {
  return (
    <div className="card rounded-2xl p-5">
      <div className="flex justify-between items-start mb-3">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</p>
        <span className="icon-chip w-8 h-8" style={{ background: "var(--primary-tint)" }}>
          <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--primary)" }}>{icon}</span>
        </span>
      </div>
      <p className={`font-heading font-bold ${big ? "text-3xl" : "text-2xl"}`} style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  );
}