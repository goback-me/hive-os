"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_STATUS_STYLE, type LeadStatusValue } from "@/lib/lead-status";
import type { SyncSummary, CampaignFunnelRow } from "@/lib/lead-sync";
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
  status: LeadStatusValue;
  sheetStatus: string | null;
  value: number | null;
  raw: Record<string, string> | null;
  createdAt: string;
  lastSyncedAt: string | null;
};

type ActivityRow = {
  id: string;
  fromStatus: LeadStatusValue;
  toStatus: LeadStatusValue;
  value: number | null;
  changedBy: string;
  changedAt: string;
};

type NoteRow = {
  id: string;
  note: string;
  createdBy: string;
  createdAt: string;
};

type JourneyEntry =
  | { kind: "created"; at: string }
  | { kind: "note"; id: string; at: string; note: string; by: string }
  | { kind: "status"; id: string; at: string; from: LeadStatusValue; to: LeadStatusValue; value: number | null; by: string };

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
  funnel: initialFunnel,
  onSync,
  onUpdateStatus,
  onAddNote,
}: {
  clientId: string;
  viewerRole: "COACH" | "CLIENT";
  hasSheet: boolean;
  clientSlug: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  funnel: CampaignFunnelRow[];
  onSync: (clientId: string) => Promise<{ summary: SyncSummary } | { error: string }>;
  onUpdateStatus: (leadId: string, status: string, value?: number) => Promise<void>;
  onAddNote: (leadId: string, formData: FormData) => Promise<void>;
}) {
  const isCoach = viewerRole === "COACH";

  const [activeSubTab, setActiveSubTab] = useState<"leads" | "campaigns">("leads");

  const [dateRange, setDateRange] = useState<DateRangePreset>("maximum");
  const [funnel, setFunnel] = useState(initialFunnel);
  const [loadingFunnel, setLoadingFunnel] = useState(false);
  const [series, setSeries] = useState<TimeSeriesPoint[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(false);

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<LeadStatusValue, number>>(
    () => Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatusValue, number>
  );
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<LeadStatusValue | "">("");
  const [sheetStatusFilter, setSheetStatusFilter] = useState<string | null>(null);
  const [sheetStatusCounts, setSheetStatusCounts] = useState<Record<string, number>>({});
  const [campaignFilter, setCampaignFilter] = useState<string | null>(null);
  const [loadingLeads, setLoadingLeads] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(lastSyncError ? `Last sync failed: ${lastSyncError}` : null);
  const [lastSynced, setLastSynced] = useState(initialLastSyncedAt);

  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);
  const [activityByLead, setActivityByLead] = useState<Record<string, ActivityRow[]>>({});
  const [loadingActivity, setLoadingActivity] = useState<string | null>(null);
  const [notesByLead, setNotesByLead] = useState<Record<string, NoteRow[]>>({});
  const [loadingNotes, setLoadingNotes] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [pendingChange, setPendingChange] = useState<{ lead: LeadRow; status: LeadStatusValue } | null>(null);
  const [pendingValue, setPendingValue] = useState("");
  const [, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allStatusCount = useMemo(() => Object.values(statusCounts).reduce((a, b) => a + b, 0), [statusCounts]);
  // Every distinct raw value the sheet's status column has for this client —
  // "__none__" (no status column configured, or a blank cell) sorts last.
  const sheetStatusValues = useMemo(
    () => Object.keys(sheetStatusCounts).filter((k) => k !== "__none__").sort(),
    [sheetStatusCounts]
  );
  const sortedFunnel = useMemo(() => [...funnel].sort((a, b) => b.total - a.total), [funnel]);
  const detailLead = detailLeadId ? leads.find((l) => l.id === detailLeadId) ?? null : null;

  const journey = useMemo((): JourneyEntry[] => {
    if (!detailLead) return [];
    const notes: JourneyEntry[] = (notesByLead[detailLead.id] ?? []).map((n) => ({ kind: "note", id: n.id, at: n.createdAt, note: n.note, by: n.createdBy }));
    const statuses: JourneyEntry[] = (activityByLead[detailLead.id] ?? []).map((a) => ({ kind: "status", id: a.id, at: a.changedAt, from: a.fromStatus, to: a.toStatus, value: a.value, by: a.changedBy }));
    const created: JourneyEntry[] = [{ kind: "created", at: detailLead.createdAt }];
    return [...notes, ...statuses, ...created].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [detailLead, notesByLead, activityByLead]);

  // Client-level rollup of every campaign's numbers — avg time-to-convert is
  // weighted by each campaign's won count so one small campaign with a single
  // fast win can't skew the overall figure as much as a big one.
  const overall = useMemo(() => {
    const won = funnel.reduce((s, r) => s + r.won, 0);
    const lost = funnel.reduce((s, r) => s + r.lost, 0);
    const disqualified = funnel.reduce((s, r) => s + r.disqualified, 0);
    const closedTotal = won + lost + disqualified;
    const weightedDaysSum = funnel.reduce((s, r) => s + (r.avgDaysToConvert ?? 0) * r.won, 0);
    return {
      won,
      lost,
      disqualified,
      closedTotal,
      winRate: closedTotal > 0 ? (won / closedTotal) * 100 : null,
      lossRate: closedTotal > 0 ? (lost / closedTotal) * 100 : null,
      disqualifiedRate: closedTotal > 0 ? (disqualified / closedTotal) * 100 : null,
      avgDaysToConvert: won > 0 ? weightedDaysSum / won : null,
    };
  }, [funnel]);

  function loadLeads() {
    if (!hasSheet) return;
    setLoadingLeads(true);
    const params = new URLSearchParams({ clientId, page: String(page), pageSize: String(PAGE_SIZE), range: dateRange });
    if (statusFilter) params.set("status", statusFilter);
    if (campaignFilter) params.set("campaign", campaignFilter);
    if (sheetStatusFilter) params.set("sheetStatus", sheetStatusFilter);
    fetch(`/api/leads?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setLeads(data.leads);
        setTotal(data.total);
        if (data.statusCounts) setStatusCounts(data.statusCounts);
        if (data.sheetStatusCounts) setSheetStatusCounts(data.sheetStatusCounts);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingLeads(false));
  }

  function loadFunnel() {
    if (!hasSheet) return;
    setLoadingFunnel(true);
    fetch(`/api/leads/funnel?clientId=${clientId}&range=${dateRange}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setFunnel(data.funnel);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingFunnel(false));
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

  useEffect(() => {
    loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, sheetStatusFilter, campaignFilter, hasSheet]);

  useEffect(() => {
    setPage(1);
    loadLeads();
    loadFunnel();
    loadSeries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  // Auto-sync on open when the Lead table is stale (never synced, or >10 min
  // old) — the tab reads the synced table, not the sheet, so without this it
  // lags behind whatever the Leads page shows live.
  useEffect(() => {
    if (hasSheet && (!initialLastSyncedAt || Date.now() - new Date(initialLastSyncedAt).getTime() > 10 * 60000)) sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshAfterChange(leadId: string) {
    loadLeads();
    loadFunnel();
    loadSeries();
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
        setSyncMessage(`Synced ${summary.created + summary.updated} leads — ${summary.created} new, ${summary.updated} updated${summary.removed ? `, ${summary.removed} removed (no longer in sheet)` : ""}.`);
        setPage(1);
        loadLeads();
        loadFunnel();
        loadSeries();
      })
      .catch((e) => setError(e.message))
      .finally(() => setSyncing(false));
  }

  function requestStatusChange(lead: LeadRow, status: LeadStatusValue) {
    setPendingValue(lead.value ? String(lead.value) : "");
    setPendingChange({ lead, status });
  }

  function confirmStatusChange(skipValue: boolean) {
    if (!pendingChange) return;
    const { lead, status } = pendingChange;
    const value = !skipValue && pendingValue.trim() ? Number(pendingValue) : undefined;
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status } : l))); // optimistic
    setPendingChange(null);
    startTransition(() => {
      onUpdateStatus(lead.id, status, Number.isFinite(value) ? value : undefined)
        .then(() => refreshAfterChange(lead.id))
        .catch((e) => setError(e.message));
    });
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
          <DateRangeDropdown value={dateRange} onChange={setDateRange} />
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
          <div className="card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Lead activity over time</p>
              {loadingSeries && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Updating…</span>}
            </div>
            <LeadTimelineChart points={series} />
          </div>

          {funnel.length > 0 && overall.closedTotal > 0 && (
            <div className="card rounded-2xl p-4 flex items-center flex-wrap gap-x-6 gap-y-2">
              <SummaryStat label="Win rate" value={`${Math.round(overall.winRate ?? 0)}%`} color="var(--primary)" />
              <SummaryStat label="Loss rate" value={`${Math.round(overall.lossRate ?? 0)}%`} color="var(--danger)" />
              <SummaryStat label="Disqualified rate" value={`${Math.round(overall.disqualifiedRate ?? 0)}%`} />
              <SummaryStat
                label="Avg. time to convert"
                value={overall.avgDaysToConvert != null ? `${overall.avgDaysToConvert.toFixed(1)}d` : "—"}
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{funnel.length} campaigns</p>
              {loadingFunnel && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Updating…</span>}
            </div>
            {funnel.length === 0 ? (
              <div className="card rounded-2xl p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                No leads in this date range.
              </div>
            ) : (
              <div className="card rounded-2xl overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[900px]">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["Campaign", "Leads", "Contacted", "Won", "Lost", "DQ", "Contact rate", "Win rate", "Avg. time to win", "Spend", "Cost/lead", ""].map((h) => (
                        <th key={h} className="py-2 px-3 text-xs font-bold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFunnel.map((row) => {
                      const contactRate = row.total > 0 ? Math.round((row.contacted / row.total) * 100) : null;
                      const costPerLead = row.spend != null && row.total > 0 ? row.spend / row.total : null;
                      return (
                        <tr key={row.campaign} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="py-2 px-3 font-medium max-w-[220px] truncate" title={row.campaign} style={{ color: "var(--text-primary)" }}>
                            {displayCampaignName(row.campaign)}
                          </td>
                          <td className="py-2 px-3" style={{ color: "var(--text-primary)" }}>{row.total}</td>
                          <td className="py-2 px-3" style={{ color: "var(--text-secondary)" }}>{row.contacted}</td>
                          <td className="py-2 px-3 font-semibold" style={{ color: "var(--primary)" }}>{row.won}</td>
                          <td className="py-2 px-3" style={{ color: "var(--danger)" }}>{row.lost}</td>
                          <td className="py-2 px-3" style={{ color: "var(--text-secondary)" }}>{row.disqualified}</td>
                          <td className="py-2 px-3" style={{ color: "var(--text-secondary)" }}>{contactRate != null ? `${contactRate}%` : "—"}</td>
                          <td className="py-2 px-3" style={{ color: "var(--text-secondary)" }}>{row.winRate != null ? `${Math.round(row.winRate)}%` : "—"}</td>
                          <td className="py-2 px-3" style={{ color: "var(--text-secondary)" }}>{row.avgDaysToConvert != null ? `${row.avgDaysToConvert.toFixed(1)}d` : "—"}</td>
                          <td className="py-2 px-3 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                            {row.spend != null ? `$${row.spend.toLocaleString()}${row.spendSource ? ` (${row.spendSource})` : ""}` : "—"}
                          </td>
                          <td className="py-2 px-3" style={{ color: "var(--text-secondary)" }}>{costPerLead != null ? `$${costPerLead.toFixed(2)}` : "—"}</td>
                          <td className="py-2 px-3">
                            <button
                              onClick={() => viewCampaignLeads(row.campaign)}
                              className="text-xs font-semibold whitespace-nowrap"
                              style={{ color: "var(--primary)" }}
                            >
                              View leads
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === "leads" && (
        <div className="card rounded-2xl p-5 overflow-x-auto">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{total.toLocaleString()} leads</p>
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

          {sheetStatusValues.length > 0 && (
            <div className="mb-4">
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

          <div className="mb-4">
            <p className="text-[10px] font-bold tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>PIPELINE STATUS</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <TabButton active={statusFilter === ""} label="All" count={allStatusCount} onClick={() => { setStatusFilter(""); setPage(1); }} />
              {LEAD_STATUSES.map((s) => (
                <TabButton
                  key={s}
                  active={statusFilter === s}
                  label={LEAD_STATUS_LABELS[s]}
                  count={statusCounts[s] ?? 0}
                  color={LEAD_STATUS_STYLE[s].color}
                  onClick={() => { setStatusFilter(s); setPage(1); }}
                />
              ))}
            </div>
          </div>

          {loadingLeads ? (
            <p className="text-sm py-6 text-center" style={{ color: "var(--text-secondary)" }}>Loading…</p>
          ) : leads.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {total === 0 ? "No leads yet." : "No leads match this filter."}
            </p>
          ) : (
            <>
              <table className="w-full text-left text-sm min-w-[760px]">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Name", "Phone", "Email", "Source", "Campaign", "Status", "Value", ""].map((h, i) => (
                      <th key={i} className="py-2 pr-4 text-xs font-bold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => {
                    const st = LEAD_STATUS_STYLE[lead.status];
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
                              value={lead.status}
                              onChange={(e) => requestStatusChange(lead, e.target.value as LeadStatusValue)}
                              className="px-2 py-1 rounded-full text-xs font-bold outline-none border-0"
                              style={{ background: st.bg, color: st.color }}
                            >
                              {LEAD_STATUSES.map((s) => (
                                <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="px-2 py-1 rounded-full text-xs font-bold" style={{ background: st.bg, color: st.color }}>
                              {LEAD_STATUS_LABELS[lead.status]}
                            </span>
                          )}
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
              style={{ background: `linear-gradient(160deg, ${LEAD_STATUS_STYLE[detailLead.status].bg} 0%, var(--surface-card) 130%)` }}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center font-heading font-bold text-lg shrink-0"
                    style={{ background: LEAD_STATUS_STYLE[detailLead.status].color, color: "#fff" }}
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
                <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: LEAD_STATUS_STYLE[detailLead.status].color, color: "#fff" }}>
                  {LEAD_STATUS_LABELS[detailLead.status]}
                </span>
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
                        const toStyle = LEAD_STATUS_STYLE[entry.to];
                        return (
                          <div key={entry.id} className="relative pl-5">
                            <span className="absolute left-0 top-1 w-2.5 h-2.5 rounded-full" style={{ background: toStyle.color }} />
                            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                              <strong style={{ color: "var(--text-primary)" }}>{entry.by}</strong> moved this lead to{" "}
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: toStyle.bg, color: toStyle.color }}>
                                {LEAD_STATUS_LABELS[entry.to]}
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
              Move to {LEAD_STATUS_LABELS[pendingChange.status]}
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

// Client-wide rollup stat (across every campaign) — same shape used in the
// "Campaign performance" summary strip.
function SummaryStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-heading font-bold text-base" style={{ color: color ?? "var(--text-primary)" }}>{value}</span>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}
