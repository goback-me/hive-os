// The sales funnel — shared by the sync (lib/lead-sync.ts), manual edits
// (lib/actions.ts) and every UI that shows a lead's stage, so labels, colors
// and ordering can't drift. Pure module: no DB, safe in client components.

export const LEAD_STAGES = [
  "NEW_LEAD",
  "CHASE_UP",
  "CONTACTED",
  "NURTURE",
  "HANDOVER_ATTEMPTED",
  "HANDOVER_LIVE",
  "HANDOVER_TEXT",
  "CLIENT_CONTACTED",
  "CONSULT_BOOKED",
  "CONSULT_NO_SHOW",
  "CONSULT_ATTENDED",
  "QUOTE_SENT",
  "WON",
  "LOST",
  "DISQUALIFIED",
] as const;
export type LeadStageValue = (typeof LEAD_STAGES)[number];

export const DQ_REASONS = ["GHOSTED", "SPAM", "NOT_INTERESTED", "BUDGET", "LOCATION", "PRICE_SHOPPER", "NOT_SUITABLE", "UNKNOWN"] as const;
export type DqReasonValue = (typeof DQ_REASONS)[number];
export const DQ_PHASES = ["PRE_CONTACT", "POST_CONTACT", "POST_HANDOVER"] as const;
export type DqPhaseValue = (typeof DQ_PHASES)[number];
export const LOST_REASONS = ["GHOSTED", "WENT_ELSEWHERE", "BUDGET", "UNKNOWN"] as const;
export type LostReasonValue = (typeof LOST_REASONS)[number];

export const STAGE_LABELS: Record<LeadStageValue, string> = {
  NEW_LEAD: "New Lead",
  CHASE_UP: "Chase Up",
  CONTACTED: "Contacted",
  NURTURE: "Nurture",
  HANDOVER_ATTEMPTED: "Handover Attempted",
  HANDOVER_LIVE: "Live Transfer",
  HANDOVER_TEXT: "Text Handover",
  CLIENT_CONTACTED: "Client Contacted",
  CONSULT_BOOKED: "Consult Booked",
  CONSULT_NO_SHOW: "Consult No-Show",
  CONSULT_ATTENDED: "Consult Attended",
  QUOTE_SENT: "Quote Sent",
  WON: "Won",
  LOST: "Lost",
  DISQUALIFIED: "Disqualified",
};

export const DQ_REASON_LABELS: Record<DqReasonValue, string> = {
  GHOSTED: "Ghosted",
  SPAM: "Spam",
  NOT_INTERESTED: "Not interested",
  BUDGET: "Budget",
  LOCATION: "Location",
  PRICE_SHOPPER: "Price shopper",
  NOT_SUITABLE: "Not suitable",
  UNKNOWN: "Reason missing",
};
export const DQ_PHASE_LABELS: Record<DqPhaseValue, string> = {
  PRE_CONTACT: "Before contact",
  POST_CONTACT: "After contact",
  POST_HANDOVER: "After handover",
};
export const LOST_REASON_LABELS: Record<LostReasonValue, string> = {
  GHOSTED: "Ghosted",
  WENT_ELSEWHERE: "Went elsewhere",
  BUDGET: "Budget",
  UNKNOWN: "Reason missing",
};

const muted = { color: "var(--text-secondary)", bg: "var(--surface-hover)" };
const early = { color: "var(--text-primary)", bg: "var(--surface-hover)" };
const handover = { color: "var(--tag-indigo-fg)", bg: "var(--tag-indigo-bg)" };
const consult = { color: "var(--tag-teal-fg)", bg: "var(--tag-teal-bg)" };
export const STAGE_STYLE: Record<LeadStageValue, { color: string; bg: string }> = {
  NEW_LEAD: muted,
  CHASE_UP: early,
  CONTACTED: early,
  NURTURE: { color: "var(--tag-amber-fg)", bg: "var(--tag-amber-bg)" },
  HANDOVER_ATTEMPTED: handover,
  HANDOVER_LIVE: handover,
  HANDOVER_TEXT: handover,
  CLIENT_CONTACTED: { color: "var(--primary-hover)", bg: "var(--primary-tint)" },
  CONSULT_BOOKED: consult,
  CONSULT_NO_SHOW: { color: "var(--danger)", bg: "var(--danger-tint)" },
  CONSULT_ATTENDED: consult,
  QUOTE_SENT: { color: "var(--tag-purple-fg)", bg: "var(--tag-purple-bg)" },
  WON: { color: "var(--primary)", bg: "var(--primary-tint)" },
  LOST: { color: "var(--danger)", bg: "var(--danger-tint)" },
  DISQUALIFIED: { color: "var(--text-muted)", bg: "var(--surface-hover)" },
};

