// Free-text sheet status → funnel stage, by keyword. Teams type these by
// hand ("DSIQUALIFED BUDGET", "QUOTED - LOST", ":phone: Lead Contacted"), so
// exact-match tables miss most real values. A client's saved statusMapping
// always wins over these rules (see lib/lead-sync.ts). Pure — safe in the UI.
//
// Two columns, two readers: HIVE STATUS (our team's outreach) and Prospect
// Status (the client's word on the outcome). They share one rule list — a
// hive cell that says "QUOTED" still means quoted — and differ only in what
// "nothing" means: a blank hive cell is the default Chase Up, a blank
// prospect cell is no update at all.

import { normalizeStatus } from "./sheet-parse";
import type { DqReasonValue, LeadStageValue, LostReasonValue } from "./lead-status";

export type ClassifiedStatus = { stage: LeadStageValue; dqReason?: DqReasonValue; lostReason?: LostReasonValue };

// Common misspellings seen in real sheets, fixed before matching.
function fixTypos(s: string) {
  return s
    .replace(/\b(dsiqualifi?ed|disqualifed|disqualfied|disqualifid|disqaulified|dq)\b/g, "disqualified")
    .replace(/\bsuiteable\b/g, "suitable");
}

export const normalizeStatusText = (raw: string | null | undefined) => fixTypos(normalizeStatus(raw));

const has = (s: string, re: RegExp) => re.test(s);

function lostReason(s: string): LostReasonValue {
  if (has(s, /ghost/)) return "GHOSTED";
  if (has(s, /elsewhere|someone else/)) return "WENT_ELSEWHERE";
  if (has(s, /budget|price|expensive/)) return "BUDGET";
  return "UNKNOWN";
}

function dqReason(s: string): DqReasonValue {
  if (has(s, /distance|location|area|too far/)) return "LOCATION";
  if (has(s, /budget/)) return "BUDGET";
  if (has(s, /price shopper/)) return "PRICE_SHOPPER";
  if (has(s, /not suitable/)) return "NOT_SUITABLE";
  if (has(s, /ghost/)) return "GHOSTED";
  if (has(s, /spam|wrong number/)) return "SPAM";
  if (has(s, /not interested/)) return "NOT_INTERESTED";
  return "UNKNOWN";
}

// The shared rules, on already-normalized text. First match wins; undefined
// = not recognised (reported back as unmapped, never guessed).
function classify(s: string): ClassifiedStatus | undefined {
  if (has(s, /\bwon\b|\bsold\b/)) return { stage: "WON" };
  if (has(s, /\bquoted\b/) && has(s, /\blost\b/)) return { stage: "LOST", lostReason: lostReason(s) };
  if (has(s, /\blost\b/)) return { stage: "LOST", lostReason: lostReason(s) };
  if (has(s, /\bquoted\b|\bquote sent\b/)) return { stage: "QUOTE_SENT" };
  if (has(s, /\bdidnt attend\b|\bno show\b/)) return { stage: "CONSULT_NO_SHOW" };
  if (has(s, /\battended\b/)) return { stage: "CONSULT_ATTENDED" };
  if (has(s, /\bcancell?ed\b/)) return { stage: "CONSULT_CANCELLED" };
  if (has(s, /\bbooked\b|\bpre consult\b/)) return { stage: "CONSULT_BOOKED" };
  if (has(s, /\bdisqualified\b|\bnot suitable\b|\bprice shopper\b|\btoo far\b/)) return { stage: "DISQUALIFIED", dqReason: dqReason(s) };
  if (has(s, /\blive transfer\b/)) return { stage: "HANDOVER_LIVE" };
  if (has(s, /\blive attempted\b/)) return { stage: "HANDOVER_ATTEMPTED" };
  if (has(s, /\btext hand ?over\b/)) return { stage: "HANDOVER_TEXT" };
  if (has(s, /\bclient contacted\b/)) return { stage: "CLIENT_CONTACTED" };
  if (has(s, /\blead contacted\b/)) return { stage: "CONTACTED" };
  if (has(s, /\bnot ready\b/)) return { stage: "NURTURE" };
  if (has(s, /\bchase up\b|\bnew lead\b|\bcall back\b/)) return { stage: "CHASE_UP" };
  return undefined;
}

const NOTHING = new Set(["", "n a", "na"]);

// HIVE STATUS. Blank / N/A / "pending update" = the default stage, Chase Up.
export function classifyHive(raw: string | null | undefined): ClassifiedStatus | undefined {
  const s = normalizeStatusText(raw);
  if (NOTHING.has(s) || s === "pending update") return { stage: "CHASE_UP" };
  return classify(s);
}

// Prospect Status. null = no update from the client (blank, N/A, pending
// update) — see isPendingUpdate for the one that also flags them as owing one.
export function classifyProspect(raw: string | null | undefined): ClassifiedStatus | null | undefined {
  const s = normalizeStatusText(raw);
  if (NOTHING.has(s) || s === "pending update") return null;
  return classify(s);
}

export const isPendingUpdate = (raw: string | null | undefined) => normalizeStatusText(raw) === "pending update";
