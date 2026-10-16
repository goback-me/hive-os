"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { REPORT_LABELS, REPORT_PRESETS, parseReportRange, reportRangeDates, reportRangeDays, reportRangeLabel, reportRangeQuery, type ReportRange } from "@/lib/date-range";

// The selected report range lives in the URL (?range=…&from=…&to=…), so it
// survives a refresh and can be shared. history.replaceState keeps it a
// client-side change — Next syncs useSearchParams without a server round trip.
export function useReportRange(): [ReportRange, (r: ReportRange) => void] {
  const sp = useSearchParams();
  const key = sp.toString();
  const range = useMemo(() => parseReportRange(new URLSearchParams(key)), [key]);
  function set(r: ReportRange) {
    const params = new URLSearchParams(window.location.search);
    params.delete("from");
    params.delete("to");
    new URLSearchParams(reportRangeQuery(r)).forEach((v, k) => params.set(k, v));
    window.history.replaceState(null, "", `?${params.toString()}`);
  }
  return [range, set];
}

// The app's one date range picker — at the top of a tab, every report section
// below follows it. The actual dates show under it; maxFrom ("YYYY-MM-DD") is
// where Maximum starts: the client's start date, or the earliest data.
// Presets are one click; the From/To dates are always there, prefilled with
// the current range, so picking exact days needs no extra step.
export default function DateRangePicker({ value, onChange, maxFrom }: { value: ReportRange; onChange: (r: ReportRange) => void; maxFrom?: string | null }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const today = reportRangeDays({ preset: "this_month" }, null).until;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle() {
    if (!open) {
      const d = reportRangeDays(value, maxFrom);
      setFrom(d.since ?? "");
      setTo(d.until);
    }
    setOpen(!open);
  }

  const inputStyle = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };

  return (
    <div className="relative flex flex-col items-end" ref={ref}>
      <button
        aria-label="Date range"
        aria-expanded={open}
        onClick={toggle}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
        style={{ border: "1px solid var(--border)", color: "var(--text-primary)", background: "var(--surface)" }}
      >
        <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--text-muted)" }}>date_range</span>
        {reportRangeLabel(value)}
        <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--text-muted)" }}>{open ? "expand_less" : "expand_more"}</span>
      </button>
      <span className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{reportRangeDates(value, maxFrom)}</span>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 rounded-lg overflow-hidden py-1 w-[260px] max-w-[calc(100vw-32px)]"
          style={{ background: "var(--surface-card)", border: "1px solid var(--border)", boxShadow: "0 20px 40px -16px rgba(0,0,0,0.25)" }}
        >
          {REPORT_PRESETS.filter((p) => p !== "custom").map((p) => {
            const active = p === value.preset;
            return (
              <button
                key={p}
                onClick={() => {
                  onChange({ preset: p });
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm"
                style={{
                  color: active ? "var(--primary)" : "var(--text-primary)",
                  background: active ? "var(--primary-tint)" : "transparent",
                  fontWeight: active ? 700 : 500,
                }}
              >
                {REPORT_LABELS[p]}
                <span className="text-[11px] font-normal" style={{ color: "var(--text-muted)" }}> · {p === "since_start" && !maxFrom ? "start → today" : reportRangeDates({ preset: p }, maxFrom)}</span>
              </button>
            );
          })}
          <div className="px-3 pb-2 pt-2 space-y-1.5" style={{ borderTop: "1px solid var(--border)", background: value.preset === "custom" ? "var(--primary-tint)" : "transparent" }}>
            <p className="text-xs font-bold" style={{ color: value.preset === "custom" ? "var(--primary)" : "var(--text-primary)" }}>Or pick exact dates</p>
            <label className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              From <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1 rounded-md text-xs outline-none" style={inputStyle} />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              To <input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} className="px-2 py-1 rounded-md text-xs outline-none" style={inputStyle} />
            </label>
            <button
              disabled={!from || !to}
              onClick={() => {
                onChange({ preset: "custom", from: from <= to ? from : to, to: from <= to ? to : from });
                setOpen(false);
              }}
              className="w-full btn-gradient px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
            >
              Show these dates
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
