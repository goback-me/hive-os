import { sydneyDay, sydneyLocalToDate } from "./sheet-parse";

// ── Report ranges (every date picker) ──────────────────────────────────────
// One picker per tab, kept in the URL (?range=custom&from=2026-09-01&to=…) so
// a refresh or a shared link shows the same period. Days are Sydney calendar
// days; "since_start" resolves to no lower bound, which the server clamps to
// the client's start date (lib/reporting-scope.ts clampRange).

export const REPORT_PRESETS = ["this_month", "last_month", "last_3_months", "since_start", "custom"] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];
export const REPORT_LABELS: Record<ReportPreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  since_start: "Since start",
  custom: "Custom",
};

export type ReportRange = { preset: ReportPreset; from?: string; to?: string }; // from/to: "YYYY-MM-DD", inclusive

const isDay = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && sydneyStart(v) != null;
const sydneyStart = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return sydneyLocalToDate(y, m, d);
};
const shiftDay = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
// First day of the Sydney month `n` months from `day`'s month.
const monthStart = (day: string, n = 0) => {
  const [y, m] = day.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`;
};

export const DEFAULT_REPORT_RANGE: ReportRange = { preset: "since_start" };

export function parseReportRange(sp: { get(k: string): string | null }): ReportRange {
  const preset = sp.get("range") as ReportPreset;
  if (!REPORT_PRESETS.includes(preset)) return DEFAULT_REPORT_RANGE;
  if (preset !== "custom") return { preset };
  const from = sp.get("from");
  const to = sp.get("to");
  if (!isDay(from) || !isDay(to)) return DEFAULT_REPORT_RANGE;
  return from <= to ? { preset, from, to } : { preset, from: to, to: from };
}

export function reportRangeQuery(r: ReportRange) {
  return r.preset === "custom" ? `range=custom&from=${r.from}&to=${r.to}` : `range=${r.preset}`;
}

export function reportRangeLabel(r: ReportRange) {
  if (r.preset !== "custom") return REPORT_LABELS[r.preset];
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${fmt(r.from!)} – ${fmt(r.to!)}`;
}

// Inclusive Sydney days → {from, to exclusive}. this_month / last_3_months
// run to now; last_3_months = this month plus the two before it.
function reportDays(r: ReportRange, now: Date): { since?: string; until?: string } {
  const today = sydneyDay(now);
  switch (r.preset) {
    case "this_month":
      return { since: monthStart(today) };
    case "last_month":
      return { since: monthStart(today, -1), until: shiftDay(monthStart(today), -1) };
    case "last_3_months":
      return { since: monthStart(today, -2) };
    case "custom":
      return { since: r.from, until: r.to };
    default:
      return {};
  }
}

const toRange = ({ since, until }: { since?: string; until?: string }, now: Date) => ({
  ...(since ? { from: sydneyStart(since)! } : {}),
  to: until ? sydneyStart(shiftDay(until, 1))! : now,
});

export function resolveReportRange(r: ReportRange, now = new Date()): { from?: Date; to?: Date } {
  const range = toRange(reportDays(r, now), now);
  return r.preset === "since_start" ? {} : range;
}

// The period a report compares against: month presets shift back a month
// (this month so far vs the same days of last month; last 3 months vs the 3
// before), a custom range vs the equally long run of days just before it.
// "Since start" has nothing before it.
export function previousReportRange(r: ReportRange, now = new Date()): { from: Date; to: Date; label: string } | null {
  const today = sydneyDay(now);
  const mon = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" });
  let since: string, until: string, label: string;
  switch (r.preset) {
    case "this_month": {
      since = monthStart(today, -1);
      const dom = Number(today.slice(8, 10));
      const lastDay = shiftDay(monthStart(today), -1);
      until = shiftDay(since, dom - 1) > lastDay ? lastDay : shiftDay(since, dom - 1);
      label = `1–${Number(until.slice(8, 10))} ${mon(since)}`;
      break;
    }
    case "last_month":
      since = monthStart(today, -2);
      until = shiftDay(monthStart(today, -1), -1);
      label = mon(since);
      break;
    case "last_3_months":
      since = monthStart(today, -5);
      until = shiftDay(monthStart(today, -2), -1);
      label = `${mon(since)}–${mon(until)}`;
      break;
    case "custom": {
      const len = Math.round((Date.UTC(...ymd(r.to!)) - Date.UTC(...ymd(r.from!))) / 86_400_000) + 1;
      until = shiftDay(r.from!, -1);
      since = shiftDay(r.from!, -len);
      label = reportRangeLabel({ preset: "custom", from: since, to: until });
      break;
    }
    default:
      return null;
  }
  return { from: sydneyStart(since)!, to: sydneyStart(shiftDay(until, 1))!, label };
}

const ymd = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m - 1, d] as [number, number, number];
};

// Report APIs read the range from the URL params (lib/date-range.ts presets).
// allTime = no lower bound was asked for ("Since start").
export function rangeFromParams(sp: { get(k: string): string | null }, now = new Date()) {
  const r = parseReportRange(sp);
  return { range: resolveReportRange(r, now), allTime: r.preset === "since_start", label: reportRangeLabel(r), report: r };
}
