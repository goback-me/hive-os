"use client";

import { useEffect, useRef, useState } from "react";
import { StartDateWarning } from "@/components/StartDateField";
import DateRangePicker, { useReportRange } from "@/components/DateRangePicker";
import SalesPanel from "@/components/SalesPanel";
import ProfitRoiPanel from "@/components/ProfitRoiPanel";
import HiddenBadge from "@/components/HiddenBadge";
import { reportRangeLabel, reportRangeQuery } from "@/lib/date-range";
import type { AdsReport, CampaignRow } from "@/lib/campaign-report";
import { terms } from "@/lib/client-terms";

type SetReporting = (clientId: string, campaign: { id: string; name: string; source: "meta" | "manual" }, included: boolean | null) => Promise<void>;
type Campaign = NonNullable<AdsReport["campaigns"]>[number];

const money = (v: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 })}`);
const sydDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" });

// Ads tab: campaign performance for the tab's date range. Leads and their
// outcomes are credited to the campaign that generated the lead and counted
// when they happened (lib/campaign-report.ts). Spend / cost columns arrive as
// null for a client who isn't shown cost metrics.
export default function AdsPanel({ clientId, isCoach, onSetReporting, maxFrom }: { clientId: string; isCoach: boolean; onSetReporting: SetReporting; maxFrom: string | null }) {
  const [range, setRange] = useReportRange();
  const rangeQuery = reportRangeQuery(range);
  const rangeLabel = reportRangeLabel(range);
  const [data, setData] = useState<AdsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTicks, setShowTicks] = useState(false);
  const req = useRef(0);

  function load() {
    const id = ++req.current;
    setLoading(true);
    setError(null);
    fetch(`/api/ads?clientId=${clientId}&${rangeQuery}`)
      .then((r) => r.json())
      .then((d) => {
        if (id !== req.current) return;
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => id === req.current && setError(e.message))
      .finally(() => id === req.current && setLoading(false));
  }
  useEffect(load, [clientId, rangeQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ticking back to the default clears the override rather than pinning it.
  function toggle(c: Campaign) {
    if (!data?.campaigns) return;
    const next = !c.included;
    const override = next === c.defaultIncluded ? null : next;
    setData({ ...data, campaigns: data.campaigns.map((x) => (x.id === c.id ? { ...x, included: next, override } : x)) });
    onSetReporting(clientId, { id: c.id, name: c.name, source: data.source }, override)
      .then(load) // the table and totals follow the new ticks
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Couldn't save");
        load();
      });
  }

  const showCost = !!data && !data.costHidden;
  const t = terms(data?.clientType);
  const costBadge = isCoach && data && !data.clientSeesCost ? <HiddenBadge reason="Cost metrics are off in Client view settings" /> : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {error && <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>}
          {loading && <span className="material-symbols-outlined text-[18px] animate-spin" style={{ color: "var(--text-muted)" }}>progress_activity</span>}
        </div>
        <DateRangePicker value={range} onChange={setRange} maxFrom={maxFrom} />
      </div>
      {isCoach && data && !data.startDate && <StartDateWarning />}

      {/* Campaign performance — revenue, spend, profit, ROI (moved here from the Leads tab). */}
      <ProfitRoiPanel clientId={clientId} rangeQuery={rangeQuery} rangeLabel={rangeLabel} isCoach={isCoach} />

      {!data ? (
        <div className="card rounded-2xl p-5"><span className="skeleton h-4 w-40 block mb-4" /><span className="skeleton h-24 w-full block" /></div>
      ) : (
        <div className="space-y-5 transition-opacity" style={{ opacity: loading ? 0.6 : 1 }}>
          <div className={`grid grid-cols-2 gap-4 ${showCost ? "lg:grid-cols-5" : "lg:grid-cols-3"}`}>
            {showCost && <Card label="Ad spend" value={money(data.cards.spend)} sub={data.spendAllTime ? "All-time (manual campaigns have no dates)" : rangeLabel} badge={costBadge} />}
            <Card label="Total leads" value={data.cards.leads.toLocaleString()} sub={rangeLabel} />
            {showCost && <Card label="Avg cost per lead" value={money(data.cards.costPerLead)} sub={rangeLabel} badge={costBadge} />}
            <Card label={`Total ${t.quotes.toLowerCase()}`} value={data.cards.quotes.toLocaleString()} sub={rangeLabel} />
            <Card label={t.sales} value={data.cards.sales.toLocaleString()} sub={rangeLabel} />
          </div>

          <div className="card rounded-2xl overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[1000px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Campaign", "Status", ...(showCost ? ["Spend"] : []), "Leads", "Live transfers", t.quotes, t.sales, "Revenue", ...(showCost ? ["Cost/lead", "Cost/live transfer", `Cost/${t.quote.toLowerCase()}`, `Cost/${t.sale.toLowerCase()}`] : [])].map((h) => (
                    <th key={h} className="py-3 px-3 text-xs font-bold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Row key={r.name} r={r} showCost={showCost} />
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={showCost ? 12 : 7} className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                      No campaign activity in this period.
                    </td>
                  </tr>
                )}
                {data.rows.length > 0 && <Row r={data.totals} showCost={showCost} total />}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] -mt-3" style={{ color: "var(--text-muted)" }}>
            Each lead and everything it led to — live transfers, bookings, quotes, sales — is credited to the campaign that generated it, counted when it happened in this period. Revenue is dated by the won date.
          </p>

          {/* Jobs won — same panel as Leads → Sales, on the same range: after the campaign table, before the campaign ticks + Meta connection. */}
          <SalesPanel clientId={clientId} rangeQuery={rangeQuery} rangeLabel={rangeLabel} isCoach={isCoach} reloadKey={0} />

          {isCoach && data.campaigns && (
            <div className="card rounded-2xl p-5">
              <button onClick={() => setShowTicks((s) => !s)} className="w-full flex items-center justify-between text-left">
                <span>
                  <span className="text-sm font-semibold block" style={{ color: "var(--text-primary)" }}>Campaigns in reports</span>
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {data.campaigns.filter((c) => c.included).length} of {data.campaigns.length} counted · default: started on/after the client&apos;s start date · coach only
                  </span>
                </span>
                <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--text-muted)" }}>{showTicks ? "expand_less" : "expand_more"}</span>
              </button>
              {showTicks && (
                <div className="mt-4 space-y-1">
                  {data.campaigns.map((c) => (
                    <label key={c.id} className="flex items-center gap-3 py-1.5 cursor-pointer" style={{ borderBottom: "1px solid var(--border)" }}>
                      <input type="checkbox" checked={c.included} onChange={() => toggle(c)} className="w-4 h-4 accent-[var(--primary)]" />
                      <span className="text-sm flex-1 truncate" style={{ color: "var(--text-primary)" }}>{c.name}</span>
                      <span className="text-xs whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                        {c.override != null ? <span className="font-bold" style={{ color: "var(--primary)" }}>Override</span> : "Default"}
                        <span style={{ color: "var(--text-muted)" }}>
                          {" "}· default {c.defaultIncluded ? "included" : "excluded"}
                          {c.startedAt ? ` (started ${sydDate(c.startedAt)})` : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                  {data.campaigns.length === 0 && <p className="text-xs" style={{ color: "var(--text-muted)" }}>No campaigns yet — connect Meta below.</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ r, showCost, total }: { r: CampaignRow; showCost: boolean; total?: boolean }) {
  const td = "py-2.5 px-3 whitespace-nowrap";
  const muted = { color: "var(--text-secondary)" };
  return (
    <tr style={{ borderBottom: "1px solid var(--border)", background: total ? "var(--surface-hover)" : undefined }}>
      <td className={`${td} font-medium max-w-[260px] truncate`} title={r.name} style={{ color: "var(--text-primary)" }}>{total ? <strong>{r.name}</strong> : r.name}</td>
      <td className={td}>{r.status && <StatusBadge status={r.status} />}</td>
      {showCost && <td className={td} style={{ color: "var(--text-primary)" }}>{money(r.spend)}</td>}
      <td className={td} style={muted}>{r.leads.toLocaleString()}</td>
      <td className={td} style={muted}>
        {r.liveTransfers.toLocaleString()}
        {r.bookings > 0 && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}> +{r.bookings} booked</span>}
      </td>
      <td className={td} style={muted}>{r.quotes.toLocaleString()}</td>
      <td className={`${td} font-semibold`} style={{ color: "var(--primary)" }}>{r.sales.toLocaleString()}</td>
      <td className={td} style={{ color: "var(--text-primary)" }}>{money(r.revenue)}</td>
      {showCost && (
        <>
          <td className={td} style={muted}>{money(r.costPerLead)}</td>
          <td className={td} style={muted}>{money(r.costPerLiveTransfer)}</td>
          <td className={td} style={muted}>{money(r.costPerQuote)}</td>
          <td className={td} style={muted}>{money(r.costPerSale)}</td>
        </>
      )}
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  const active = status === "Active";
  return (
    <span
      className="px-2 py-1 rounded-full text-xs font-bold"
      style={{ background: active ? "var(--primary-tint)" : "var(--surface-hover)", color: active ? "var(--primary)" : "var(--text-secondary)" }}
    >
      {status}
    </span>
  );
}

function Card({ label, value, sub, badge }: { label: string; value: string; sub: string; badge?: React.ReactNode }) {
  return (
    <div className="card rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</p>
        {badge}
      </div>
      <p className="font-heading text-2xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>{value}</p>
      <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{sub}</p>
    </div>
  );
}
