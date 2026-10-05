// Cohort funnel maths — pure (no DB), shared by lib/lead-sync.ts's
// getClientFunnel and the Leads tab UI. A cohort = leads whose createdAt
// (opt-in date) falls in the selected range; each lead counts once per step
// it has provably reached.

import {
  DQ_PHASES,
  DQ_REASONS,
  LOST_REASONS,
  STAGE_RANK,
  isTerminal,
  type DqPhaseValue,
  type DqReasonValue,
  type LeadStageValue,
  type LostReasonValue,
} from "./lead-status";
import type { ReportVisibility } from "./report-visibility";

export type FunnelLead = {
  campaign: string;
  stage: LeadStageValue;
  dqPhase: DqPhaseValue | null;
  dqReason: DqReasonValue | null;
  lostReason: LostReasonValue | null;
  eventStages: LeadStageValue[]; // every LeadStageEvent stage, any source
  stuckWithClient?: boolean; // handed over STUCK_DAYS+ ago, still awaiting the client's update
  returned?: boolean; // sent back to Chase Up by the client at least once (Lead.returnedCount)
};

// A handover still awaiting the client's update this long is "stuck with
// client" — the drop is theirs to fix, not ours.
export const STUCK_DAYS = 14;
export const isStuckWithClient = (l: { awaitingClientUpdate: boolean; handoverAt: Date | null; createdAt: Date }, now = new Date()) =>
  l.awaitingClientUpdate && now.getTime() - (l.handoverAt ?? l.createdAt).getTime() >= STUCK_DAYS * 86_400_000;

export type FunnelCounts = {
  leads: number;
  contacted: number;
  qualified: number;
  handovers: number;
  liveTransfers: number;
  stuckWithClient: number;
  returned: number; // returned by the client — counted once however many times
  consultsBooked: number;
  consultsAttended: number;
  noShows: number;
  quotes: number;
  won: number;
  lost: number;
  dq: number;
  dqByPhase: Record<DqPhaseValue | "UNKNOWN", number>;
  dqByReason: Record<DqReasonValue, number>;
  lostByReason: Record<LostReasonValue, number>;
};

export type FunnelRates = {
  contactRate: number | null;
  qualifiedRate: number | null;
  liveTransferRate: number | null;
  returnedRate: number | null; // returned by client / handovers
  bookingRate: number | null;
  showRate: number | null;
  quoteRate: number | null;
  closeRate: number | null;
  overallConversion: number | null;
};

export const DURATION_KEYS = [
  "leadToContacted",
  "contactedToHandover",
  "leadToLiveTransfer",
  "leadToBooking",
  "handoverToBooked",
  "consultToQuote",
  "quoteToWon",
  "leadToWon",
] as const;
export type DurationKey = (typeof DURATION_KEYS)[number];
export type Durations = Record<DurationKey, { medianDays: number | null; n: number }>;

export const DURATION_LABELS: Record<DurationKey, string> = {
  leadToContacted: "Lead → first contact",
  contactedToHandover: "Contacted → handover",
  leadToLiveTransfer: "Lead → live transfer",
  leadToBooking: "Lead → booking",
  handoverToBooked: "Handover → consult booked",
  consultToQuote: "Consult → quote",
  quoteToWon: "Quote → won",
  leadToWon: "Lead → won",
};

export type FunnelGroup = {
  campaign: string; // "__all__" for the client-wide row
  counts: FunnelCounts;
  rates: FunnelRates;
  durations: Durations;
  spend: number | null;
  spendSource: "meta" | "daily" | "manual" | null;
  costPerLead: number | null;
  costPerContacted: number | null;
  costPerQualified: number | null;
  costPerConsult: number | null;
  costPerWon: number | null;
};

// How far up the funnel a lead provably got, as a STAGE_RANK. Won = all the
// way. Open leads: their current stage or any stage they've had an event for
// (a lead moved back to Nurture still reached its earlier consult). Lost/DQ
// leads only get credit for stages they actually passed (non-terminal
// events), plus what their DQ phase implies.
export function reachedRank(lead: Pick<FunnelLead, "stage" | "dqPhase" | "eventStages">): number {
  if (lead.stage === "WON") return STAGE_RANK.WON;
  let best = isTerminal(lead.stage) ? 0 : STAGE_RANK[lead.stage];
  for (const s of lead.eventStages) if (!isTerminal(s)) best = Math.max(best, STAGE_RANK[s]);
  if (lead.stage === "DISQUALIFIED") {
    if (lead.dqPhase === "POST_CONTACT") best = Math.max(best, STAGE_RANK.CONTACTED);
    if (lead.dqPhase === "POST_HANDOVER") best = Math.max(best, STAGE_RANK.HANDOVER_ATTEMPTED);
  }
  return best;
}

