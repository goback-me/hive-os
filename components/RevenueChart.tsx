"use client";

import { useState } from "react";

export default function RevenueChart({ trend }: { trend: { label: string; revenue: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const chartW = 1000;
  const chartH = 220;
  const maxRev = Math.max(...trend.map((t) => t.revenue), 1);

  const points = trend.map((t, i) => {
    const x = (i / (trend.length - 1 || 1)) * chartW;
    const y = chartH - (t.revenue / maxRev) * (chartH - 20) - 10;
    return { x, y, ...t };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${chartW},${chartH} L0,${chartH} Z`;

  const active = hover !== null ? points[hover] : null;
  // Keep the tooltip's rounded-rect label inside the chart bounds near the edges.
  const labelW = 92;
  const labelX = active ? Math.min(Math.max(active.x - labelW / 2, 4), chartW - labelW - 4) : 0;

  return (
    <div className="relative" style={{ height: chartH + 30 }}>
      <svg
        width="100%"
        height={chartH}
        viewBox={`0 0 ${chartW} ${chartH}`}
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
          {/* Load animation: the fill is revealed left→right in step with the line drawing itself */}
          <clipPath id="revenue-reveal">
            <rect x="0" y="0" width="0" height={chartH}>
              <animate attributeName="width" from="0" to={chartW} dur="1.6s" fill="freeze" calcMode="spline" keySplines="0.65 0 0.35 1" keyTimes="0;1" />
            </rect>
          </clipPath>
        </defs>

        <path d={areaPath} fill="url(#revenue-fill)" stroke="none" clipPath="url(#revenue-reveal)" />
        <path d={linePath} pathLength={1} className="chart-draw" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {active && (
          <line x1={active.x} y1="0" x2={active.x} y2={chartH} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
        )}

        {points.map((p, i) => (
          <g key={p.label}>
            {/* Generous invisible hit target — the visible marker stays small */}
            <rect
              x={p.x - (chartW / points.length) / 2}
              y={0}
              width={chartW / points.length}
              height={chartH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === i ? 5 : 3.5}
              fill="var(--primary)"
              stroke="var(--surface-card)"
              strokeWidth={hover === i ? 2 : 0}
              className="chart-dot"
              // Each dot pops in as the line reaches it (line takes 1.6s end to end)
              style={{ animationDelay: `${(p.x / chartW) * 1.6}s` }}
            />
          </g>
        ))}

        {active && (
          <g transform={`translate(${labelX}, ${Math.max(active.y - 38, 4)})`}>
            <rect width={labelW} height="30" rx="7" fill="var(--text-primary)" />
            <text x={labelW / 2} y="13" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--surface)">
              {active.label}
            </text>
            <text x={labelW / 2} y="24" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--surface)">
              ${active.revenue.toLocaleString()}
            </text>
          </g>
        )}
      </svg>
      <div className="flex justify-between mt-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
        {trend.map((t) => (
          <span key={t.label}>{t.label}</span>
        ))}
      </div>
    </div>
  );
}
