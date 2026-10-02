"use client";

import { useEffect, useRef, useState } from "react";
import type { CompareMetric, PeriodComparison } from "@/lib/period-compare";

const LABELS: Record<CompareMetric, string> = {
  leads: "Leads",
  handovers: "Handovers",
  consultsBooked: "Consults booked",
  quotes: "Quotes",
  won: "Won",
};
const COMPARE_METRICS = Object.keys(LABELS) as CompareMetric[];

// Brand blue = the selected period, orange = the one before. The pair passes
// the dataviz palette checks (CVD + normal vision) in light and dark mode;
// every bar also carries its value, so identity is never colour alone.
const CURRENT = "var(--primary)";
const PREVIOUS = "var(--series-compare)";
const CHART_H = 180;

// Leads tab: grouped columns, selected period vs the previous equal period
// (this month so far vs the same days last month, etc.).
export default function LeadCompareChart({ clientId, rangeQuery, rangeLabel, reloadKey }: { clientId: string; rangeQuery: string; rangeLabel: string; reloadKey: number }) {
  const [data, setData] = useState<PeriodComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<CompareMetric | null>(null);
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    setLoading(true);
    setError(null);
    fetch(`/api/leads/compare?clientId=${clientId}&${rangeQuery}`)
      .then((r) => r.json())
      .then((d) => {
        if (id !== req.current) return;
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => id === req.current && setError(e.message))
      .finally(() => id === req.current && setLoading(false));
  }, [clientId, rangeQuery, reloadKey]);

  const prev = data?.previous ?? null;
  const max = data ? Math.max(1, ...COMPARE_METRICS.flatMap((k) => [data.current[k], prev?.[k] ?? 0])) : 1;
  const pct = (a: number, b: number) => (b > 0 ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : null);

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {prev ? "This period vs the one before" : "This period"}
          </p>
          <div className="flex flex-wrap gap-4 mt-2">
            <Legend color={CURRENT} label={rangeLabel} />
            {prev && data?.previousLabel && <Legend color={PREVIOUS} label={data.previousLabel} />}
          </div>
        </div>
        {loading && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Updating…</span>}
      </div>

      {error && !data ? (
        <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>
      ) : !data ? (
        <span className="skeleton block w-full" style={{ height: CHART_H }} />
      ) : (
        <>
          <div className="grid grid-cols-5 gap-4 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }}>
            {COMPARE_METRICS.map((k) => {
              const cur = data.current[k];
              const before = prev?.[k];
              const change = before != null ? pct(cur, before) : null;
              return (
                <div key={k} className="relative" onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
                  {hover === k && (
                    <div
                      className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full px-3 py-2 rounded-lg text-xs pointer-events-none z-10 whitespace-nowrap"
                      style={{ background: "var(--text-primary)", color: "var(--surface)" }}
                    >
                      <p className="font-bold mb-0.5">{LABELS[k]}</p>
                      <p>{rangeLabel}: <strong>{cur}</strong></p>
                      {before != null && <p>{data.previousLabel}: <strong>{before}</strong>{change && ` (${change})`}</p>}
                    </div>
                  )}
                  {/* Bars sit on a shared baseline; 2px gap between the pair. */}
                  <div className="flex items-end justify-center gap-[2px]" style={{ height: CHART_H, borderBottom: "1px solid var(--border)" }}>
                    <Bar value={cur} max={max} color={CURRENT} />
                    {before != null && <Bar value={before} max={max} color={PREVIOUS} />}
                  </div>
                  <p className="text-xs font-semibold text-center mt-2" style={{ color: "var(--text-secondary)" }}>{LABELS[k]}</p>
                  {change && <p className="text-[10px] text-center" style={{ color: "var(--text-muted)" }}>{change}</p>}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] mt-3" style={{ color: "var(--text-muted)" }}>
            Counted by when each step happened (the team&apos;s dated notes, else the stage change seen live), Sydney time.
            {!prev && " Pick a month or custom range to compare with the period before."}
          </p>
        </>
      )}
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="flex flex-col items-center justify-end h-full" style={{ width: "min(36px, 40%)" }}>
      <span className="text-[11px] font-bold mb-1" style={{ color: "var(--text-primary)" }}>{value.toLocaleString()}</span>
      <div className="w-full rounded-t-[4px]" style={{ height: `${(value / max) * (CHART_H - 22)}px`, minHeight: value > 0 ? 2 : 0, background: color }} />
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
      {label}
    </span>
  );
}
