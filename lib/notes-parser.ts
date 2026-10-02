// The sheet's feedback/notes cell → dated events. The team logs every touch
// as "<who> <d/m>[>] <text>", comma- or newline-separated, e.g.
//   "HS 12/3> NP, vm left, Maddy 13/3 live to Jake"
// Dates are Australian day/month with no year; the year comes from the
// lead's opt-in date. Pure — no DB, no network (the AI fallback for entries
// these rules can't place lives in lib/notes-ai.ts).

import { SHEET_TZ, sydneyLocalToDate } from "./sheet-parse";

export const NOTE_EVENTS = [
  "CALL_ATTEMPT",
  "DQ_SPAM",
  "HANDOVER_LIVE",
  "HANDOVER_TEXT",
  "CONSULT_BOOKED",
  "CONSULT_ATTENDED",
  "QUOTE_SENT",
  "NOTE",
] as const;
export type NoteEventValue = (typeof NOTE_EVENTS)[number];

export type ParsedNote = { at: Date; who: string; event: NoteEventValue; rawText: string };

export const NOTES_KEYWORDS = ["feedback", "notes"];

// First match wins, most specific first: one entry often logs two things
// ("no pickup from jake, email handover") and the outcome matters more than
// the failed call, so call attempts are checked last. Short tokens (np, vm,
// lt, dnd) need word boundaries so they don't fire inside other words.
const RULES: [RegExp, NoteEventValue][] = [
  [/wrong num|disconnected|invalid|incorrect number|test lead/i, "DQ_SPAM"],
  [/live to|\blt to\b|live transfer|\blt\b/i, "HANDOVER_LIVE"],
  [/live att|email handover|txt handover|text handover|handover/i, "HANDOVER_TEXT"],
  [/self ?booked|booked (in|for)/i, "CONSULT_BOOKED"],
  [/site visit done|inspection done/i, "CONSULT_ATTENDED"],
  [/quote provided|quoted/i, "QUOTE_SENT"],
  // "no pickup" as actually typed: "nopicup", "no picukp", "no pick up"
  [/\bnp\b|\bno ?pi[a-z]{0,4}p\b|no pick ?up|\bvm\b|voicemail|txt sent|\bbusy\b|\bdnd\b/i, "CALL_ATTEMPT"],
];

export function classifyNoteText(text: string): NoteEventValue {
  for (const [re, event] of RULES) if (re.test(text)) return event;
  return "NOTE";
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
