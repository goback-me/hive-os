"use client";

import { useRef, useState } from "react";
import DateRangePicker from "@/components/DateRangePicker";
import HiddenBadge from "@/components/HiddenBadge";
import { reportRangeLabel, reportRangeQuery, type ReportRange } from "@/lib/date-range";
import type { ViewerStats } from "@/lib/client-stats";

const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// Client Dashboard stat cards with the same date-range picker as the Leads
// tab. First paint uses the server's "This month" numbers; changing the
// range refetches just these cards (no page reload, tab stays put).
// Profit is never on a client's dashboard — it lives in the Leads tab's
// Profit / ROI section, behind the coach's showProfit setting.
export default function DashboardStats({ clientId, initial, isCoach }: { clientId: string; initial: ViewerStats; isCoach: boolean }) {
  const [range, setRange] = useState<ReportRange>({ preset: "this_month" });
  const [stats, setStats] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  function change(next: ReportRange) {
    setRange(next);
    const id = ++req.current;
    setLoading(true);
    setError(null);
    fetch(`/api/clients/stats?clientId=${clientId}&${reportRangeQuery(next)}`)
      .then((r) => r.json())
      .then((data) => {
        if (id !== req.current) return; // a newer range was picked meanwhile
        if (data.error) throw new Error(data.error);
        setStats(data);
      })
      .catch((e) => id === req.current && setError(e.message))
      .finally(() => id === req.current && setLoading(false));
  }

  const label = reportRangeLabel(range);
  const v = stats.visibility;
  const cards = [
    <Card key="rev" icon="payments" label="Revenue" sub={label} value={money(stats.revenue)} />,
    stats.spend != null && (
      <Card
        key="spend"
        icon="ads_click"
        label="Ad spend"
        sub={stats.spendAllTime ? "All time — manual campaigns have no dates" : label}
        value={money(stats.spend)}
        hidden={isCoach && !v.showCostMetrics ? "Cost metrics are hidden" : undefined}
      />
    ),
    isCoach && stats.profit != null && (
      <Card
        key="profit"
        icon="trending_up"
        label="Profit"
        sub={label}
        value={money(stats.profit)}
        tone={stats.profit < 0 ? "danger" : undefined}
        hidden="Never on the client dashboard — see Leads → Profit / ROI"
      />
    ),
    <Card key="life" icon="account_balance_wallet" label="Lifetime revenue" sub="All time" value={money(stats.lifetimeRevenue)} />,
  ].filter(Boolean);

  return (
    <div>
      <div className="flex items-center justify-end gap-3 mb-3">
        {error && <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>}
        {loading && <span className="material-symbols-outlined text-[18px] animate-spin" style={{ color: "var(--text-muted)" }}>progress_activity</span>}
        <DateRangePicker value={range} onChange={change} />
      </div>
      <div className={`grid gap-4 transition-opacity ${cards.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3"}`} style={{ opacity: loading ? 0.55 : 1 }}>
        {cards}
      </div>
    </div>
  );
}

function Card({ icon, label, sub, value, tone, hidden }: { icon: string; label: string; sub: string; value: string; tone?: "danger"; hidden?: string }) {
  return (
    <div className="card rounded-2xl p-5">
      <div className="flex justify-between items-start mb-3 gap-2">
        <div>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{sub}</p>
        </div>
        <div className="flex items-center gap-2">
          {hidden && <HiddenBadge reason={hidden} />}
          <span className="icon-chip w-8 h-8" style={{ background: "var(--primary-tint)" }}>
            <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--primary)" }}>{icon}</span>
          </span>
        </div>
      </div>
      <p key={value} className="font-heading font-bold text-2xl fade-in" style={{ color: tone === "danger" ? "var(--danger)" : "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}