// Funnel position. WON / LOST / DISQUALIFIED share the top rank: all equally
// final, none "further" than another.
export const STAGE_RANK: Record<LeadStageValue, number> = Object.fromEntries(
  LEAD_STAGES.map((s, i) => [s, Math.min(i, LEAD_STAGES.indexOf("WON"))])
) as Record<LeadStageValue, number>;

export const TERMINAL_STAGES: LeadStageValue[] = ["WON", "LOST", "DISQUALIFIED"];
export const HANDOVER_STAGES: LeadStageValue[] = ["HANDOVER_ATTEMPTED", "HANDOVER_LIVE", "HANDOVER_TEXT"];
export const isTerminal = (s: LeadStageValue) => TERMINAL_STAGES.includes(s);

// The steps every won deal must have passed. "A handover" is any of the
// three handover stages; when one has to be inferred we record
// HANDOVER_ATTEMPTED — the weakest claim (a handover happened, method unknown).
export const MAIN_PATH: LeadStageValue[] = ["CONTACTED", "HANDOVER_ATTEMPTED", "CONSULT_BOOKED", "CONSULT_ATTENDED", "QUOTE_SENT"];

function sameStep(a: LeadStageValue, b: LeadStageValue) {
  return a === b || (HANDOVER_STAGES.includes(a) && HANDOVER_STAGES.includes(b));
}

// ── Mapping targets ─────────────────────────────────────────────────────
// stage: null = "no outcome" (e.g. a blank / "N/A" Prospect Status) — the
// value is known and deliberately contributes nothing.
export type StageTarget = { stage: LeadStageValue | null; dqReason?: DqReasonValue; lostReason?: LostReasonValue };

// Stored mapping values are objects now; older rows stored a bare stage
// string ("WON"). The dropdowns use "STAGE", "STAGE:REASON" or "__none__".
export function parseTarget(v: unknown): StageTarget | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "string") {
    if (v === "__none__") return { stage: null };
    const [stage, reason] = v.split(":");
    if (!LEAD_STAGES.includes(stage as LeadStageValue)) return undefined;
    return withReason(stage as LeadStageValue, reason);
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.stage === null) return { stage: null };
    if (!LEAD_STAGES.includes(o.stage as LeadStageValue)) return undefined;
    return withReason(o.stage as LeadStageValue, (o.dqReason ?? o.lostReason) as string | undefined);
  }
  return undefined;
}

function withReason(stage: LeadStageValue, reason?: string): StageTarget {
  if (stage === "DISQUALIFIED") return { stage, dqReason: DQ_REASONS.includes(reason as DqReasonValue) ? (reason as DqReasonValue) : "UNKNOWN" };
  if (stage === "LOST") return { stage, lostReason: LOST_REASONS.includes(reason as LostReasonValue) ? (reason as LostReasonValue) : "UNKNOWN" };
  return { stage };
}

export function encodeTarget(t: StageTarget | undefined): string {
  if (!t) return "";
  if (t.stage === null) return "__none__";
  const reason = t.dqReason ?? t.lostReason;
  return reason ? `${t.stage}:${reason}` : t.stage;
}

export function targetLabel(t: StageTarget | undefined): string {
  if (!t) return "";
  if (t.stage === null) return "No outcome";
  if (t.stage === "DISQUALIFIED") return `DQ · ${DQ_REASON_LABELS[t.dqReason ?? "UNKNOWN"]}`;
  if (t.stage === "LOST") return `Lost · ${LOST_REASON_LABELS[t.lostReason ?? "UNKNOWN"]}`;
  return STAGE_LABELS[t.stage];
}

