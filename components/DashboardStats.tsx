"use client";

import { useRef, useState } from "react";
import DateRangeDropdown from "@/components/DateRangeDropdown";
import { DATE_RANGE_LABELS, type DateRangePreset } from "@/lib/date-range";
import type { ClientStats } from "@/lib/client-stats";

const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// Client Dashboard stat cards with the same date-range picker as the Leads
// tab. First paint uses the server's "This month" numbers; changing the
// range refetches just these cards (no page reload, tab stays put).
export default function DashboardStats({ clientId, initial }: { clientId: string; initial: ClientStats }) {
  const [range, setRange] = useState<DateRangePreset>("this_month");
  const [stats, setStats] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  function change(next: DateRangePreset) {
    setRange(next);
    const id = ++req.current;
    setLoading(true);
    setError(null);
    fetch(`/api/clients/stats?clientId=${clientId}&range=${next}`)
      .then((r) => r.json())
      .then((data) => {
        if (id !== req.current) return; // a newer range was picked meanwhile
        if (data.error) throw new Error(data.error);
        setStats(data);
      })
      .catch((e) => id === req.current && setError(e.message))
      .finally(() => id === req.current && setLoading(false));
  }

  const label = DATE_RANGE_LABELS[range];
  return (
    <div>
      <div className="flex items-center justify-end gap-3 mb-3">
        {error && <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>}
        {loading && <span className="material-symbols-outlined text-[18px] animate-spin" style={{ color: "var(--text-muted)" }}>progress_activity</span>}
        <DateRangeDropdown value={range} onChange={change} />
      </div>
      <div className="grid grid-cols-4 gap-4 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }}>
        <Card icon="payments" label="Revenue" sub={label} value={money(stats.revenue)} />
        <Card
          icon="ads_click"
          label="Ad spend"
          sub={stats.spendAllTime ? "All time — manual campaigns have no dates" : label}
          value={money(stats.spend)}
        />
        <Card icon="trending_up" label="Profit" sub={label} value={money(stats.profit)} tone={stats.profit < 0 ? "danger" : undefined} />
        <Card icon="account_balance_wallet" label="Lifetime revenue" sub="All time" value={money(stats.lifetimeRevenue)} />
      </div>
    </div>
  );
}

function Card({ icon, label, sub, value, tone }: { icon: string; label: string; sub: string; value: string; tone?: "danger" }) {
  return (
    <div className="card rounded-2xl p-5">
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{sub}</p>
        </div>
        <span className="icon-chip w-8 h-8" style={{ background: "var(--primary-tint)" }}>
          <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--primary)" }}>{icon}</span>
        </span>
      </div>
      <p key={value} className="font-heading font-bold text-2xl fade-in" style={{ color: tone === "danger" ? "var(--danger)" : "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}
