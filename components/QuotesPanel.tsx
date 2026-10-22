"use client";

import { useEffect, useRef, useState } from "react";
import type { QuoteRow, QuoteStatus, QuotesResponse } from "@/lib/quotes";
import { TONE_STYLE } from "@/components/SnapshotPanel";
import { terms } from "@/lib/client-terms";
import LeadLink from "@/components/LeadLink";

const money = (v: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 })}`);
const sydDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" });
const fmtPct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
const fmtDays = (v: number | null) => (v == null ? "—" : `${v}d`);
const PREVIEW_ROWS = 5;
const PAGE_SIZE = 50;

type Filter = "all" | QuoteStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All quotes" },
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];
const STATUS_STYLE: Record<QuoteStatus, { label: string; fg: string; bg: string }> = {
  open: { label: "Open", fg: "var(--tag-indigo-fg)", bg: "var(--tag-indigo-bg)" },
  won: { label: "Won", fg: "var(--tag-green-fg)", bg: "var(--tag-green-bg)" },
  lost: { label: "Lost", fg: "var(--danger)", bg: "var(--danger-tint)" },
};

function displayCampaignName(name: string | null) {
  const trimmed = name?.trim();
  return !trimmed || trimmed === "-" ? "Unattributed" : trimmed;
}

// Leads tab → Quotes, and on the Ads tab under Sales: every quoted lead in
// the range (dated by its quote), split open / won / lost, how long open
// quotes have been outstanding, how long won ones took, and why lost ones
// were lost. See lib/quotes.ts.
export default function QuotesPanel({ clientId, rangeQuery, rangeLabel, reloadKey, initialFilter = "all" }: { clientId: string; rangeQuery: string; rangeLabel: string; reloadKey: number; initialFilter?: Filter }) {
  const [data, setData] = useState<QuotesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    setLoading(true);
    setError(null);
    fetch(`/api/leads/quotes?clientId=${clientId}&${rangeQuery}`)
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

  const { summary: s } = data;
  const t = terms(data.clientType);
  const q = t.quote.toLowerCase();
  const list = filter === "all" ? data.quotes : data.quotes.filter((x) => x.status === filter);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const visible = expanded ? list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : list.slice(0, PREVIEW_ROWS);
  const daysHeader = filter === "open" ? "Days outstanding" : filter === "won" ? `Days ${q} → won` : filter === "lost" ? `Days ${q} → lost` : "Days";
  const tone = s.tone ? TONE_STYLE[s.tone] : null;
  const diff = s.previous ? s.current.count - s.previous.count : 0;

  return (
    <div className="space-y-5 fade-in">
      <div className="card rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t.quotes}</p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>Quoted leads, dated by when the {q} went out · {rangeLabel}</p>
          </div>
          {loading && <span className="material-symbols-outlined text-[18px] animate-spin" style={{ color: "var(--text-muted)" }}>progress_activity</span>}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-5 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }}>
          <Card icon="request_quote" label={t.quotes} value={s.current.count.toLocaleString()}>
            <div className="flex items-center gap-1.5 min-h-[20px]">
              {diff !== 0 && tone && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: tone.bg, color: tone.fg }}>
                  <span className="material-symbols-outlined text-[12px]">{diff > 0 ? "arrow_upward" : "arrow_downward"}</span>
                  {Math.abs(diff).toLocaleString()}
                </span>
              )}
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{s.previous ? `${s.compareLabel}: ${s.previous.count}` : `Lifetime ${s.lifetime.count}`}</span>
            </div>
            <Sub>{money(s.current.value)} quoted</Sub>
          </Card>
          <Card icon="percent" label={`${t.quote} rate`} value={fmtPct(s.quoteRate)}>
            <Sub>{s.current.count} of {s.liveTransfers} live transfers</Sub>
          </Card>
          <Card icon="hourglass_top" label={`Open ${t.quotes.toLowerCase()}`} value={s.open.count.toLocaleString()} onClick={() => setFilter("open")}>
            <Sub>{money(s.open.value)} outstanding</Sub>
            <Sub>
              Avg {fmtDays(s.open.avgDaysOutstanding)} open{s.open.updatePending > 0 && <span style={{ color: "var(--tag-amber-fg)" }}> · {s.open.updatePending} update pending</span>}
            </Sub>
          </Card>
          <Card icon="handshake" label={`${t.quotes} won`} value={s.won.count.toLocaleString()} onClick={() => setFilter("won")}>
            <Sub>{fmtPct(s.won.rate)} of {t.quotes.toLowerCase()} · {money(s.won.value)}</Sub>
          </Card>
          <Card icon="thumb_down" label={`${t.quotes} lost`} value={s.lost.count.toLocaleString()} onClick={() => setFilter("lost")}>
            <Sub>{fmtPct(s.lost.rate)} of {t.quotes.toLowerCase()} · {money(s.lost.value)}</Sub>
          </Card>
          <Card icon="timer" label={`Avg ${q} → won`} value={s.won.avgDaysToWon == null ? "—" : `${s.won.avgDaysToWon}d`}>
            <Sub>Time to convert a {q}</Sub>
          </Card>
        </div>

        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{list.length.toLocaleString()} {filter === "all" ? t.quotes.toLowerCase() : `${filter} ${t.quotes.toLowerCase()}`}</p>
          <select
            value={filter}
            onChange={(e) => { setFilter(e.target.value as Filter); setExpanded(false); setPage(1); }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold outline-none"
            style={{ background: "var(--surface-hover)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          >
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        {list.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No {filter === "all" ? "" : `${filter} `}{t.quotes.toLowerCase()} in this date range.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[760px]">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Quoted", "Lead", "Campaign", `${t.quote} value`, "Status", daysHeader, "Opt-in → quote", "Update"].map((h) => (
                      <th key={h} className="py-2 pr-4 text-xs font-bold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => <Row key={r.id} r={r} />)}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-3">
              {list.length > PREVIEW_ROWS ? (
                <button onClick={() => { setExpanded((e) => !e); setPage(1); }} className="text-xs font-bold" style={{ color: "var(--primary)" }}>
                  {expanded ? "Show fewer" : `View all (${list.length})`}
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
          </>
        )}
        <p className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
          Open = quoted and not won, lost or disqualified yet. Days for won / lost run from the {q} to the outcome; “—” where the {q} date isn&apos;t recorded. {t.quote} rate = {t.quotes.toLowerCase()} ÷ live transfers in this period.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Breakdown title={`${t.quotes} lost by reason`} total={s.lost.count} rows={data.lostByReason} />
        <Breakdown title={`Open ${t.quotes.toLowerCase()} by days outstanding`} total={s.open.count} rows={data.openByAge} />
      </div>
    </div>
  );
}

function Row({ r }: { r: QuoteRow }) {
  const st = STATUS_STYLE[r.status];
  const daysVal = r.status === "open" ? r.daysOutstanding : r.daysToClose;
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }} title={r.quoteDateKnown ? undefined : "Quote date not recorded — estimated"}>
        {sydDate(r.quotedAt)}{!r.quoteDateKnown && " *"}
      </td>
      <td className="py-2 pr-4 font-medium whitespace-nowrap" style={{ color: "var(--text-primary)" }}><LeadLink id={r.id}>{r.name || "Unnamed lead"}</LeadLink></td>
      <td className="py-2 pr-4 whitespace-nowrap max-w-[220px] truncate" style={{ color: "var(--text-secondary)" }} title={r.campaign ?? undefined}>{displayCampaignName(r.campaign)}</td>
      <td className="py-2 pr-4 whitespace-nowrap font-semibold" style={{ color: "var(--text-primary)" }}>{money(r.value)}</td>
      <td className="py-2 pr-4 whitespace-nowrap">
        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
        {r.lostReason && <span className="ml-1.5 text-xs" style={{ color: "var(--text-muted)" }}>{r.lostReason}</span>}
      </td>
      <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{fmtDays(daysVal)}</td>
      <td className="py-2 pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{fmtDays(r.daysOptInToQuote)}</td>
      <td className="py-2 pr-4 whitespace-nowrap text-xs">
        {r.likelyLost ? (
          <span style={{ color: "var(--danger)" }}>Likely lost?</span>
        ) : r.updatePending ? (
          <span style={{ color: "var(--tag-amber-fg)" }}>Update pending</span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        )}
      </td>
    </tr>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>{children}</p>;
}

function Card({ icon, label, value, onClick, children }: { icon: string; label: string; value: string; onClick?: () => void; children?: React.ReactNode }) {
  return (
    <div className={`rounded-xl p-4 ${onClick ? "cursor-pointer" : ""}`} style={{ background: "var(--surface-hover)" }} onClick={onClick}>
      <div className="flex items-center gap-2 min-w-0 mb-2">
        <span className="icon-chip w-7 h-7 shrink-0" style={{ background: "var(--primary-tint)" }}>
          <span className="material-symbols-outlined text-[15px]" style={{ color: "var(--primary)" }}>{icon}</span>
        </span>
        <p className="text-xs font-semibold truncate" style={{ color: "var(--text-secondary)" }}>{label}</p>
      </div>
      <p className="font-heading font-bold text-2xl" style={{ color: "var(--text-primary)" }}>{value}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// Same bar list as the Breakdown tab's DQ / lost sections.
function Breakdown({ title, total, rows }: { title: string; total: number; rows: { label: string; n: number }[] }) {
  return (
    <div className="card rounded-2xl p-5">
      <p className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
        {title} <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>· {total}</span>
      </p>
      <div className="space-y-2">
        {rows.filter((r) => r.n > 0).map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-xs mb-0.5">
              <span style={{ color: r.label.includes("missing") ? "var(--danger)" : "var(--text-secondary)" }}>{r.label}</span>
              <span style={{ color: "var(--text-primary)" }}>{r.n} · {fmtPct(total > 0 ? (r.n / total) * 100 : null)}</span>
            </div>
            <div className="h-1.5 rounded-full" style={{ background: "var(--surface-hover)" }}>
              <div className="h-full rounded-full" style={{ width: `${total > 0 ? (r.n / total) * 100 : 0}%`, background: "var(--text-muted)" }} />
            </div>
          </div>
        ))}
        {total === 0 && <p className="text-xs" style={{ color: "var(--text-muted)" }}>None</p>}
      </div>
    </div>
  );
}