const has = (lead: FunnelLead, stage: LeadStageValue) => lead.stage === stage || lead.eventStages.includes(stage);

export function emptyCounts(): FunnelCounts {
  return {
    leads: 0,
    contacted: 0,
    qualified: 0,
    handovers: 0,
    liveTransfers: 0,
    stuckWithClient: 0,
    returned: 0,
    consultsBooked: 0,
    consultsAttended: 0,
    noShows: 0,
    quotes: 0,
    won: 0,
    lost: 0,
    dq: 0,
    dqByPhase: Object.fromEntries([...DQ_PHASES, "UNKNOWN"].map((p) => [p, 0])) as FunnelCounts["dqByPhase"],
    dqByReason: Object.fromEntries(DQ_REASONS.map((r) => [r, 0])) as FunnelCounts["dqByReason"],
    lostByReason: Object.fromEntries(LOST_REASONS.map((r) => [r, 0])) as FunnelCounts["lostByReason"],
  };
}

export function addLead(c: FunnelCounts, lead: FunnelLead) {
  const r = reachedRank(lead);
  const preContactDq = lead.stage === "DISQUALIFIED" && (lead.dqPhase ?? "PRE_CONTACT") === "PRE_CONTACT";
  c.leads++;
  if (r >= STAGE_RANK.CONTACTED && !preContactDq) c.contacted++;
  if (r >= STAGE_RANK.HANDOVER_ATTEMPTED) c.qualified++; // any handover or CLIENT_CONTACTED (or later)
  if (r >= STAGE_RANK.HANDOVER_ATTEMPTED) c.handovers++; // any HANDOVER_STAGES (live, attempted, text) or later
  if (has(lead, "HANDOVER_LIVE")) c.liveTransfers++;
  if (lead.stuckWithClient) c.stuckWithClient++;
  if (lead.returned) c.returned++;
  if (r >= STAGE_RANK.CONSULT_BOOKED) c.consultsBooked++;
  if (has(lead, "CONSULT_NO_SHOW")) c.noShows++;
  if (r >= STAGE_RANK.CONSULT_ATTENDED) c.consultsAttended++;
  if (r >= STAGE_RANK.QUOTE_SENT) c.quotes++;
  if (lead.stage === "WON") c.won++;
  if (lead.stage === "LOST") {
    c.lost++;
    c.lostByReason[lead.lostReason ?? "UNKNOWN"]++;
  }
  if (lead.stage === "DISQUALIFIED") {
    c.dq++;
    c.dqByPhase[lead.dqPhase ?? "UNKNOWN"]++;
    c.dqByReason[lead.dqReason ?? "UNKNOWN"]++;
  }
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

export function funnelRates(c: FunnelCounts): FunnelRates {
  return {
    contactRate: pct(c.contacted, c.leads),
    qualifiedRate: pct(c.qualified, c.contacted),
    liveTransferRate: pct(c.liveTransfers, c.handovers),
    returnedRate: pct(c.returned, c.handovers),
    bookingRate: pct(c.consultsBooked, c.handovers),
    showRate: pct(c.consultsAttended, c.consultsBooked),
    quoteRate: pct(c.quotes, c.consultsAttended),
    closeRate: pct(c.won, c.quotes),
    overallConversion: pct(c.won, c.leads),
  };
}

export const costPer = (spend: number | null, n: number) => (spend != null && n > 0 ? spend / n : null);

// ── Biggest drop ─────────────────────────────────────────────────────────
// The weakest step-to-step rate, with what it usually means. Steps whose
// denominator is under MIN_SAMPLE are skipped — 1 of 2 isn't a signal.
const MIN_SAMPLE = 5;

// owner = who has to act: our team, or the client.
export type BiggestDrop = { step: string; rate: number; from: number; to: number; advice: string; evidence?: string; owner: "team" | "client" };

export function biggestDrop(c: FunnelCounts): BiggestDrop | null {
  const r = funnelRates(c);
  const dqShare = (phase: DqPhaseValue) => (c.dq > 0 ? Math.round((c.dqByPhase[phase] / c.dq) * 100) : 0);
  // Handovers that never got to a booking: mostly stuck with the client →
  // the client's drop to fix.
  const stuck = c.stuckWithClient;
  const clientStuck = stuck > 0 && stuck * 2 >= c.handovers - c.consultsBooked;
  const handoverEvidence = [
    stuck ? `${stuck} stuck with client (no update ${STUCK_DAYS}+ days)` : null,
    c.returned ? `${c.returned} returned by client (${Math.round(((c.returned / c.handovers) * 100) || 0)}% of handovers)` : null,
    c.dqByPhase.POST_HANDOVER ? `${c.dqByPhase.POST_HANDOVER} DQ'd after handover (${dqShare("POST_HANDOVER")}% of DQs)` : null,
  ].filter(Boolean).join(" · ");
  const steps: (BiggestDrop & { denom: number })[] = [
    {
      step: "Lead → contacted",
      rate: r.contactRate ?? NaN,
      from: c.leads,
      to: c.contacted,
      denom: c.leads,
      advice: "Offer/intent weak — check ads & offer",
      owner: "team",
      evidence: c.dqByPhase.PRE_CONTACT ? `${c.dqByPhase.PRE_CONTACT} DQ'd before contact (${dqShare("PRE_CONTACT")}% of DQs)` : undefined,
    },
    {
      step: "Contacted → qualified",
      rate: r.qualifiedRate ?? NaN,
      from: c.contacted,
      to: c.qualified,
      denom: c.contacted,
      advice: "Targeting off — tighten audience & qualifying questions",
      owner: "team",
      evidence: c.dqByPhase.POST_CONTACT ? `${c.dqByPhase.POST_CONTACT} DQ'd after contact (${dqShare("POST_CONTACT")}% of DQs)` : undefined,
    },
    {
      step: "Handover → consult booked",
      rate: r.bookingRate ?? NaN,
      from: c.handovers,
      to: c.consultsBooked,
      denom: c.handovers,
      advice: clientStuck
        ? "Stuck with client — chase them to update their leads (Dashboard → Update your leads)"
        : "DQs after handover — handover / team training, faster client callback",
      evidence: handoverEvidence || undefined,
      owner: clientStuck ? "client" : "team",
    },
    { step: "Booked → attended", rate: r.showRate ?? NaN, from: c.consultsBooked, to: c.consultsAttended, denom: c.consultsBooked, advice: "Low show rate — add consult reminders", owner: "client" },
    { step: "Consult → quote", rate: r.quoteRate ?? NaN, from: c.consultsAttended, to: c.quotes, denom: c.consultsAttended, advice: "Client selling — work through the sales Playbooks with them", owner: "client" },
    { step: "Quote → won", rate: r.closeRate ?? NaN, from: c.quotes, to: c.won, denom: c.quotes, advice: "Client selling — work through the sales Playbooks with them", owner: "client" },
  ];
  const candidates = steps.filter((s) => s.denom >= MIN_SAMPLE && Number.isFinite(s.rate));
  if (!candidates.length) return null;
  const worst = candidates.reduce((a, b) => (b.rate < a.rate ? b : a));
  const { denom: _denom, ...drop } = worst;
  return drop;
}

// ── What a viewer may receive ──────────────────────────────────────────────
// Strips hidden sections server-side for CLIENT users (Client.reportVisibility):
// the data is left out of the response, not just hidden in the UI.

// `leads` = the cohort size, for the total DQ rate.
export type DqBreakdown = Pick<FunnelCounts, "leads" | "dq" | "lost" | "dqByPhase" | "dqByReason" | "lostByReason">;
export type FunnelResponse = {
  funnel: { overall: FunnelGroup; campaigns: FunnelGroup[] } | null; // null = funnel hidden from this client
  dq: DqBreakdown | null; // null = DQ/lost breakdown hidden from this client
  visibility: ReportVisibility;
};

export function funnelForViewer(
  f: { overall: FunnelGroup; campaigns: FunnelGroup[] },
  role: "COACH" | "CLIENT",
  visibility: ReportVisibility
): FunnelResponse {
  const client = role === "CLIENT";
  const hideDq = client && !visibility.showDqBreakdown;
  const hideCost = client && !visibility.showCostMetrics;
  const { leads, dq, lost, dqByPhase, dqByReason, lostByReason } = f.overall.counts;

  const blank = emptyCounts();
  const strip = (g: FunnelGroup): FunnelGroup => ({
    ...g,
    counts: hideDq ? { ...g.counts, dq: 0, lost: 0, dqByPhase: blank.dqByPhase, dqByReason: blank.dqByReason, lostByReason: blank.lostByReason } : g.counts,
    ...(hideCost
      ? { spend: null, spendSource: null, costPerLead: null, costPerContacted: null, costPerQualified: null, costPerConsult: null, costPerWon: null }
      : {}),
  });

  return {
    funnel: client && !visibility.showFunnel ? null : { overall: strip(f.overall), campaigns: f.campaigns.map(strip) },
    dq: hideDq ? null : { leads, dq, lost, dqByPhase, dqByReason, lostByReason },
    visibility,
  };
}
