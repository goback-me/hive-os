"use client";

import { useEffect, useRef, useState } from "react";
import DateRangePicker, { useReportRange } from "@/components/DateRangePicker";
import HiddenBadge from "@/components/HiddenBadge";
import { reportRangeQuery } from "@/lib/date-range";
import type { GrowthMonth, GrowthResponse, Metric } from "@/lib/growth";

// Same constants as lib/growth.ts (a server module — not imported here).
const COUNT_METRICS = ["leads", "liveTransfers", "quotes", "sales", "revenue"] as const;
const RATE_METRICS = ["contactRate", "liveToQuote", "closeRate", "costPerQuote", "costPerSale"] as const;
const LOWER_IS_BETTER: Metric[] = ["costPerQuote", "costPerSale"];
const COSTS: Metric[] = ["costPerQuote", "costPerSale"];

// Brand blue columns + orange 3-month average: the validated pair from the
// Leads tab comparison chart (--primary / --series-compare).
const BAR = "var(--primary)";
const AVG = "var(--series-compare)";

const isMoney = (m: Metric) => m === "revenue" || COSTS.includes(m);
const isRate = (m: Metric) => m === "contactRate" || m === "liveToQuote" || m === "closeRate";
function fmt(m: Metric, v: number | null) {
  if (v == null) return "—";
  if (isRate(m)) return `${Math.round(v)}%`;
  if (isMoney(m)) return `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 })}`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
const shortMonth = (label: string) => label.split(" ")[0].slice(0, 3);

export default function GrowthPanel({ clientId, isCoach, maxFrom }: { clientId: string; isCoach: boolean; maxFrom: string | null }) {
  const [range, setRange] = useReportRange();
  const rangeQuery = reportRangeQuery(range);
  const [data, setData] = useState<GrowthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    setLoading(true);
    setError(null);
    fetch(`/api/clients/growth?clientId=${clientId}&${rangeQuery}`)
      .then((r) => r.json())
      .then((d) => {
        if (id !== req.current) return;
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => id === req.current && setError(e.message))
      .finally(() => id === req.current && setLoading(false));
  }, [clientId, rangeQuery]);

  const costBadge = isCoach && data && !data.clientSeesCost ? <HiddenBadge reason="Cost metrics are off in Client view settings" /> : null;
  const rateMetrics = data ? RATE_METRICS.filter((m) => !(data.costHidden && COSTS.includes(m))) : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {error && <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>}
          {loading && <span className="material-symbols-outlined text-[18px] animate-spin" style={{ color: "var(--text-muted)" }}>progress_activity</span>}
        </div>
        <DateRangePicker value={range} onChange={setRange} maxFrom={maxFrom} />
      </div>

      {!data ? (
        <div className="card rounded-2xl p-5"><span className="skeleton h-5 w-80 block mb-4" /><span className="skeleton h-32 w-full block" /></div>
      ) : (
        <div className="space-y-5 transition-opacity" style={{ opacity: loading ? 0.6 : 1 }}>
          {/* Plain-English summary, from the numbers */}
          <div className="card rounded-2xl p-5">
            <p className="font-heading font-bold text-lg flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <span className="material-symbols-outlined text-[22px]" style={{ color: "var(--primary)" }}>insights</span>
              {data.summary}
            </p>
            {Object.keys(data.streaks).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {(Object.entries(data.streaks) as [Metric, number][]).map(([m, n]) => (
                  <span key={m} className="px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1" style={{ background: "var(--tag-green-bg)", color: "var(--tag-green-fg)" }}>
                    <span className="material-symbols-outlined text-[14px]">trending_up</span>
                    {data.labels[m]}: {n} months improving
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* This month vs last month vs the 3-month average */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {COUNT_METRICS.map((m) => {
              const h = data.headline[m];
              return (
                <div key={m} className="card rounded-2xl p-4">
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{data.labels[m]} · this month</p>
                  <p className="font-heading text-2xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>{fmt(m, h.thisMonth)}</p>
                  {h.pace != null && <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>On pace for ~{fmt(m, h.pace)}</p>}
                  <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                    Last month {fmt(m, h.lastMonth)} · 3-mo avg {fmt(m, h.avg3)}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Trends: a column per month + the 3-month rolling average */}
          <div className="card rounded-2xl p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Month by month</p>
              <div className="flex gap-4">
                <Legend color={BAR} label="Monthly" square />
                <Legend color={AVG} label="3-month average" />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {COUNT_METRICS.map((m) => (
                <TrendChart key={m} title={data.labels[m]} metric={m} months={data.months} best={data.best[m]} />
              ))}
            </div>
          </div>

          {/* Rates over time */}
          <div className="card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Rates over time</p>
              {costBadge}
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-6">
              {rateMetrics.map((m) => (
                <TrendChart key={m} title={`${data.labels[m]}${LOWER_IS_BETTER.includes(m) ? " (lower is better)" : ""}`} metric={m} months={data.months} best={data.best[m]} line />
              ))}
            </div>
          </div>

          <MonthTable data={data} rateMetrics={rateMetrics} />
          <p className="text-[10px] -mt-3" style={{ color: "var(--text-muted)" }}>
            Each step counted in the month it happened, Sydney time. The current month is month-to-date. ★ = best month.
          </p>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, square }: { color: string; label: string; square?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
      <span className={square ? "w-2.5 h-2.5 rounded-sm" : "w-3 h-0.5 rounded-full"} style={{ background: color }} />
      {label}
    </span>
  );
}

const W = 300;
const H = 110;

// Columns (or a line, for rates) per month; the rolling average on top.
function TrendChart({ title, metric, months, best, line }: { title: string; metric: Metric; months: GrowthMonth[]; best?: string; line?: boolean }) {
  const values = months.map((m) => m.values[metric]);
  const avg = line ? [] : values.map((_, i) => {
    const w = values.slice(Math.max(0, i - 2), i + 1).filter((v): v is number => v != null);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
  const max = Math.max(...values.map((v) => v ?? 0), ...avg.map((v) => v ?? 0), 0);
  const slot = W / Math.max(months.length, 1);
  const y = (v: number) => H - (max ? (v / max) * (H - 14) : 0);
  const cx = (i: number) => i * slot + slot / 2;
  const path = (vals: (number | null)[]) =>
    vals.map((v, i) => (v == null ? null : `${cx(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p}`).join(" ");
  const latest = [...values].reverse().find((v) => v != null) ?? null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-xs font-semibold truncate" style={{ color: "var(--text-secondary)" }}>{title}</p>
        <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{fmt(metric, latest)}</p>
      </div>
      {max === 0 ? (
        <p className="text-[11px] py-8 text-center" style={{ color: "var(--text-muted)" }}>No data yet</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" role="img" aria-label={`${title} by month`}>
          <line x1={0} x2={W} y1={H} y2={H} stroke="var(--border)" strokeWidth={1} />
          {!line &&
            values.map((v, i) =>
              v ? (
                <rect key={i} x={i * slot + slot * 0.18} y={y(v)} width={slot * 0.64} height={H - y(v)} rx={3} fill={BAR} opacity={months[i].partial ? 0.45 : 1}>
                  <title>{`${months[i].label}${months[i].partial ? " (so far)" : ""}: ${fmt(metric, v)}`}</title>
                </rect>
              ) : null
            )}
          {line && <path d={path(values)} fill="none" stroke={BAR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {line &&
            values.map((v, i) =>
              v != null ? (
                <circle key={i} cx={cx(i)} cy={y(v)} r={4} fill={BAR} stroke="var(--surface-card)" strokeWidth={2} opacity={months[i].partial ? 0.5 : 1}>
                  <title>{`${months[i].label}${months[i].partial ? " (so far)" : ""}: ${fmt(metric, v)}`}</title>
                </circle>
              ) : null
            )}
          {!line && <path d={path(avg)} fill="none" stroke={AVG} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {months.map((m, i) => (
            <text key={m.month} x={cx(i)} y={H + 11} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
              {m.month === best ? "★" : ""}
              {shortMonth(m.label)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

function MonthTable({ data, rateMetrics }: { data: GrowthResponse; rateMetrics: Metric[] }) {
  const cols: Metric[] = [...COUNT_METRICS, ...rateMetrics];
  const rows = [...data.months].reverse(); // newest first
  return (
    <div className="card rounded-2xl overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[1100px]">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Month", ...cols.map((c) => data.labels[c])].map((h) => (
              <th key={h} className="py-3 px-3 text-xs font-bold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const prev = data.months[data.months.findIndex((m) => m.month === row.month) - 1];
            return (
              <tr key={row.month} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="py-2.5 px-3 whitespace-nowrap font-medium" style={{ color: "var(--text-primary)" }}>
                  {row.label}
                  {row.partial && <span className="text-[10px] font-normal" style={{ color: "var(--text-muted)" }}> · so far</span>}
                </td>
                {cols.map((c) => {
                  const v = row.values[c];
                  const p = prev?.values[c] ?? null;
                  const change = v == null || p == null || p === 0 || row.partial ? null : ((v - p) / p) * 100;
                  const good = change != null && (LOWER_IS_BETTER.includes(c) ? change < 0 : change > 0);
                  return (
                    <td key={c} className="py-2.5 px-3 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                      <span style={{ color: "var(--text-primary)" }}>{fmt(c, v)}</span>
                      {data.best[c] === row.month && <span title="Best month" style={{ color: "var(--tag-amber-fg)" }}> ★</span>}
                      {change != null && Math.round(change) !== 0 && (
                        <span className="text-[10px] font-bold ml-1.5" style={{ color: good ? "var(--tag-green-fg)" : "var(--danger)" }}>
                          {change > 0 ? "▲" : "▼"} {Math.abs(Math.round(change))}%
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
