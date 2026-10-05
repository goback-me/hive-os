// The sheet's feedback/notes cell → dated events. The team logs every touch
// as "<who> <d/m>[>] <text>", comma- or newline-separated, e.g.
//   "HS 12/3> NP, vm left, Maddy 13/3 live to Jake"
// Dates are Australian day/month with no year; the year comes from the
// lead's opt-in date. Pure — no DB, no network (the AI fallback for entries
// these rules can't place lives in lib/notes-ai.ts).

import { SHEET_TZ, sydneyLocalToDate } from "./sheet-parse";
import type { DqReasonValue } from "./lead-status";

export const NOTE_EVENTS = [
  "CALL_ATTEMPT",
  "DQ_SPAM",
  "HANDOVER_LIVE",
  "HANDOVER_TEXT",
  "CONSULT_BOOKED",
  "CONSULT_ATTENDED",
  "QUOTE_SENT",
  "NOTE",
  "NO_PICKUP",
  "TEXT_SENT",
  "CANT_CONTACT",
  "AM_SCENARIO",
] as const;
export type NoteEventValue = (typeof NOTE_EVENTS)[number];

// Every kind of failed reach counts as a call attempt (CALL_ATTEMPT itself
// = one the AI placed, or tagged before the kinds existed).
export const CALL_ATTEMPT_EVENTS: NoteEventValue[] = ["CALL_ATTEMPT", "NO_PICKUP", "TEXT_SENT", "CANT_CONTACT"];
export const isCallAttempt = (e: NoteEventValue) => CALL_ATTEMPT_EVENTS.includes(e);

// Chip labels for the lead timeline.
export const NOTE_EVENT_LABELS: Record<NoteEventValue, string> = {
  CALL_ATTEMPT: "Call attempt",
  NO_PICKUP: "No pickup",
  TEXT_SENT: "Text sent",
  CANT_CONTACT: "Can't contact",
  DQ_SPAM: "DQ",
  HANDOVER_LIVE: "Live transfer",
  HANDOVER_TEXT: "Text handover",
  CONSULT_BOOKED: "Booked",
  CONSULT_ATTENDED: "Attended",
  QUOTE_SENT: "Quoted",
  AM_SCENARIO: "AM note",
  NOTE: "Note",
};

// "<who>" at the start of an entry: "hs" is the Hive call team; anyone else
// is that person — a client's alias map (Client.noteAliases) fixes
// shorthand/typos (mddy → Maddy).
export function noteAuthor(who: string, aliases: Record<string, string> = {}) {
  const key = who.trim().toLowerCase();
  const alias = Object.entries(aliases).find(([k]) => k.trim().toLowerCase() === key)?.[1];
  if (alias?.trim()) return alias.trim();
  if (key === "hs") return "Hive call team";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function parseAliases(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[0].trim() && !!e[1].trim()));
}

export type ParsedNote = { at: Date; who: string; event: NoteEventValue; rawText: string };

export const NOTES_KEYWORDS = ["feedback", "notes"];

// First match wins, most specific first: one entry often logs two things
// ("no pickup from jake, email handover") and the outcome matters more than
// the failed call, so call attempts are checked last. Short tokens (np, vm,
// lt, dnd) need word boundaries so they don't fire inside other words.
const SPAM = /wrong num|disconnected|invalid|incorrect number|test lead|weird number/i;
const RULES: [RegExp, NoteEventValue][] = [
  [SPAM, "DQ_SPAM"],
  [/live to|\blt to\b|live transfer|\blt\b/i, "HANDOVER_LIVE"],
  [/live att|email handover|txt handover|text handover|handover/i, "HANDOVER_TEXT"],
  [/self ?booked|booked (in|for)/i, "CONSULT_BOOKED"],
  [/site visit done|inspection done/i, "CONSULT_ATTENDED"],
  [/quote provided|quoted/i, "QUOTE_SENT"],
  // "no pickup" as actually typed: "nopicup", "no picukp", "no pick up"
  [/\bnp\b|\bno ?pi[a-z]{0,4}p\b|no pick ?up/i, "NO_PICKUP"],
  [/txt sent|text sent/i, "TEXT_SENT"],
  [/\bvm\b|voicemail|\bbusy\b|\bdnd\b|call closes|incoming call restrict/i, "CANT_CONTACT"],
];

// A write-up this long with no shorthand in it is an account manager's
// scenario — kept as AM_SCENARIO and read by the AI passes.
const AM_SCENARIO_WORDS = 12;

export function classifyNoteText(text: string): NoteEventValue {
  for (const [re, event] of RULES) if (re.test(text)) return event;
  return text.trim().split(/\s+/).length > AM_SCENARIO_WORDS ? "AM_SCENARIO" : "NOTE";
}

