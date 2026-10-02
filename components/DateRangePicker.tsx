"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { REPORT_LABELS, REPORT_PRESETS, parseReportRange, reportRangeLabel, reportRangeQuery, type ReportRange } from "@/lib/date-range";

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

// One picker at the top of a tab; every report section below follows it.
export default function DateRangePicker({ value, onChange }: { value: ReportRange; onChange: (r: ReportRange) => void }) {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(value.preset === "custom");
  const [from, setFrom] = useState(value.from ?? "");
  const [to, setTo] = useState(value.to ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const inputStyle = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
        style={{ border: "1px solid var(--border)", color: "var(--text-primary)", background: "var(--surface)" }}
      >
        <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--text-muted)" }}>date_range</span>
        {reportRangeLabel(value)}
        <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--text-muted)" }}>{open ? "expand_less" : "expand_more"}</span>
      </button>
      {open && (
        <div
          className="absolute right-0 z-20 mt-1 rounded-lg overflow-hidden py-1 min-w-[220px]"
          style={{ background: "var(--surface-card)", border: "1px solid var(--border)", boxShadow: "0 20px 40px -16px rgba(0,0,0,0.25)" }}
        >
          {REPORT_PRESETS.map((p) => {
            const active = showCustom ? p === "custom" : p === value.preset;
            return (
              <button
                key={p}
                onClick={() => {
                  if (p === "custom") return setShowCustom(true); // pick the dates below, then Apply
                  setShowCustom(false);
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
                {p === "since_start" && <span className="text-[11px] font-normal" style={{ color: "var(--text-muted)" }}> · start date → today</span>}
              </button>
            );
          })}
          {showCustom && <div className="px-3 pb-2 pt-2 space-y-1.5" style={{ borderTop: "1px solid var(--border)" }}>
            <label className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1 rounded-md text-xs outline-none" style={inputStyle} />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="px-2 py-1 rounded-md text-xs outline-none" style={inputStyle} />
            </label>
            <button
              disabled={!from || !to}
              onClick={() => {
                onChange({ preset: "custom", from: from <= to ? from : to, to: from <= to ? to : from });
                setOpen(false);
              }}
              className="w-full btn-gradient px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
            >
              Apply custom range
            </button>
          </div>}
        </div>
      )}
    </div>
  );
}
