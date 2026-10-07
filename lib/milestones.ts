import { Prisma } from "@prisma/client";
import type { LeadStageValue } from "./lead-status";
import { CALL_ATTEMPT_EVENTS, type NoteEventValue } from "./notes-parser";

// When a lead reached a funnel step — the one rule every duration, KPI,
// comparison and sale date uses:
//   1. the team's first dated note for that step (LeadNoteEvent), else
//   2. the first stage change the app actually saw happen (LeadStageEvent
//      with source SYNC / MANUAL / NOTE), else
//   3. unknown (null). IMPORT / INFERRED events are never used: their time is
//      just when we first synced, not when it happened.
// A step can be several stages (any handover); its time is the earliest.

// Which note events stand for which stage.
const NOTE_EVENTS_FOR: Partial<Record<LeadStageValue, NoteEventValue[]>> = {
  CONTACTED: CALL_ATTEMPT_EVENTS,
  HANDOVER_LIVE: ["HANDOVER_LIVE"],
  HANDOVER_TEXT: ["HANDOVER_TEXT"],
  CONSULT_BOOKED: ["CONSULT_BOOKED"],
  CONSULT_ATTENDED: ["CONSULT_ATTENDED"],
  QUOTE_SENT: ["QUOTE_SENT"],
  DISQUALIFIED: ["DQ_SPAM"],
};

export const TIMED_SOURCES = ["SYNC", "MANUAL", "NOTE"] as const;

const list = (stages: LeadStageValue | LeadStageValue[]) => (Array.isArray(stages) ? stages : [stages]);
const noteEventsFor = (stages: LeadStageValue[]) => Array.from(new Set(stages.flatMap((s) => NOTE_EVENTS_FOR[s] ?? [])));

type MilestoneLead = {
  noteEvents: { event: NoteEventValue; at: Date }[];
  stageEvents: { stage: LeadStageValue; at: Date; source: string }[];
};

const earliest = (dates: Date[]) => (dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null);

export function getMilestoneDate(lead: MilestoneLead, stages: LeadStageValue | LeadStageValue[]): Date | null {
  const s = list(stages);
  const notes = noteEventsFor(s);
  return (
    earliest(lead.noteEvents.filter((n) => notes.includes(n.event)).map((n) => n.at)) ??
    earliest(lead.stageEvents.filter((e) => s.includes(e.stage) && (TIMED_SOURCES as readonly string[]).includes(e.source)).map((e) => e.at))
  );
}

// A lead's journey for the lead drawer: opt-in → contacted → handover →
// booked → quoted → its outcome, each with its date (null = not reached /
// unknown) and the days since the previous dated step.
export type TimelineStep = { key: string; label: string; at: Date | null; days: number | null };
export function leadTimeline(lead: MilestoneLead & { createdAt: Date; stage: LeadStageValue }): TimelineStep[] {
  const steps: { key: string; label: string; at: Date | null }[] = [
    { key: "optin", label: "Opted in", at: lead.createdAt },
    { key: "contacted", label: "Contacted", at: getMilestoneDate(lead, "CONTACTED") },
    { key: "handover", label: "Handed over", at: getMilestoneDate(lead, ["HANDOVER_LIVE", "HANDOVER_ATTEMPTED", "HANDOVER_TEXT"]) },
    { key: "booked", label: "Consult booked", at: getMilestoneDate(lead, "CONSULT_BOOKED") },
    { key: "quoted", label: "Quoted", at: getMilestoneDate(lead, "QUOTE_SENT") },
  ];
  const outcome = ({ WON: "Won", LOST: "Lost", DISQUALIFIED: "Disqualified" } as Partial<Record<LeadStageValue, string>>)[lead.stage];
  if (outcome) steps.push({ key: "outcome", label: outcome, at: getMilestoneDate(lead, lead.stage) });
  let prev: Date | null = null;
  return steps.map((s) => {
    const days = s.at && prev ? Math.round((s.at.getTime() - prev.getTime()) / 86_400_000) : null;
    if (s.at) prev = s.at;
    return { ...s, days };
  });
}

// The same rule as a SQL expression, for the lead aliased `l`. A function,
// not a constant: some of these modules load in the browser, where building
// Prisma.sql at import time throws.
export function milestoneSql(stages: LeadStageValue | LeadStageValue[]): Prisma.Sql {
  const s = list(stages);
  const notes = noteEventsFor(s);
  const fromNotes = notes.length
    ? Prisma.sql`(SELECT MIN(ne.at) FROM "LeadNoteEvent" ne WHERE ne."leadId" = l.id AND ne.event::text IN (${Prisma.join(notes)}))`
    : Prisma.sql`NULL::timestamp`;
  return Prisma.sql`COALESCE(
    ${fromNotes},
    (SELECT MIN(e.at) FROM "LeadStageEvent" e WHERE e."leadId" = l.id AND e.stage::text IN (${Prisma.join(s)}) AND e.source::text IN (${Prisma.join([...TIMED_SOURCES])}))
  )`;
}

// A sale's date. The WON milestone when we have one; a lead that was already
// Won when first imported has no real close time, so its last dated note
// stands in, else (last resort, so its revenue isn't lost) its opt-in date.
export const wonAtSql = () => Prisma.sql`COALESCE(
  ${milestoneSql("WON")},
  (SELECT MAX(ne.at) FROM "LeadNoteEvent" ne WHERE ne."leadId" = l.id),
  l."createdAt"
)`;
