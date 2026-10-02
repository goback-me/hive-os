"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DateRangePicker, { useReportRange } from "@/components/DateRangePicker";
import { reportRangeLabel, reportRangeQuery, type ReportRange } from "@/lib/date-range";
import type { PortfolioMetric, PortfolioRow } from "@/lib/portfolio";

const METRICS: { key: PortfolioMetric; label: string; money?: boolean; lowerBetter?: boolean }[] = [
  { key: "leads", label: "Leads" },
  { key: "liveTransfers", label: "Live transfers" },
  { key: "quotes", label: "Quotes" },
  { key: "sales", label: "Sales" },
  { key: "revenue", label: "Revenue", money: true },
  { key: "costPerQuote", label: "Cost/quote", money: true, lowerBetter: true },
  { key: "costPerSale", label: "Cost/sale", money: true, lowerBetter: true },
];
const HEALTH = { green: "var(--tag-green-fg)", amber: "var(--tag-amber-fg)", red: "var(--danger)" } as const;
const HEALTH_LABEL = { green: "On track", amber: "Needs attention", red: "At risk" } as const;

const fmt = (v: number | null, money?: boolean) => (v == null ? "—" : money ? `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 })}` : v.toLocaleString());

// /dashboard: every active client, at-risk first. Defaults to this month so
// far vs the same days last month; the picker changes the period.
export default function PortfolioTable() {
  const router = useRouter();
  const hasRange = useSearchParams().has("range");
  const [picked, setRange] = useReportRange();
  const range: ReportRange = hasRange ? picked : { preset: "this_month" };
  const rangeQuery = reportRangeQuery(range);
  const [data, setData] = useState<{ rows: PortfolioRow[]; previousLabel: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    setLoading(true);
    setError(null);
    fetch(`/api/portfolio?${rangeQuery}`)
      .then((r) => r.json())
      .then((d) => {
        if (id !== req.current) return;
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => id === req.current && setError(e.message))
      .finally(() => id === req.current && setLoading(false));
  }, [rangeQuery]);

  const rows = (data?.rows ?? []).filter((r) => r.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const sydDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" });

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Portfolio</p>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {reportRangeLabel(range)}{data?.previousLabel ? ` vs ${data.previousLabel}` : ""} · at-risk first
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="material-symbols-outlined text-[18px] animate-spin" style={{ color: "var(--text-muted)" }}>progress_activity</span>}
          {error && <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>}
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter clients…"
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            aria-label="Filter clients"
          />
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      <div className="card rounded-2xl overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[1200px]">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Client", ...METRICS.map((m) => m.label), "Alerts", "Needs action", "Last contact"].map((h) => (
                <th key={h} className="py-3 px-3 text-xs font-bold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ opacity: loading ? 0.6 : 1 }}>
            {!data &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={11} className="px-3 py-3"><span className="skeleton h-4 w-full block" /></td></tr>
              ))}
            {data && rows.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-8 text-center" style={{ color: "var(--text-muted)" }}>No clients match.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.clientId} onClick={() => router.push(`/clients/${r.slug}`)} className="cursor-pointer" style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="py-2.5 px-3 whitespace-nowrap font-medium" style={{ color: "var(--text-primary)" }}>
                  <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: HEALTH[r.health] }} title={HEALTH_LABEL[r.health]} aria-label={HEALTH_LABEL[r.health]} />
                  {r.name}
                </td>
                {METRICS.map((m) => {
                  const v = r.values[m.key];
                  const p = r.previous?.[m.key] ?? null;
                  const change = v != null && p != null && p > 0 ? Math.round(((v - p) / p) * 100) : null;
                  const good = change != null && (m.lowerBetter ? change < 0 : change > 0);
                  return (
                    <td key={m.key} className="py-2.5 px-3 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                      {fmt(v, m.money)}
                      {change != null && change !== 0 && (
                        <span className="text-[10px] font-bold ml-1" style={{ color: good ? "var(--tag-green-fg)" : "var(--danger)" }}>
                          {change > 0 ? "▲" : "▼"}{Math.abs(change)}%
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="py-2.5 px-3 whitespace-nowrap">
                  {r.openAlerts ? (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={r.dangerAlerts ? { background: "var(--danger-tint)", color: "var(--danger)" } : { background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }}>
                      {r.openAlerts}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  )}
                </td>
                <td className="py-2.5 px-3 whitespace-nowrap" style={{ color: r.needsAction ? "var(--text-primary)" : "var(--text-muted)" }}>{r.needsAction || "—"}</td>
                <td className="py-2.5 px-3 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{r.lastContact ? sydDate(r.lastContact) : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
