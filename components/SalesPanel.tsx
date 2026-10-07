"use client";

import { useEffect, useRef, useState } from "react";
import type { SaleRow, SalesResponse } from "@/lib/sales";
import type { Tone } from "@/lib/kpi";
import { TONE_STYLE } from "@/components/SnapshotPanel";
import HiddenBadge from "@/components/HiddenBadge";
import { terms } from "@/lib/client-terms";
import LeadLink from "@/components/LeadLink";

const money = (v: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 })}`);
const sydDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "numeric" });
const PREVIEW_ROWS = 5;
const PAGE_SIZE = 50;

function displayCampaignName(name: string | null) {
  const trimmed = name?.trim();
  return !trimmed || trimmed === "-" ? "Unattributed" : trimmed;
}

// Leads tab → Sales: won leads, dated by when they were won. Cost columns
// arrive as null for a CLIENT who isn't shown cost metrics.
export default function SalesPanel({ clientId, rangeQuery, rangeLabel, isCoach, reloadKey }: { clientId: string; rangeQuery: string; rangeLabel: string; isCoach: boolean; reloadKey: number }) {
  const [data, setData] = useState<SalesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    setLoading(true);
    setError(null);
    fetch(`/api/leads/sales?clientId=${clientId}&${rangeQuery}`)
      .then((r) => r.json())
      .then((d) => {
        if (id !== req.current) return;
        if (d.error) throw new Error(d.error);
        setData(d);
        setPage(1);
      })
      .catch((e) => id === req.current && setError(e.message))
      .finally(() => id === req.current && setLoading(false));
  }, [clientId, rangeQuery, reloadKey]);

  if (error && !data) return <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>;
  if (!data) return <div className="card rounded-2xl p-5"><span className="skeleton h-4 w-40 block mb-4" /><span className="skeleton h-16 w-full block" /></div>;

  const { summary: s, sales } = data;
  const t = terms(data.clientType);
  const showCost = !data.costHidden;
  const costBadge = isCoach && !data.clientSeesCost ? <HiddenBadge reason="Cost metrics are off in Client view settings" /> : null;
  const pages = Math.max(1, Math.ceil(sales.length / PAGE_SIZE));
  const visible = expanded ? sales.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : sales.slice(0, PREVIEW_ROWS);

  return (
    <div className="card rounded-2xl p-5 fade-in">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t.sales}</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>Won leads, dated by when they were won · table: {rangeLabel}</p>
        </div>
        {loading && <span className="material-symbols-outlined text-[18px] animate-spin" style={{ color: "var(--text-muted)" }}>progress_activity</span>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }}>
        <CompareCard icon="handshake" label={`${t.sales} this month`} value={s.thisMonth.count.toLocaleString()} diff={s.thisMonth.count - s.lastMonthToDate.count} diffText={(d) => Math.abs(d).toLocaleString()} tone={s.tone.count} compare={`${s.compareLabel}: ${s.lastMonthToDate.count}`} sub={`Last month ${s.lastMonth.count} · Lifetime ${s.lifetime.count}`} />
        <CompareCard icon="payments" label="Revenue this month" value={money(s.thisMonth.revenue)} diff={s.thisMonth.revenue - s.lastMonthToDate.revenue} diffText={(d) => money(Math.abs(d))} tone={s.tone.revenue} compare={`${s.compareLabel}: ${money(s.lastMonthToDate.revenue)}`} sub={`Last month ${money(s.lastMonth.revenue)} · Lifetime ${money(s.lifetime.revenue)}`} />
        {showCost && (
          <Card icon="price_check" label={`Cost per ${t.sale.toLowerCase()}`} badge={costBadge}>
            <p className="font-heading font-bold text-2xl" style={{ color: "var(--text-primary)" }}>{money(s.costPerSale)}</p>
            <p className="text-[10px] mt-1.5" style={{ color: "var(--text-muted)" }}>{s.costPerSale == null ? (data.spendSource ? "No sales in this range" : "No spend data") : rangeLabel}</p>
          </Card>
        )}
        <Card icon="event" label={`Last ${t.sale.toLowerCase()}`}>
          <p className="font-heading font-bold text-2xl" style={{ color: "var(--text-primary)" }}>{s.lastSale ? sydDate(s.lastSale.wonAt) : "—"}</p>
          <p className="text-[10px] mt-1.5 truncate" style={{ color: "var(--text-muted)" }}>{s.lastSale?.name || (s.lastSale ? "Unnamed lead" : "No sales yet")}</p>
        </Card>
      </div>

      {sales.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No sales in this date range.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[700px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Won", "Lead", "Campaign", "Job value", "Opt-in → quote → won", "Days to won", ...(showCost ? ["Cost of sale"] : [])].map((h) => (
                    <th key={h} className="py-2 pr-4 text-xs font-bold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                      {h}
                      {h === "Cost of sale" && costBadge && <span className="ml-1.5">{costBadge}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r: SaleRow) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{sydDate(r.wonAt)}</td>
                    <td className="py-2 pr-4 font-medium whitespace-nowrap" style={{ color: "var(--text-primary)" }}><LeadLink id={r.id}>{r.name || "Unnamed lead"}</LeadLink></td>
                    <td className="py-2 pr-4 whitespace-nowrap max-w-[240px] truncate" style={{ color: "var(--text-secondary)" }} title={r.campaign ?? undefined}>{displayCampaignName(r.campaign)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap font-semibold" style={{ color: "var(--text-primary)" }}>{money(r.value)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                      {shortDate(r.optInAt)} → {r.quoteAt ? shortDate(r.quoteAt) : "—"} → {shortDate(r.wonAt)}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{r.daysToWon == null ? "—" : `${r.daysToWon}d`}</td>
                    {showCost && <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{money(r.costOfSale)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3">
            {sales.length > PREVIEW_ROWS ? (
              <button onClick={() => { setExpanded((e) => !e); setPage(1); }} className="text-xs font-bold" style={{ color: "var(--primary)" }}>
                {expanded ? "Show fewer" : `View all (${sales.length})`}
              </button>
            ) : (
              <span />
            )}
            {expanded && pages > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>Page {page} of {pages}</span>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Previous</button>
                <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Next</button>
              </div>
            )}
          </div>
          {showCost && (
            <p className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
              Cost of sale = included ad spend from the start date up to the won date ÷ sales up to then.
              {data.spendSource === "manual" && " Manual campaign spend has no dates, so it's spread evenly by day."}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Card({ icon, label, badge, children }: { icon: string; label: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--surface-hover)" }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="icon-chip w-7 h-7 shrink-0" style={{ background: "var(--primary-tint)" }}>
            <span className="material-symbols-outlined text-[15px]" style={{ color: "var(--primary)" }}>{icon}</span>
          </span>
          <p className="text-xs font-semibold truncate" style={{ color: "var(--text-secondary)" }}>{label}</p>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

// Same green/red comparison chip as the Snapshot cards.
function CompareCard({ icon, label, value, diff, diffText, tone, compare, sub }: { icon: string; label: string; value: string; diff: number; diffText: (d: number) => string; tone: Tone | null; compare: string; sub: string }) {
  const t = tone ? TONE_STYLE[tone] : null;
  return (
    <Card icon={icon} label={label}>
      <p className="font-heading font-bold text-2xl" style={{ color: "var(--text-primary)" }}>{value}</p>
      <div className="flex items-center gap-1.5 mt-1.5 min-h-[20px]">
        {diff !== 0 && t && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: t.bg, color: t.fg }}>
            <span className="material-symbols-outlined text-[12px]">{diff > 0 ? "arrow_upward" : "arrow_downward"}</span>
            {diffText(diff)}
          </span>
        )}
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{compare}</span>
      </div>
      <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{sub}</p>
    </Card>
  );
}
