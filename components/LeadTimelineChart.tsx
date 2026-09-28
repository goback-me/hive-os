"use client";

import { useState } from "react";

export type TimeSeriesPoint = {
  date: string;
  received: number;
  contacted: number;
  handover: number;
  consult: number;
  won: number;
  lostOrDisqualified: number;
};

const SERIES = [
  { key: "received", label: "Received", color: "var(--text-muted)" },
  { key: "contacted", label: "Contacted", color: "var(--text-primary)" },
  { key: "handover", label: "Handover", color: "var(--tag-indigo-fg)" },
  { key: "consult", label: "Consult booked", color: "var(--tag-teal-fg)" },
  { key: "won", label: "Won", color: "var(--primary)" },
  { key: "lostOrDisqualified", label: "Lost / DQ", color: "var(--danger)" },
] as const;

export default function LeadTimelineChart({ points }: { points: TimeSeriesPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) {
    return <p className="text-sm py-8 text-center" style={{ color: "var(--text-secondary)" }}>No activity in this date range.</p>;
  }

  const chartW = 1000;
  const chartH = 200;
  const maxVal = Math.max(...points.flatMap((p) => SERIES.map((s) => p[s.key])), 1);

  const xFor = (i: number) => (i / (points.length - 1 || 1)) * chartW;
  const yFor = (v: number) => chartH - (v / maxVal) * (chartH - 16) - 8;

  const linePaths = SERIES.map((s) => ({
    ...s,
    d: points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p[s.key]).toFixed(1)}`).join(" "),
  }));

  const active = hover !== null ? points[hover] : null;
  const activeX = hover !== null ? xFor(hover) : 0;

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-3">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>

      <div className="relative" style={{ height: chartH + 26 }}>
        <svg width="100%" height={chartH} viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
          {active && <line x1={activeX} y1="0" x2={activeX} y2={chartH} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />}
          {linePaths.map((s) => (
            <path key={s.key} d={s.d} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {points.map((_, i) => (
            <rect
              key={i}
              x={xFor(i) - chartW / points.length / 2}
              y={0}
              width={chartW / points.length}
              height={chartH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>

        {active && (
          <div
            className="absolute top-1 px-3 py-2 rounded-lg text-xs pointer-events-none z-10"
            style={{
              left: `${Math.min(Math.max((activeX / chartW) * 100, 10), 90)}%`,
              transform: "translateX(-50%)",
              background: "var(--text-primary)",
              color: "var(--surface)",
              whiteSpace: "nowrap",
            }}
          >
            <p className="font-bold mb-1">{new Date(active.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
            {SERIES.map((s) => (
              <p key={s.key}>
                {s.label}: <strong>{active[s.key]}</strong>
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
        <span>{new Date(points[0].date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        <span>{new Date(points[points.length - 1].date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
      </div>
    </div>
  );
}
