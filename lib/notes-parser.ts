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

// First match wins. Short tokens (np, vm, lt, dnd) need word boundaries so
// they don't fire inside other words.
const RULES: [RegExp, NoteEventValue][] = [
  [/\bnp\b|no pick ?up|\bvm\b|voicemail|txt sent|\bbusy\b|\bdnd\b/i, "CALL_ATTEMPT"],
  [/wrong num|disconnected|invalid|incorrect number|test lead/i, "DQ_SPAM"],
  [/live to|\blt to\b|live transfer|\blt\b/i, "HANDOVER_LIVE"],
  [/live att|email handover|txt handover|text handover|handover/i, "HANDOVER_TEXT"],
  [/self ?booked|booked (in|for)/i, "CONSULT_BOOKED"],
  [/site visit done|inspection done/i, "CONSULT_ATTENDED"],
  [/quote provided|quoted/i, "QUOTE_SENT"],
];

export function classifyNoteText(text: string): NoteEventValue {
  for (const [re, event] of RULES) if (re.test(text)) return event;
  return "NOTE";
}

// "<who> <d/m>[>] <text>" — who is any word (hs, maddy, mddy, al, ...).
const ENTRY = /^\s*([a-z]+)\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*>?\s*(.*)$/i;

function sydneyYearMonth(d: Date) {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: SHEET_TZ, year: "numeric", month: "numeric" }).formatToParts(d);
  return { year: Number(parts.find((p) => p.type === "year")!.value), month: Number(parts.find((p) => p.type === "month")!.value) };
}

// Undated fragments ("vm left" after "HS 12/3> NP,") belong to the entry
// before them — the comma split them, the team didn't. Fragments before the
// first dated entry have no date to hang on and are dropped.
export function parseNotes(cell: string, optIn: Date): ParsedNote[] {
  const { year: optInYear, month: optInMonth } = sydneyYearMonth(optIn);
  const entries: { who: string; day: number; month: number; text: string }[] = [];

  for (const fragment of cell.split(/[,\n\r]+/)) {
    const m = fragment.match(ENTRY);
    const day = m ? Number(m[2]) : NaN;
    const month = m ? Number(m[3]) : NaN;
    if (m && day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      entries.push({ who: m[1].toLowerCase(), day, month, text: m[4].trim() });
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
    out.push({ at, who: e.who, event: classifyNoteText(e.text), rawText: e.text });
  }
  return out;
}
