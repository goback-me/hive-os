"use client";

import { DQ_PHASES, DQ_PHASE_LABELS, DQ_REASONS, DQ_REASON_LABELS, LOST_REASONS, LOST_REASON_LABELS } from "@/lib/lead-status";
import { DURATION_KEYS, DURATION_LABELS, biggestDrop, type FunnelCounts, type FunnelGroup } from "@/lib/funnel";

type ClientFunnel = { overall: FunnelGroup; campaigns: FunnelGroup[] };

const fmtPct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
const fmtMoney = (v: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 })}`);
const fmtDays = (v: number | null) => (v == null ? "—" : v < 1 ? `${Math.round(v * 24)}h` : `${v.toFixed(1)}d`);

function displayCampaignName(name: string) {
  const trimmed = name.trim();
  return !trimmed || trimmed === "-" ? "Unattributed" : trimmed;
}

// The main-path steps shown in the funnel bar, in order.
const STEPS: { key: keyof FunnelCounts; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "handovers", label: "Handovers" },
  { key: "consultsBooked", label: "Consults booked" },
  { key: "consultsAttended", label: "Attended" },
  { key: "quotes", label: "Quotes" },
  { key: "won", label: "Won" },
];

export default function FunnelPanel({ funnel, loading, onViewCampaign }: { funnel: ClientFunnel; loading: boolean; onViewCampaign: (campaign: string) => void }) {
  const { overall, campaigns } = funnel;
  const c = overall.counts;
  const drop = biggestDrop(c);

  if (c.leads === 0) {
    return (
      <div className="card rounded-2xl p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        No leads in this date range.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Funnel bar with step conversion */}
      <div className="card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Funnel (leads that opted in this period)</p>
          {loading && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Updating…</span>}
        </div>
        <div className="space-y-1.5">
          {STEPS.map((step, i) => {
            const n = c[step.key] as number;
            const prev = i > 0 ? (c[STEPS[i - 1].key] as number) : null;
            const width = Math.max((n / c.leads) * 100, n > 0 ? 1 : 0);
            return (
              <div key={step.key}>
                {prev != null && (
                  <p className="text-[10px] pl-32 py-0.5" style={{ color: "var(--text-muted)" }}>
                    ↓ {fmtPct(prev > 0 ? (n / prev) * 100 : null)}
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs font-semibold text-right" style={{ color: "var(--text-secondary)" }}>{step.label}</span>
                  <div className="flex-1 h-6 rounded-md overflow-hidden" style={{ background: "var(--surface-hover)" }}>
                    <div
                      className="h-full rounded-md flex items-center px-2 text-[11px] font-bold"
                      style={{ width: `${width}%`, background: step.key === "won" ? "var(--primary)" : "var(--primary-tint)", color: step.key === "won" ? "#fff" : "var(--primary)" }}
                    >
                      {n.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <Stat label="Overall conversion" value={fmtPct(overall.rates.overallConversion)} strong />
          <Stat label="Live transfer rate" value={fmtPct(overall.rates.liveTransferRate)} />
          <Stat label="No-shows" value={c.noShows.toLocaleString()} />
          <Stat label="Lost" value={c.lost.toLocaleString()} />
          <Stat label="Disqualified" value={c.dq.toLocaleString()} />
        </div>
      </div>

      {drop && (
        <div className="card rounded-2xl p-4 flex items-start gap-3" style={{ borderLeft: "4px solid var(--danger)" }}>
          <span className="material-symbols-outlined text-[22px]" style={{ color: "var(--danger)" }}>trending_down</span>
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Biggest drop: {drop.step} — {fmtPct(drop.rate)} ({drop.to} of {drop.from})
            </p>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{drop.advice}</p>
            {drop.evidence && <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{drop.evidence}</p>}
          </div>
        </div>
      )}

      {/* Median time between steps */}
      <div className="card rounded-2xl p-5">
        <p className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Median time between steps</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {DURATION_KEYS.map((k) => (
            <div key={k} className="p-3 rounded-lg" style={{ background: "var(--surface-hover)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{DURATION_LABELS[k]}</p>
              <p className="font-heading font-bold text-lg" style={{ color: "var(--text-primary)" }}>{fmtDays(overall.durations[k].medianDays)}</p>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>n = {overall.durations[k].n}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
          Only from stage changes the app saw happen (sync or manual) — imported and inferred stages have no reliable time.
        </p>
      </div>

      {/* DQ / lost breakdown */}
      {(c.dq > 0 || c.lost > 0) && (
        <div className="grid md:grid-cols-3 gap-5">
          <Breakdown title="DQ by phase" total={c.dq} rows={[...DQ_PHASES, "UNKNOWN" as const].map((p) => ({ label: p === "UNKNOWN" ? "Phase missing" : DQ_PHASE_LABELS[p], n: c.dqByPhase[p] }))} />
          <Breakdown title="DQ by reason" total={c.dq} rows={DQ_REASONS.map((r) => ({ label: DQ_REASON_LABELS[r], n: c.dqByReason[r] }))} />
          <Breakdown title="Lost by reason" total={c.lost} rows={LOST_REASONS.map((r) => ({ label: LOST_REASON_LABELS[r], n: c.lostByReason[r] }))} />
        </div>
      )}

      {/* Per campaign */}
      <div>
        <p className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>{campaigns.length} campaigns</p>
        <div className="card rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[1100px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Campaign", "Leads", "Contacted", "Qualified", "Consults", "Won", "Contact %", "Show %", "Close %", "Overall %", "Spend", "CPL", "Cost/qualified", "Cost/consult", "Cost/won", ""].map((h) => (
                  <th key={h} className="py-2 px-3 text-xs font-bold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...campaigns, overall].map((row) => {
                const isAll = row === overall;
                return (
                  <tr key={row.campaign} style={{ borderBottom: "1px solid var(--border)", background: isAll ? "var(--surface-hover)" : undefined }}>
                    <td className="py-2 px-3 font-medium max-w-[220px] truncate" title={row.campaign} style={{ color: "var(--text-primary)" }}>
                      {isAll ? <strong>All campaigns</strong> : displayCampaignName(row.campaign)}
                    </td>
                    <Td>{row.counts.leads}</Td>
                    <Td>{row.counts.contacted}</Td>
                    <Td>{row.counts.qualified}</Td>
                    <Td>{row.counts.consultsBooked}</Td>
                    <td className="py-2 px-3 font-semibold" style={{ color: "var(--primary)" }}>{row.counts.won}</td>
                    <Td>{fmtPct(row.rates.contactRate)}</Td>
                    <Td>{fmtPct(row.rates.showRate)}</Td>
                    <Td>{fmtPct(row.rates.closeRate)}</Td>
                    <Td>{fmtPct(row.rates.overallConversion)}</Td>
                    <Td>
                      {fmtMoney(row.spend)}
                      {row.spendSource && <span style={{ color: "var(--text-muted)" }}> ({row.spendSource})</span>}
                    </Td>
                    <Td>{fmtMoney(row.costPerLead)}</Td>
                    <Td>{fmtMoney(row.costPerQualified)}</Td>
                    <Td>{fmtMoney(row.costPerConsult)}</Td>
                    <Td>{fmtMoney(row.costPerWon)}</Td>
                    <td className="py-2 px-3">
                      {!isAll && (
                        <button onClick={() => onViewCampaign(row.campaign)} className="text-xs font-semibold whitespace-nowrap" style={{ color: "var(--primary)" }}>
                          View leads
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="py-2 px-3 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{children}</td>;
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-heading font-bold text-base" style={{ color: strong ? "var(--primary)" : "var(--text-primary)" }}>{value}</span>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

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
