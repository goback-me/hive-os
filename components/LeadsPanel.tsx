"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  DQ_PHASE_LABELS,
  DQ_REASON_LABELS,
  LEAD_STAGES,
  LOST_REASON_LABELS,
  STAGE_LABELS,
  STAGE_RANK,
  STAGE_STYLE,
  TARGET_OPTIONS,
  encodeTarget,
  type DqPhaseValue,
  type DqReasonValue,
  type LeadStageValue,
  type LostReasonValue,
} from "@/lib/lead-status";
import type { SyncSummary } from "@/lib/lead-sync";
import type { FunnelResponse } from "@/lib/funnel";
import FunnelPanel from "@/components/FunnelPanel";
import ProfitRoiPanel from "@/components/ProfitRoiPanel";
import type { DateRangePreset } from "@/lib/date-range";
import DateRangeDropdown from "@/components/DateRangeDropdown";
import LeadTimelineChart, { type TimeSeriesPoint } from "@/components/LeadTimelineChart";

type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  campaign: string | null;
  stage: LeadStageValue;
  dqReason: DqReasonValue | null;
  dqPhase: DqPhaseValue | null;
  lostReason: LostReasonValue | null;
  callAttempts: number | null;
  stageLocked: boolean;
  sheetStage: LeadStageValue | null;
  sheetStatus: string | null;
  value: number | null;
  raw: Record<string, string> | null;
  createdAt: string;
  lastSyncedAt: string | null;
};

type ActivityRow = {
  id: string;
  fromStatus: LeadStageValue;
  toStatus: LeadStageValue;
  value: number | null;
  changedBy: string;
  changedAt: string;
};

type StageEventRow = { id: string; stage: LeadStageValue; source: "IMPORT" | "INFERRED"; at: string };

type NoteRow = {
  id: string;
  note: string;
  createdBy: string;
  createdAt: string;
};

type JourneyEntry =
  | { kind: "created"; at: string }
  | { kind: "note"; id: string; at: string; note: string; by: string }
  | { kind: "status"; id: string; at: string; from: LeadStageValue; to: LeadStageValue; value: number | null; by: string }
  | { kind: "event"; id: string; at: string; stage: LeadStageValue; source: "IMPORT" | "INFERRED" };

// A locked lead whose sheet has moved further along than the manual stage.
function sheetAhead(lead: Pick<LeadRow, "stage" | "stageLocked" | "sheetStage">) {
  return lead.stageLocked && lead.sheetStage != null && STAGE_RANK[lead.sheetStage] > STAGE_RANK[lead.stage] ? lead.sheetStage : null;
}

// "Disqualified · Budget (after handover)" etc.
function stageText(lead: Pick<LeadRow, "stage" | "dqReason" | "dqPhase" | "lostReason">) {
  if (lead.stage === "DISQUALIFIED") {
    const reason = DQ_REASON_LABELS[lead.dqReason ?? "UNKNOWN"];
    return `DQ · ${reason}${lead.dqPhase ? ` (${DQ_PHASE_LABELS[lead.dqPhase].toLowerCase()})` : ""}`;
  }
  if (lead.stage === "LOST") return `Lost · ${LOST_REASON_LABELS[lead.lostReason ?? "UNKNOWN"]}`;
  return STAGE_LABELS[lead.stage];
}

const PAGE_SIZE = 25;

function displayCampaignName(name: string) {
  const trimmed = name.trim();
  return !trimmed || trimmed === "-" ? "Unattributed" : trimmed;
}

// A deterministic color for a value we can't know ahead of time (whatever a
// client's own sheet uses for its status column) — same string always gets
// the same color, picked from a small palette defined in globals.css.
const TAG_COLORS = ["amber", "purple", "teal", "pink", "indigo", "green"] as const;
function tagColor(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  const name = TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
  return { bg: `var(--tag-${name}-bg)`, fg: `var(--tag-${name}-fg)` };
}

function SheetStatusBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs" style={{ color: "var(--text-muted)" }}>—</span>;
  const { bg, fg } = tagColor(value);
  return (
    <span className="px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap" style={{ background: bg, color: fg }}>
      {value}
    </span>
  );
}

export default function LeadsPanel({
  clientId,
  viewerRole,
  hasSheet,
  clientSlug,
  lastSyncedAt: initialLastSyncedAt,
  lastSyncError,
  onSync,
  onUpdateStage,
  onUnlockStage,
  onAddNote,
}: {
  clientId: string;
  viewerRole: "COACH" | "CLIENT";
  hasSheet: boolean;
  clientSlug: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  onSync: (clientId: string) => Promise<{ summary: SyncSummary } | { error: string }>;
  onUpdateStage: (leadId: string, target: string, value?: number) => Promise<void>;
  onUnlockStage: (leadId: string) => Promise<{ ok: true } | { error: string }>;
  onAddNote: (leadId: string, formData: FormData) => Promise<void>;
}) {
  const isCoach = viewerRole === "COACH";

  const [activeSubTab, setActiveSubTab] = useState<"leads" | "campaigns">("leads");

  const [dateRange, setDateRange] = useState<DateRangePreset>("maximum");
  const [funnel, setFunnel] = useState<FunnelResponse | null>(null);
  const [loadingFunnel, setLoadingFunnel] = useState(false);
  const [series, setSeries] = useState<TimeSeriesPoint[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(false);

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stageCounts, setStageCounts] = useState<Record<LeadStageValue, number>>(
    () => Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])) as Record<LeadStageValue, number>
  );
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<LeadStageValue | "">("");
  const [sheetStatusFilter, setSheetStatusFilter] = useState<string | null>(null);
  const [sheetStatusCounts, setSheetStatusCounts] = useState<Record<string, number>>({});
  const [campaignFilter, setCampaignFilter] = useState<string | null>(null);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [leadsLoaded, setLeadsLoaded] = useState(false); // false until the first page arrives

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(lastSyncError ? `Last sync failed: ${lastSyncError}` : null);
  const [lastSynced, setLastSynced] = useState(initialLastSyncedAt);

  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);
  const [activityByLead, setActivityByLead] = useState<Record<string, ActivityRow[]>>({});
  const [eventsByLead, setEventsByLead] = useState<Record<string, StageEventRow[]>>({});
  const [loadingActivity, setLoadingActivity] = useState<string | null>(null);
  const [notesByLead, setNotesByLead] = useState<Record<string, NoteRow[]>>({});
  const [loadingNotes, setLoadingNotes] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [pendingChange, setPendingChange] = useState<{ lead: LeadRow; target: string } | null>(null);
  const [pendingValue, setPendingValue] = useState("");
  const [, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allStatusCount = useMemo(() => Object.values(stageCounts).reduce((a, b) => a + b, 0), [stageCounts]);
  // Every distinct raw value the sheet's status column has for this client —
  // "__none__" (no status column configured, or a blank cell) sorts last.
  const sheetStatusValues = useMemo(
    () => Object.keys(sheetStatusCounts).filter((k) => k !== "__none__").sort(),
    [sheetStatusCounts]
  );
  const detailLead = detailLeadId ? leads.find((l) => l.id === detailLeadId) ?? null : null;

  const journey = useMemo((): JourneyEntry[] => {
    if (!detailLead) return [];
    const notes: JourneyEntry[] = (notesByLead[detailLead.id] ?? []).map((n) => ({ kind: "note", id: n.id, at: n.createdAt, note: n.note, by: n.createdBy }));
    const statuses: JourneyEntry[] = (activityByLead[detailLead.id] ?? []).map((a) => ({ kind: "status", id: a.id, at: a.changedAt, from: a.fromStatus, to: a.toStatus, value: a.value, by: a.changedBy }));
    const events: JourneyEntry[] = (eventsByLead[detailLead.id] ?? []).map((e) => ({ kind: "event", id: e.id, at: e.at, stage: e.stage, source: e.source }));
    const created: JourneyEntry[] = [{ kind: "created", at: detailLead.createdAt }];
    return [...notes, ...statuses, ...events, ...created].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [detailLead, notesByLead, activityByLead, eventsByLead]);

  // Each load stamps a request number; a response that isn't the latest is
  // dropped, so quick filter/page clicks can never paint stale rows.
  const leadsReq = useRef(0);
  function loadLeads() {
    if (!hasSheet) return;
    const req = ++leadsReq.current;
    setLoadingLeads(true);
    const params = new URLSearchParams({ clientId, page: String(page), pageSize: String(PAGE_SIZE), range: dateRange });
    if (statusFilter) params.set("stage", statusFilter);
    if (campaignFilter) params.set("campaign", campaignFilter);
    if (sheetStatusFilter) params.set("sheetStatus", sheetStatusFilter);
    fetch(`/api/leads?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (req !== leadsReq.current) return;
        if (data.error) throw new Error(data.error);
        setLeads(data.leads);
        setTotal(data.total);
        if (data.stageCounts) setStageCounts(data.stageCounts);
        if (data.sheetStatusCounts) setSheetStatusCounts(data.sheetStatusCounts);
        setLeadsLoaded(true);
      })
      .catch((e) => req === leadsReq.current && setError(e.message))
      .finally(() => req === leadsReq.current && setLoadingLeads(false));
  }

  const funnelReq = useRef(0);
  function loadFunnel() {
    if (!hasSheet) return;
    const req = ++funnelReq.current;
    setLoadingFunnel(true);
    fetch(`/api/leads/funnel?clientId=${clientId}&range=${dateRange}`)
      .then((r) => r.json())
      .then((data) => {
        if (req !== funnelReq.current) return;
        if (data.error) throw new Error(data.error);
        setFunnel(data);
      })
      .catch((e) => req === funnelReq.current && setError(e.message))
      .finally(() => req === funnelReq.current && setLoadingFunnel(false));
  }

  function loadSeries() {
    if (!hasSheet) return;
    setLoadingSeries(true);
    fetch(`/api/leads/timeseries?clientId=${clientId}&range=${dateRange}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSeries(data.points);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingSeries(false));
  }

  // `reloadKey` bumps after a sync or a stage change to refetch everything.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  // One fetch per change (this used to fire twice on open).
  useEffect(() => {
    loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, sheetStatusFilter, campaignFilter, hasSheet, dateRange, reloadKey]);

  // The funnel (incl. a live Meta spend call) and chart only load when the
  // Campaign performance tab is actually open.
  useEffect(() => {
    if (activeSubTab !== "campaigns") return;
    loadFunnel();
    loadSeries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab, dateRange, reloadKey]);

  function changeDateRange(range: DateRangePreset) {
    setDateRange(range);
    setPage(1);
  }

  // Auto-sync on open when the Lead table is stale (never synced, or >10 min
  // old) — the tab reads the synced table, not the sheet, so without this it
  // lags behind whatever the Leads page shows live.
  useEffect(() => {
    if (hasSheet && (!initialLastSyncedAt || Date.now() - new Date(initialLastSyncedAt).getTime() > 10 * 60000)) sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshAfterChange(leadId: string) {
    reload();
    if (activityByLead[leadId]) loadActivity(leadId);
  }

  function sync() {
    setSyncing(true);
    setError(null);
    setSyncMessage(null);
    onSync(clientId)
      .then((result) => {
        if ("error" in result) throw new Error(`Sync failed: ${result.error}`);
        const { summary } = result;
        setLastSynced(new Date().toISOString());
        setSyncMessage(`Synced ${summary.leads} leads — ${summary.created} new, ${summary.updated} updated${summary.restored ? `, ${summary.restored} restored` : ""}${summary.removed ? `, ${summary.removed} removed (no longer in sheet)` : ""}.`);
        setPage(1);
        reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setSyncing(false));
  }

  function requestStatusChange(lead: LeadRow, target: string) {
    setPendingValue(lead.value ? String(lead.value) : "");
    setPendingChange({ lead, target });
  }

  function confirmStatusChange(skipValue: boolean) {
    if (!pendingChange) return;
    const { lead, target } = pendingChange;
    const value = !skipValue && pendingValue.trim() ? Number(pendingValue) : undefined;
    const [stage, reason] = target.split(":") as [LeadStageValue, string | undefined];
    const optimistic = {
      stage,
      dqReason: stage === "DISQUALIFIED" ? ((reason ?? "UNKNOWN") as DqReasonValue) : null,
      lostReason: stage === "LOST" ? ((reason ?? "UNKNOWN") as LostReasonValue) : null,
      stageLocked: true,
    };
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, ...optimistic } : l)));
    setPendingChange(null);
    startTransition(() => {
      onUpdateStage(lead.id, target, Number.isFinite(value) ? value : undefined)
        .then(() => refreshAfterChange(lead.id))
        .catch((e) => setError(e.message));
    });
  }

  const [unlocking, setUnlocking] = useState(false);
  function unlockStage(leadId: string) {
    setUnlocking(true);
    setError(null);
    onUnlockStage(leadId)
      .then((result) => {
        if ("error" in result) throw new Error(result.error);
        refreshAfterChange(leadId);
      })
      .catch((e) => setError(e.message))
      .finally(() => setUnlocking(false));
  }

  function openDetail(leadId: string) {
    setDetailLeadId(leadId);
    setNoteDraft("");
    if (!activityByLead[leadId]) loadActivity(leadId);
    if (!notesByLead[leadId]) loadNotes(leadId);
  }

  function loadActivity(leadId: string) {
    setLoadingActivity(leadId);
    fetch(`/api/leads/activity?leadId=${leadId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setActivityByLead((prev) => ({ ...prev, [leadId]: data.activity }));
        setEventsByLead((prev) => ({ ...prev, [leadId]: data.events ?? [] }));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingActivity(null));
  }

  function loadNotes(leadId: string) {
    setLoadingNotes(leadId);
    fetch(`/api/leads/notes?leadId=${leadId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setNotesByLead((prev) => ({ ...prev, [leadId]: data.notes }));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingNotes(null));
  }

  function submitNote() {
    if (!detailLeadId || !noteDraft.trim()) return;
    setSavingNote(true);
    const formData = new FormData();
    formData.set("note", noteDraft.trim());
    onAddNote(detailLeadId, formData)
      .then(() => {
        setNoteDraft("");
        loadNotes(detailLeadId);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSavingNote(false));
  }

  function viewCampaignLeads(campaign: string) {
    setCampaignFilter(campaign);
    setStatusFilter("");
    setPage(1);
    setActiveSubTab("leads");
  }

  if (!hasSheet) {
    return (
      <div className="card rounded-2xl p-8 text-center">
        <span className="material-symbols-outlined text-4xl mb-2" style={{ color: "var(--text-muted)" }}>person_search</span>
        <p className="font-semibold" style={{ color: "var(--text-primary)" }}>No lead sheet connected yet</p>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          {isCoach ? (
            <>Connect this client's Google Sheet on the <Link href={`/leads?client=${clientSlug}`} className="font-semibold" style={{ color: "var(--primary)" }}>Leads page</Link> first.</>
          ) : (
            "Ask your coach to connect your lead sheet."
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          {isCoach && (
            lastSynced ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Last synced {new Date(lastSynced).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{syncing ? "Syncing for the first time…" : "Never synced yet"}</p>
            )
          )}
          {syncMessage && <p className="text-xs mt-0.5" style={{ color: "var(--primary)" }}>{syncMessage}</p>}
          {error && <p className="text-xs mt-0.5" style={{ color: "var(--danger)" }}>{error}</p>}
        </div>
        <div className="flex items-center gap-2">
          <DateRangeDropdown value={dateRange} onChange={changeDateRange} />
          {isCoach && (
            <button
              onClick={sync}
              disabled={syncing}
              className="btn-gradient flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">sync</span>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SubTabButton active={activeSubTab === "leads"} label="Leads" icon="person_search" onClick={() => setActiveSubTab("leads")} />
        <SubTabButton active={activeSubTab === "campaigns"} label="Campaign performance" icon="campaign" onClick={() => setActiveSubTab("campaigns")} />
      </div>

      {activeSubTab === "campaigns" && (
        <div className="space-y-5">
          <ProfitRoiPanel clientId={clientId} range={dateRange} isCoach={isCoach} />

          <div className="card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Lead activity over time</p>
              {loadingSeries && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Updating…</span>}
            </div>
            <LeadTimelineChart points={series} />
          </div>

          <FunnelPanel data={funnel} loading={loadingFunnel} isCoach={isCoach} onViewCampaign={viewCampaignLeads} />
        </div>
      )}

      {activeSubTab === "leads" && (
        <div className="card rounded-2xl p-5 overflow-x-auto">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            {leadsLoaded ? (
              <p className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                {total.toLocaleString()} leads
                {loadingLeads && <span className="material-symbols-outlined text-[16px] animate-spin" style={{ color: "var(--text-muted)" }}>progress_activity</span>}
              </p>
            ) : (
              <span className="skeleton h-4 w-24" />
            )}
            {campaignFilter && (
              <button
                onClick={() => setCampaignFilter(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                style={{ background: "var(--primary-tint)", color: "var(--primary)" }}
              >
                Campaign: {displayCampaignName(campaignFilter)}
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </div>

          {!leadsLoaded && (
            <div className="flex gap-1.5 mb-4">
              {[48, 72, 64, 88, 56].map((w, i) => <span key={i} className="skeleton h-7 rounded-full" style={{ width: w }} />)}
            </div>
          )}

          {leadsLoaded && sheetStatusValues.length > 0 && (
            <div className="mb-4 fade-in">
              <p className="text-[10px] font-bold tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>SHEET STATUS</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                <TabButton active={sheetStatusFilter === null} label="All" count={allStatusCount} onClick={() => { setSheetStatusFilter(null); setPage(1); }} />
                {sheetStatusValues.map((v) => (
                  <SheetStatusTabButton
                    key={v}
                    active={sheetStatusFilter === v}
                    label={v}
                    count={sheetStatusCounts[v] ?? 0}
                    onClick={() => { setSheetStatusFilter(sheetStatusFilter === v ? null : v); setPage(1); }}
                  />
                ))}
                {sheetStatusCounts.__none__ > 0 && (
                  <TabButton
                    active={sheetStatusFilter === "__none__"}
                    label="No status"
                    count={sheetStatusCounts.__none__}
                    onClick={() => { setSheetStatusFilter(sheetStatusFilter === "__none__" ? null : "__none__"); setPage(1); }}
                  />
                )}
              </div>
            </div>
          )}

          {leadsLoaded && <div className="mb-4 fade-in">
            <p className="text-[10px] font-bold tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>PIPELINE STATUS</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <TabButton active={statusFilter === ""} label="All" count={allStatusCount} onClick={() => { setStatusFilter(""); setPage(1); }} />
              {LEAD_STAGES.filter((s) => (stageCounts[s] ?? 0) > 0 || statusFilter === s).map((s) => (
                <TabButton
                  key={s}
                  active={statusFilter === s}
                  label={STAGE_LABELS[s]}
                  count={stageCounts[s] ?? 0}
                  color={STAGE_STYLE[s].color}
                  onClick={() => { setStatusFilter(s); setPage(1); }}
                />
              ))}
            </div>
          </div>}

          {!leadsLoaded ? (
            <SkeletonRows />
          ) : leads.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {total === 0 ? "No leads yet." : "No leads match this filter."}
            </p>
          ) : (
            <>
              {/* Rows stay up (dimmed) while the next page/filter loads — no blank flash. */}
              <table className="w-full text-left text-sm min-w-[760px] fade-in transition-opacity" style={{ opacity: loadingLeads ? 0.5 : 1 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Name", "Phone", "Email", "Source", "Campaign", "Status", "Value", ""].map((h, i) => (
                      <th key={i} className="py-2 pr-4 text-xs font-bold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => {
                    const st = STAGE_STYLE[lead.stage];
                    return (
                      <tr key={lead.id} style={{ borderBottom: "1px solid var(--border)" }} className="cursor-pointer" onClick={() => openDetail(lead.id)}>
                        <td className="py-2 pr-4 font-medium whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{lead.name || "—"}</td>
                        <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{lead.phone || "—"}</td>
                        <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{lead.email || "—"}</td>
                        <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{lead.source || "—"}</td>
                        <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{lead.campaign ? displayCampaignName(lead.campaign) : "—"}</td>
                        <td className="py-2 pr-4" onClick={(e) => e.stopPropagation()}>
                          {isCoach ? (
                            <select
                              value={encodeTarget({ stage: lead.stage, dqReason: lead.dqReason ?? undefined, lostReason: lead.lostReason ?? undefined })}
                              onChange={(e) => requestStatusChange(lead, e.target.value)}
                              className="px-2 py-1 rounded-full text-xs font-bold outline-none border-0"
                              style={{ background: st.bg, color: st.color }}
                              title={lead.stageLocked ? "Set manually — the sheet no longer changes this lead's stage" : undefined}
                            >
                              {TARGET_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap" style={{ background: st.bg, color: st.color }}>
                              {stageText(lead)}
                            </span>
                          )}
                          {sheetAhead(lead) && <SheetSaysBadge stage={sheetAhead(lead)!} />}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                          {lead.value != null ? `$${lead.value.toLocaleString()}` : "—"}
                        </td>
                        <td className="py-2 pr-4">
                          <button
                            onClick={(e) => { e.stopPropagation(); openDetail(lead.id); }}
                            className="text-xs font-semibold whitespace-nowrap"
                            style={{ color: "var(--primary)" }}
                          >
                            {isCoach ? "Details" : "History"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex items-center justify-between mt-4">
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Page {page} of {totalPages}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
                    style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
                    style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {detailLead && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setDetailLeadId(null)}
        >
          <div className="card rounded-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div
              className="p-6 rounded-t-2xl"
              style={{ background: `linear-gradient(160deg, ${STAGE_STYLE[detailLead.stage].bg} 0%, var(--surface-card) 130%)` }}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center font-heading font-bold text-lg shrink-0"
                    style={{ background: STAGE_STYLE[detailLead.stage].color, color: "#fff" }}
                  >
                    {(detailLead.name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-heading font-bold text-lg truncate" style={{ color: "var(--text-primary)" }}>{detailLead.name || "Unnamed lead"}</h3>
                    <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                      {[detailLead.phone, detailLead.email].filter(Boolean).join(" · ") || "No contact info"}
                    </p>
                  </div>
                </div>
                <button onClick={() => setDetailLeadId(null)} className="material-symbols-outlined shrink-0" style={{ color: "var(--text-muted)" }}>close</button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: STAGE_STYLE[detailLead.stage].color, color: "#fff" }}>
                  {stageText(detailLead)}
                </span>
                {detailLead.stageLocked && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1" style={{ background: "var(--surface-card)", color: "var(--text-secondary)" }}>
                    <span className="material-symbols-outlined text-[12px]">lock</span>
                    Set manually
                  </span>
                )}
                {sheetAhead(detailLead) && <SheetSaysBadge stage={sheetAhead(detailLead)!} />}
                {isCoach && detailLead.stageLocked && (
                  <button
                    onClick={() => unlockStage(detailLead.id)}
                    disabled={unlocking}
                    className="px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1 disabled:opacity-50"
                    style={{ border: "1px solid var(--border)", color: "var(--primary)" }}
                    title="Clear the manual stage and follow the sheet again"
                  >
                    <span className="material-symbols-outlined text-[12px]">lock_open</span>
                    {unlocking ? "Unlocking…" : "Unlock (follow sheet)"}
                  </button>
                )}
                {detailLead.callAttempts != null && (
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{detailLead.callAttempts} call attempt{detailLead.callAttempts === 1 ? "" : "s"}</span>
                )}
                <SheetStatusBadge value={detailLead.sheetStatus} />
                {detailLead.value != null && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: "var(--surface-card)", color: "var(--text-primary)" }}>
                    ${detailLead.value.toLocaleString()}
                  </span>
                )}
                {detailLead.campaign && (
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{displayCampaignName(detailLead.campaign)}</span>
                )}
              </div>
            </div>

            <div className="p-6 pt-5">
              <div className="flex gap-2 mb-6">
                <input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitNote(); }}
                  placeholder="Add a note about this lead…"
                  className="flex-1 px-3 py-2 rounded-lg outline-none text-sm"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
                <button
                  onClick={submitNote}
                  disabled={savingNote || !noteDraft.trim()}
                  className="px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
                  style={{ background: "var(--primary)", color: "#fff" }}
                >
                  Add
                </button>
              </div>

              <div className="mb-6">
                <p className="text-[10px] font-bold tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>LEAD JOURNEY</p>
                {loadingActivity === detailLead.id || loadingNotes === detailLead.id ? (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>Loading…</p>
                ) : (
                  <div className="relative">
                    <div className="absolute left-[5px] top-2 bottom-2 w-0.5" style={{ background: "var(--border)" }} />
                    <div className="space-y-4">
                      {journey.map((entry) => {
                        const when = new Date(entry.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                        if (entry.kind === "created") {
                          return (
                            <div key="created" className="relative pl-5">
                              <span className="absolute left-0 top-1 w-2.5 h-2.5 rounded-full" style={{ background: "var(--text-muted)" }} />
                              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                <strong style={{ color: "var(--text-primary)" }}>Lead created</strong> <span style={{ color: "var(--text-muted)" }}>· {when}</span>
                              </p>
                            </div>
                          );
                        }
                        if (entry.kind === "note") {
                          return (
                            <div key={entry.id} className="relative pl-5">
                              <span className="absolute left-0 top-1 w-2.5 h-2.5 rounded-full" style={{ background: "var(--primary)" }} />
                              <div className="p-2.5 rounded-lg" style={{ background: "var(--primary-tint)" }}>
                                <p className="text-xs" style={{ color: "var(--text-primary)" }}>{entry.note}</p>
                                <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{entry.by} · {when}</p>
                              </div>
                            </div>
                          );
                        }
                        if (entry.kind === "event") {
                          const evStyle = STAGE_STYLE[entry.stage];
                          return (
                            <div key={entry.id} className="relative pl-5">
                              <span className="absolute left-0 top-1 w-2.5 h-2.5 rounded-full" style={{ background: "var(--border)", border: `1px solid ${evStyle.color}` }} />
                              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: evStyle.bg, color: evStyle.color }}>
                                  {STAGE_LABELS[entry.stage]}
                                </span>{" "}
                                {entry.source === "IMPORT" ? "already reached when first synced" : "inferred (skipped over)"}
                                <span> · {when}</span>
                              </p>
                            </div>
                          );
                        }
                        const toStyle = STAGE_STYLE[entry.to];
                        return (
                          <div key={entry.id} className="relative pl-5">
                            <span className="absolute left-0 top-1 w-2.5 h-2.5 rounded-full" style={{ background: toStyle.color }} />
                            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                              <strong style={{ color: "var(--text-primary)" }}>{entry.by}</strong> moved this lead to{" "}
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: toStyle.bg, color: toStyle.color }}>
                                {STAGE_LABELS[entry.to]}
                              </span>
                              {entry.value != null && <span> · ${entry.value.toLocaleString()}</span>}
                              <span style={{ color: "var(--text-muted)" }}> · {when}</span>
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {isCoach && detailLead.raw && Object.entries(detailLead.raw).filter(([, v]) => v).length > 0 && (
                <div>
                  <p className="text-[10px] font-bold tracking-wide mb-2" style={{ color: "var(--text-secondary)" }}>SHEET DETAILS</p>
                  <div className="space-y-2">
                    {Object.entries(detailLead.raw).filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} className="p-2.5 rounded-lg" style={{ background: "var(--surface-hover)" }}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>{k}</p>
                        <p className="text-xs whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {pendingChange && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setPendingChange(null)}
        >
          <div className="card rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading font-bold text-lg mb-1" style={{ color: "var(--text-primary)" }}>
              Move to {TARGET_OPTIONS.find((o) => o.value === pendingChange.target)?.label ?? pendingChange.target}
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
              {pendingChange.lead.name || "This lead"} — add a deal value or profit figure (optional).
            </p>
            <input
              autoFocus
              type="number"
              value={pendingValue}
              onChange={(e) => setPendingValue(e.target.value)}
              placeholder="e.g. 1200"
              className="w-full px-3 py-2 rounded-lg outline-none text-sm mb-4"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => confirmStatusChange(true)}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              >
                Skip
              </button>
              <button
                onClick={() => confirmStatusChange(false)}
                className="btn-gradient px-4 py-2 rounded-lg text-sm font-bold"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// First-load placeholder in the table's shape, so the tab never shows "0 leads".
function SkeletonRows() {
  return (
    <div className="space-y-2" aria-label="Loading leads" role="status">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-2" style={{ borderBottom: "1px solid var(--border)", opacity: 1 - i * 0.09 }}>
          <span className="skeleton h-4 w-28" />
          <span className="skeleton h-4 w-24" />
          <span className="skeleton h-4 w-40" />
          <span className="skeleton h-4 w-16" />
          <span className="skeleton h-4 flex-1" />
          <span className="skeleton h-6 w-24 rounded-full" />
          <span className="skeleton h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

function SheetSaysBadge({ stage }: { stage: LeadStageValue }) {
  return (
    <span
      className="ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
      style={{ border: `1px dashed ${STAGE_STYLE[stage].color}`, color: STAGE_STYLE[stage].color }}
      title="This lead's stage was set manually; the sheet has since moved further along"
    >
      sheet says {STAGE_LABELS[stage]}
    </span>
  );
}

function SubTabButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold"
      style={{
        background: active ? "var(--primary)" : "var(--surface-hover)",
        color: active ? "#fff" : "var(--text-secondary)",
      }}
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
      {label}
    </button>
  );
}

function TabButton({ active, label, count, color, onClick }: { active: boolean; label: string; count: number; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
      style={{
        background: active ? (color ?? "var(--primary)") : "var(--surface-hover)",
        color: active ? "#fff" : "var(--text-secondary)",
      }}
    >
      {label}
      <span style={{ opacity: 0.75 }}>{count}</span>
    </button>
  );
}

// Always shows the value's own tag color (so the palette stays recognizable
// across the whole tab), dimmed when not selected and ringed when it is —
// rather than TabButton's invert-to-solid-color behavior, which would put
// white text on a pastel background and lose all contrast.
function SheetStatusTabButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  const { bg, fg } = tagColor(label);
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-opacity"
      style={{ background: bg, color: fg, boxShadow: active ? `0 0 0 2px ${fg}` : "none", opacity: active ? 1 : 0.55 }}
    >
      {label}
      <span style={{ opacity: 0.75 }}>{count}</span>
    </button>
  );
}