// Every option a mapping dropdown offers, in funnel order.
export const TARGET_OPTIONS: { value: string; label: string }[] = [
  ...LEAD_STAGES.filter((s) => s !== "LOST" && s !== "DISQUALIFIED").map((s) => ({ value: s, label: STAGE_LABELS[s] })),
  ...LOST_REASONS.map((r) => ({ value: `LOST:${r}`, label: `Lost · ${LOST_REASON_LABELS[r]}` })),
  ...DQ_REASONS.map((r) => ({ value: `DISQUALIFIED:${r}`, label: `DQ · ${DQ_REASON_LABELS[r]}` })),
];

// Hive column + Prospect column → one stage. The higher-ranked wins; on a tie
// (both terminal) the Prospect/result column wins — it's the client's word
// on how the deal ended. `prior` is the furthest non-terminal stage either
// column shows, used for dqPhase and so a DQ still records how far it got.
// `fallback` applies when neither column gives a stage.
export function combineTargets(status: StageTarget | undefined, result: StageTarget | undefined, fallback: LeadStageValue = "NEW_LEAD") {
  const s = status?.stage ? status : undefined;
  const r = result?.stage ? result : undefined;
  const final: StageTarget = !s && !r ? { stage: fallback } : !s ? r! : !r ? s : STAGE_RANK[s.stage!] > STAGE_RANK[r.stage!] ? s : r;
  const prior = [s?.stage, r?.stage]
    .filter((x): x is LeadStageValue => !!x && !isTerminal(x))
    .sort((a, b) => STAGE_RANK[b] - STAGE_RANK[a])[0] ?? null;
  return { final: final as StageTarget & { stage: LeadStageValue }, prior };
}

export function dqPhaseFor(furthest: LeadStageValue | null): DqPhaseValue {
  const rank = furthest ? STAGE_RANK[furthest] : 0;
  if (rank <= STAGE_RANK.CHASE_UP) return "PRE_CONTACT";
  if (rank <= STAGE_RANK.NURTURE) return "POST_CONTACT";
  return "POST_HANDOVER";
}

// Furthest non-terminal stage a lead is known to have reached.
export function furthestReached(stages: Iterable<LeadStageValue>): LeadStageValue | null {
  let best: LeadStageValue | null = null;
  for (const s of stages) if (!isTerminal(s) && (!best || STAGE_RANK[s] > STAGE_RANK[best])) best = s;
  return best;
}

export type PlannedEvent = { stage: LeadStageValue; kind: "change" | "observed" | "inferred" };

// Which LeadStageEvents a stage change (sync or manual) should write:
// - "change": the new stage itself, when it differs from the old one
// - "observed": the other column's non-terminal stage, first time we see it
//   (so a DQ from the Prospect column still records the handover it reached)
// - "inferred": main-path stages the lead must have passed but we never saw
//   (CHASE_UP → WON implies contacted, handover, consult, quote)
// plus the dqPhase if the new stage is DISQUALIFIED.
export function planStageEvents(opts: {
  oldStage: LeadStageValue | null; // null = brand-new lead
  newStage: LeadStageValue;
  prior: LeadStageValue | null;
  eventStages: Set<LeadStageValue>;
}): { events: PlannedEvent[]; dqPhase: DqPhaseValue | null } {
  const { oldStage, newStage, prior, eventStages } = opts;
  const events: PlannedEvent[] = [];
  const known = new Set(eventStages);
  const add = (stage: LeadStageValue, kind: PlannedEvent["kind"]) => {
    events.push({ stage, kind });
    known.add(stage);
  };

  if (newStage !== oldStage && newStage !== "NEW_LEAD") add(newStage, "change");
  if (prior && prior !== newStage && prior !== oldStage && !known.has(prior)) add(prior, "observed");

  // How far up the main path this lead provably got.
  const topRank =
    newStage === "WON"
      ? STAGE_RANK.WON
      : isTerminal(newStage)
      ? Math.max(prior ? STAGE_RANK[prior] : 0, oldStage && !isTerminal(oldStage) ? STAGE_RANK[oldStage] : 0)
      : STAGE_RANK[newStage];
  for (const m of MAIN_PATH) {
    if (STAGE_RANK[m] >= topRank) break;
    const have = Array.from(known).some((k) => sameStep(k, m)) || (oldStage != null && sameStep(oldStage, m));
    if (!have) add(m, "inferred");
  }

  const dqPhase = newStage === "DISQUALIFIED" ? dqPhaseFor(furthestReached([...known, ...(oldStage ? [oldStage] : []), ...(prior ? [prior] : [])])) : null;
  return { events, dqPhase };
}
