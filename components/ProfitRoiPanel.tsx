"use client";

import { useEffect, useRef, useState } from "react";
import HiddenBadge from "@/components/HiddenBadge";
import { DATE_RANGE_LABELS, type DateRangePreset } from "@/lib/date-range";
import type { ViewerStats } from "@/lib/client-stats";

const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

// Leads tab → Campaign performance: revenue vs ad spend for the selected
// range. The server only sends profit/ROI to a client when the coach has
// turned showProfit on — otherwise this renders nothing for them.
export default function ProfitRoiPanel({ clientId, range, isCoach }: { clientId: string; range: DateRangePreset; isCoach: boolean }) {
  const [stats, setStats] = useState<ViewerStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    setError(null);
    fetch(`/api/clients/stats?clientId=${clientId}&range=${range}`)
      .then((r) => r.json())
      .then((data) => {
        if (id !== req.current) return;
        if (data.error) throw new Error(data.error);
        setStats(data);
      })
      .catch((e) => id === req.current && setError(e.message));
  }, [clientId, range]);

  if (error) return <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>;
  if (!stats) return <div className="card rounded-2xl p-5"><span className="skeleton h-4 w-40 block mb-4" /><span className="skeleton h-8 w-full block" /></div>;
  if (stats.profit == null) return null; // hidden from this client

  const roi = stats.roi;
  const positive = stats.profit >= 0;
  return (
    <div className="card rounded-2xl p-5 fade-in">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Profit / ROI</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {DATE_RANGE_LABELS[range]}
            {stats.spendAllTime && " · spend is all-time (manual campaigns have no dates)"}
          </p>
        </div>
        {isCoach && !stats.visibility.showProfit && <HiddenBadge reason="Profit / ROI is off in Client view settings" />}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Revenue" value={money(stats.revenue)} />
        <Metric label="Ad spend" value={stats.spend == null ? "—" : money(stats.spend)} />
        <Metric label="Profit" value={money(stats.profit)} color={positive ? "var(--tag-green-fg)" : "var(--danger)"} />
        <Metric
          label="ROI"
          value={roi == null ? "—" : `${roi >= 0 ? "+" : ""}${Math.round(roi * 100)}%`}
          hint={roi == null ? "No ad spend in this range" : `$${(roi + 1).toFixed(2)} back per $1 spent`}
          color={roi == null ? undefined : roi >= 0 ? "var(--tag-green-fg)" : "var(--danger)"}
        />
      </div>
    </div>
  );
}

function Metric({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--surface-hover)" }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="font-heading font-bold text-xl mt-1" style={{ color: color ?? "var(--text-primary)" }}>{value}</p>
      {hint && <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  );
}
