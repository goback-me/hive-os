// Pure parsing helpers for Google Sheet cells — no DB, no network, so
// `npx tsx lib/sheet-parse.check.ts` can exercise them directly.

export const SHEET_TZ = "Australia/Sydney";

// The Sydney calendar day an instant falls on, as "2026-09-29".
export const sydneyDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: SHEET_TZ }).format(d);

export function normalizeHeader(h: string) {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Sheet headers are messy in practice (line breaks, trailing "?"/spaces).
// An exact normalized match always wins ("Name" beats "Campaign Name");
// otherwise the first header that CONTAINS a keyword. `exclude` words veto a
// header entirely, so "Campaign Name" / "Ad Name" can never be the lead's name.
export function findColumn(headers: string[], keywords: string[], exclude: string[] = []): number {
  const normalized = headers.map(normalizeHeader);
  const allowed = (h: string) => !exclude.some((x) => (x.includes(" ") ? h.includes(x) : h.split(" ").includes(x)));
  const exact = normalized.findIndex((h) => allowed(h) && keywords.includes(h));
  if (exact !== -1) return exact;
  for (const kw of keywords) {
    const i = normalized.findIndex((h) => allowed(h) && h.includes(kw));
    if (i !== -1) return i;
  }
  return -1;
}

export const DATE_OPT_IN_KEYWORDS = ["date opt in", "opt in"];

// A saved column name vs the live headers. Sheets headers pick up stray
// spaces, line breaks and case changes over time — "HIVE STATUS" and
// "Hive\nStatus " are the same column. Exact match first, then normalized.
export function normalizeHeaderName(h: string) {
  return h.toLowerCase().replace(/\s+/g, " ").trim();
}

// Best guess at the two status columns when none have been picked yet —
// "HIVE STATUS" (outreach stage) and "Prospect Status" (outcome). Feedback/
// notes columns are excluded even when their header says "status"
// ("Pospect Status / Feedback"). Returns header names, or null.
export function detectStatusColumns(headers: string[]) {
  const notNotes = ["feedback", "notes", "note", "comment", "comments"];
  const result = findColumn(headers, ["prospect status", "result status", "outcome"], notNotes);
  const status = findColumn(headers, ["hive status", "lead status", "status"], [...notNotes, "prospect", "result"]);
  return {
    statusColumn: status !== -1 && status !== result ? headers[status] : null,
    resultStatusColumn: result !== -1 ? headers[result] : null,
  };
}

export function findHeaderIndex(headers: string[], name: string | null | undefined): number {
  if (!name) return -1;
  const exact = headers.indexOf(name);
  if (exact !== -1) return exact;
  const target = normalizeHeaderName(name);
  return headers.findIndex((h) => normalizeHeaderName(h) === target);
}

// Letters and digits only, lowercased — "Jane  O'Brien" = "janeobrien". The
// lead's name identity (and the sync's externalKey).
export function normalizeName(v: string | null | undefined) {
  return (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizeEmail(v: string | null | undefined) {
  return (v ?? "").trim().toLowerCase();
}

// Digits only, AU mobiles in international form: "0412 345 678",
// "+61 412 345 678" and a Sheets number that lost its leading 0
// (412345678) all become "61412345678".
export function normalizePhone(v: string | null | undefined) {
  const d = (v ?? "").replace(/\D/g, "");
  if (/^04\d{8}$/.test(d)) return "61" + d.slice(1);
  if (/^4\d{8}$/.test(d)) return "61" + d;
  return d;
}

// Sheet status text → a stable mapping key. "DISQUALIFIED ",
// ":phone: Lead Contacted :phone:", "📞 Lead contacted" and "lead contacted"
// all become "lead contacted"; "Didn't attend" → "didnt attend"; "N/A" → "n a".
export function normalizeStatus(v: string | null | undefined) {
  return (v ?? "")
    .toLowerCase()
    .replace(/:[a-z0-9_+-]+:/g, " ")
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, " ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Offset (ms) of `tz` from UTC at the given instant.
function tzOffsetMs(instant: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// A wall-clock time in Sydney → the real instant (handles AEST/AEDT).
export function sydneyLocalToDate(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wall);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null; // e.g. 31/02
  let instant = wall - tzOffsetMs(wall, SHEET_TZ);
  instant = wall - tzOffsetMs(instant, SHEET_TZ); // second pass settles DST edges
  return new Date(instant);
}

// Sheets serial number (days since 1899-12-30, fraction = time of day),
// read as a Sydney wall-clock time.
export function serialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const wall = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  return sydneyLocalToDate(
    wall.getUTCFullYear(),
    wall.getUTCMonth() + 1,
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds()
  );
}

// Opt-in date cell → Date. Numbers are Sheets serials; strings are read as
// dd/mm/yyyy (optional time, optional am/pm), then ISO. Never mm/dd — an
// ambiguous "03/04/2026" is always 3 April.
export function parseSheetDate(v: unknown): Date | null {
  if (typeof v === "number") return serialToDate(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?$/i);
  if (dmy) {
    const [, d, mo, yRaw, hRaw, mi, sec, ampm] = dmy;
    let y = Number(yRaw);
    if (yRaw.length === 2) y += 2000;
    let h = Number(hRaw ?? 0);
    if (ampm) {
      if (h < 1 || h > 12) return null;
      const pm = ampm.toLowerCase().startsWith("p");
      h = (h % 12) + (pm ? 12 : 0);
    }
    return sydneyLocalToDate(y, Number(mo), Number(d), h, Number(mi ?? 0), Number(sec ?? 0));
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (iso) {
    const [, y, mo, d, h, mi, sec, zone] = iso;
    if (zone) {
      const t = Date.parse(s.replace(" ", "T"));
      return Number.isNaN(t) ? null : new Date(t);
    }
    return sydneyLocalToDate(Number(y), Number(mo), Number(d), Number(h ?? 0), Number(mi ?? 0), Number(sec ?? 0));
  }

  return null;
}

// dd/mm/yyyy (Sydney) for showing a serial date cell as text.
export function formatSheetDate(d: Date) {
  return new Intl.DateTimeFormat("en-AU", { timeZone: SHEET_TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

// Unformatted cell → text. Numbers lose Sheets' display formatting, so a
// mobile typed as a number (412345678) gets its leading 0 back elsewhere.
export function cellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