// ── DQ reason from the feedback ──────────────────────────────────────────
// For a lead our team disqualified (HIVE STATUS = DQ) with nothing in
// Prospect Status: the latest entry that says why wins.
const DQ_RULES: [RegExp, DqReasonValue][] = [
  [SPAM, "SPAM"],
  [/too far|out of area|distance|don.?t service|not in (our )?area/i, "LOCATION"],
  [/expensive|budget|price/i, "BUDGET"],
  [/not interested|didn.?t inquire|already got someone|no idea/i, "NOT_INTERESTED"],
];

export type DqFromNotes = {
  reason: DqReasonValue | null; // null + needsAI = the AI pass decides
  phase: "PRE_CONTACT" | "POST_CONTACT" | null; // null = no entries to go on
  evidence: string | null;
  needsAI: boolean;
};

export function dqFromNotes(notes: Pick<ParsedNote, "at" | "event" | "rawText">[]): DqFromNotes {
  if (!notes.length) return { reason: "UNKNOWN", phase: null, evidence: null, needsAI: false };
  const onlyAttempts = notes.every((n) => isCallAttempt(n.event));
  const phase = onlyAttempts ? "PRE_CONTACT" : "POST_CONTACT";
  // Latest first; same day → the later entry in the cell.
  const latest = notes.map((n, i) => ({ n, i })).sort((a, b) => b.n.at.getTime() - a.n.at.getTime() || b.i - a.i).map((x) => x.n);
  for (const n of latest) {
    for (const [re, reason] of DQ_RULES) {
      if (!re.test(n.rawText)) continue;
      const shopper = reason === "BUDGET" && /quotes|looking around/i.test(n.rawText);
      return { reason: shopper ? "PRICE_SHOPPER" : reason, phase, evidence: n.rawText, needsAI: false };
    }
  }
  if (onlyAttempts) return { reason: "GHOSTED", phase, evidence: null, needsAI: false };
  return { reason: null, phase, evidence: null, needsAI: true };
}

// "<who> <d/m>[>] <text>" — who is any word (hs, maddy, mddy, al, ...).
const ENTRY = /^\s*([a-z]+)\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*>?\s*(.*)$/i;
// Sometimes typed the other way round: "number disconnected hs 20/7".
const ENTRY_TRAILING = /^\s*(.*?)\s+([a-z]+)\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;

function matchEntry(fragment: string) {
  const m = fragment.match(ENTRY);
  if (m) return { who: m[1], day: Number(m[2]), month: Number(m[3]), text: m[4] };
  const t = fragment.match(ENTRY_TRAILING);
  if (t) return { who: t[2], day: Number(t[3]), month: Number(t[4]), text: t[1] };
  return null;
}

function sydneyYearMonth(d: Date) {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: SHEET_TZ, year: "numeric", month: "numeric" }).formatToParts(d);
  return { year: Number(parts.find((p) => p.type === "year")!.value), month: Number(parts.find((p) => p.type === "month")!.value) };
}

// Undated fragments ("vm left" after "HS 12/3> NP,") belong to the entry
// before them — the comma split them, the team didn't. Fragments before the
// first dated entry have no date to hang on and are dropped. So is an entry
// whose date lands in the future: a typo like "4/4" on an August lead rolls
// over to next April, and a future date would skew timings and revenue
// months (the un-rolled date is before opt-in, so it's no better).
export function parseNotes(cell: string, optIn: Date, now = new Date()): ParsedNote[] {
  const { year: optInYear, month: optInMonth } = sydneyYearMonth(optIn);
  const entries: { who: string; day: number; month: number; text: string }[] = [];

  for (const fragment of cell.split(/[,\n\r]+/)) {
    const m = matchEntry(fragment);
    if (m && m.day >= 1 && m.day <= 31 && m.month >= 1 && m.month <= 12) {
      entries.push({ who: m.who.toLowerCase(), day: m.day, month: m.month, text: m.text.trim() });
    } else if (entries.length && fragment.trim()) {
      const last = entries[entries.length - 1];
      last.text = last.text ? `${last.text}, ${fragment.trim()}` : fragment.trim();
    }
  }

  const out: ParsedNote[] = [];
  for (const e of entries) {
    // Notes run after opt-in: a month earlier than the opt-in month is next year.
    const year = e.month < optInMonth ? optInYear + 1 : optInYear;
    const at = sydneyLocalToDate(year, e.month, e.day);
    if (!at) continue; // e.g. 31/2
    if (at.getTime() > now.getTime() + 86_400_000) continue; // can't have happened yet
    out.push({ at, who: e.who, event: classifyNoteText(e.text), rawText: e.text });
  }
  return out;
}
