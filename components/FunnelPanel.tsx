"use client";

import { DQ_PHASES, DQ_PHASE_LABELS, DQ_REASONS, DQ_REASON_LABELS, LOST_REASONS, LOST_REASON_LABELS } from "@/lib/lead-status";
import { DURATION_KEYS, DURATION_LABELS, biggestDrop, type DqBreakdown, type FunnelCounts, type FunnelResponse } from "@/lib/funnel";
import HiddenBadge from "@/components/HiddenBadge";

const fmtPct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
const fmtDays = (v: number | null) => (v == null ? "—" : v < 1 ? `${Math.round(v * 24)}h` : `${v.toFixed(1)}d`);

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

// Sections a CLIENT isn't allowed to see arrive as null from the server
// (funnelForViewer); a coach gets everything plus "hidden from client" badges.
export default function FunnelPanel({
  data,
  loading,
  isCoach,
}: {
  data: FunnelResponse | null;
  loading: boolean;
  isCoach: boolean;
}) {
  // Not loaded yet — placeholder in the funnel's shape.
  if (!data) {
    return (
      <div className="card rounded-2xl p-5 space-y-3" role="status" aria-label="Loading funnel">
        <span className="skeleton h-4 w-56 block mb-4" />
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-3">
            <span className="skeleton h-3 w-28" />
            <span className="skeleton h-6 rounded-md" style={{ width: `${Math.max(90 - i * 11, 8)}%` }} />
          </div>
        ))}
      </div>
    );
  }
  const { funnel, dq, visibility } = data;
  const funnelBadge = isCoach && !visibility.showFunnel ? <HiddenBadge reason="Funnel is off in Client view settings" /> : null;
  const dqBadge = isCoach && !visibility.showDqBreakdown ? <HiddenBadge reason="DQ & lost breakdown is off in Client view settings" /> : null;

  if (!funnel) return dq ? <DqSection dq={dq} badge={dqBadge} /> : null;

  const { overall } = funnel;
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
    <div className="space-y-5 fade-in">
      {/* Funnel bar with step conversion */}
      <div className="card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            Funnel (leads that opted in this period) {funnelBadge}
          </p>
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
                      className="h-full rounded-md flex items-center px-2 text-[11px] font-bold bar-grow"
                      style={{ animationDelay: `${i * 60}ms`, width: `${width}%`, background: step.key === "won" ? "var(--primary)" : "var(--primary-tint)", color: step.key === "won" ? "#fff" : "var(--primary)" }}
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
          {dq && <Stat label="Lost" value={dq.lost.toLocaleString()} />}
          {dq && <Stat label="Disqualified" value={dq.dq.toLocaleString()} />}
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
          From the team's dated notes when available, otherwise stage changes the app saw happen (sync or manual) — imported and inferred stages have no reliable time.
        </p>
      </div>

      {dq && <DqSection dq={dq} badge={dqBadge} />}

    </div>
  );
}

function DqSection({ dq, badge }: { dq: DqBreakdown; badge: React.ReactNode }) {
  if (dq.dq === 0 && dq.lost === 0) return null;
  return (
    <div>
      {badge && <div className="mb-2">{badge}</div>}
      <DqTotal dq={dq} />
      <div className="grid md:grid-cols-3 gap-5">
        <Breakdown title="DQ by phase" total={dq.dq} rows={[...DQ_PHASES, "UNKNOWN" as const].map((p) => ({ label: p === "UNKNOWN" ? "Phase missing" : DQ_PHASE_LABELS[p], n: dq.dqByPhase[p] }))} />
        <Breakdown title="DQ by reason" total={dq.dq} rows={DQ_REASONS.map((r) => ({ label: DQ_REASON_LABELS[r], n: dq.dqByReason[r] }))} />
        <Breakdown title="Lost by reason" total={dq.lost} rows={LOST_REASONS.map((r) => ({ label: LOST_REASON_LABELS[r], n: dq.lostByReason[r] }))} />
      </div>
    </div>
  );
}

// Total DQ rate for the leads that came in this period, then how those DQs
// split by how far each lead got.
function DqTotal({ dq }: { dq: DqBreakdown }) {
  const share = (n: number) => fmtPct(dq.dq > 0 ? (n / dq.dq) * 100 : null);
  const phases = [...DQ_PHASES.map((p) => ({ label: DQ_PHASE_LABELS[p], n: dq.dqByPhase[p] })), { label: "Phase missing", n: dq.dqByPhase.UNKNOWN }].filter(
    (p) => p.label !== "Phase missing" || p.n > 0
  );
  return (
    <div className="card rounded-2xl p-5 mb-5">
      <p className="font-heading font-bold text-lg" style={{ color: "var(--text-primary)" }}>
        {fmtPct(dq.leads > 0 ? (dq.dq / dq.leads) * 100 : null)} of leads disqualified{" "}
        <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>({dq.dq.toLocaleString()} of {dq.leads.toLocaleString()})</span>
      </p>
      {dq.dq > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2">
          {phases.map((p) => (
            <p key={p.label} className="text-xs" style={{ color: p.label === "Phase missing" ? "var(--danger)" : "var(--text-secondary)" }}>
              {p.label}: <strong style={{ color: "var(--text-primary)" }}>{p.n.toLocaleString()}</strong> ({share(p.n)} of DQs)
            </p>
          ))}
        </div>
      )}
    </div>
  );
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
