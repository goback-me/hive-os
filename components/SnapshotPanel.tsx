"use client";

import { useRef, useState } from "react";
import type { Snapshot, SnapshotCard, Tone } from "@/lib/kpi";
import HiddenBadge from "@/components/HiddenBadge";

const ICONS: Record<SnapshotCard["key"], string> = {
  liveTransfers: "call",
  consultsBooked: "event_available",
  quotes: "request_quote",
  sales: "handshake",
  costPerQuote: "receipt_long",
  costPerSale: "price_check",
  leads: "person_add",
};

export const TONE_STYLE: Record<Tone, { bg: string; fg: string }> = {
  green: { bg: "var(--tag-green-bg)", fg: "var(--tag-green-fg)" },
  amber: { bg: "var(--tag-amber-bg)", fg: "var(--tag-amber-fg)" },
  red: { bg: "var(--danger-tint)", fg: "var(--danger)" },
};

const fmt = (card: Pick<SnapshotCard, "kind">, v: number | null) =>
  v == null ? "—" : card.kind === "cost" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 })}` : v.toLocaleString();

// Monthly KPI cards. Everything a CLIENT shouldn't see was already dropped by
// the server (lib/kpi.ts getSnapshot); coaches get every card, with the ones
// the client doesn't see greyed and badged.
export default function SnapshotPanel({
  clientId,
  initial,
  isCoach,
  onRebuild,
}: {
  clientId: string;
  initial: Snapshot;
  isCoach: boolean;
  onRebuild?: (clientId: string) => Promise<{ months: number }>;
}) {
  const [snap, setSnap] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  function pickMonth(month: string) {
    const id = ++req.current;
    setLoading(true);
    setError(null);
    fetch(`/api/clients/snapshot?clientId=${clientId}&month=${month}`)
      .then((r) => r.json())
      .then((data) => {
        if (id !== req.current) return;
        if (data.error) throw new Error(data.error);
        setSnap(data);
      })
      .catch((e) => id === req.current && setError(e.message))
      .finally(() => id === req.current && setLoading(false));
  }

  // Coach: recompute every closed month that isn't frozen (Rebuild history).
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuilt, setRebuilt] = useState<string | null>(null);
  function rebuild() {
    if (!onRebuild) return;
    setRebuilding(true);
    setError(null);
    onRebuild(clientId)
      .then((r) => {
        setRebuilt(`Rebuilt ${r.months} month${r.months === 1 ? "" : "s"}`);
        pickMonth(snap.month);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Rebuild failed"))
      .finally(() => setRebuilding(false));
  }

  const clientSeesNothing = snap.cards.every((c) => c.hiddenFromClient);

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Snapshot</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {snap.isCurrent ? `${snap.monthLabel} so far` : snap.monthLabel} · {snap.compareLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>}
          {loading && <span className="material-symbols-outlined text-[18px] animate-spin" style={{ color: "var(--text-muted)" }}>progress_activity</span>}
          {rebuilt && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{rebuilt}</span>}
          {isCoach && onRebuild && (
            <button
              onClick={rebuild}
              disabled={rebuilding}
              className="px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              title="Recompute every past month from the opt-in dates and notes (months frozen at month end are kept)"
            >
              {rebuilding ? "Rebuilding…" : "Rebuild history"}
            </button>
          )}
          <a href="?tab=leads" className="text-xs font-bold whitespace-nowrap" style={{ color: "var(--primary)" }}>
            Full breakdown →
          </a>
          <select
            value={snap.month}
            onChange={(e) => pickMonth(e.target.value)}
            className="px-3 py-2 rounded-lg text-xs font-bold outline-none"
            style={{ background: "var(--surface-card)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            aria-label="Snapshot month"
          >
            {snap.months.map((m, i) => (
              <option key={m.key} value={m.key}>{i === 0 ? `This month (${m.label})` : m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {isCoach && clientSeesNothing && (
        <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
          <span className="material-symbols-outlined text-[14px]">info</span>
          Nothing here is shown to the client yet — they see &ldquo;Campaign ramping up&rdquo; instead.
        </p>
      )}

      {snap.cards.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ background: "var(--surface-hover)" }}>
          <span className="material-symbols-outlined text-3xl mb-1" style={{ color: "var(--primary)" }}>rocket_launch</span>
          <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>Campaign ramping up</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>Your first results will show here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }}>
          {snap.cards.map((c) => (
            <KpiCard key={c.key} card={c} isCoach={isCoach} />
          ))}
        </div>
      )}

      {isCoach && (
        <p className="text-[10px] mt-3" style={{ color: "var(--text-muted)" }}>
          Counts are by when each step happened (the team&apos;s dated notes, else the stage change seen live), in Sydney time.{" "}
          {snap.spendSource === "meta" ? "Spend from Meta." : snap.spendSource === "daily" ? "Spend from daily spend records." : "No dated spend source — connect Meta for cost cards."}
          {" "}Past months are frozen on the 1st; &ldquo;Rebuild history&rdquo; recomputes any month that isn&apos;t frozen yet.
        </p>
      )}
    </div>
  );
}

function KpiCard({ card, isCoach }: { card: SnapshotCard; isCoach: boolean }) {
  const dim = isCoach && card.hiddenFromClient;
  const tone = card.tone ? TONE_STYLE[card.tone] : null;
  const diff = card.value != null && card.previous != null ? card.value - card.previous : null;
  const up = diff != null && diff > 0;

  return (
    <div className="rounded-xl p-4 transition-opacity" style={{ background: "var(--surface-hover)", opacity: dim ? 0.55 : 1 }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="icon-chip w-7 h-7 shrink-0" style={{ background: "var(--primary-tint)" }}>
            <span className="material-symbols-outlined text-[15px]" style={{ color: "var(--primary)" }}>{ICONS[card.key]}</span>
          </span>
          <p className="text-xs font-semibold truncate" style={{ color: "var(--text-secondary)" }}>{card.label}</p>
        </div>
        {dim && <HiddenBadge reason={card.hiddenFromClient!} />}
      </div>
      <p key={String(card.value)} className="font-heading font-bold text-2xl fade-in" style={{ color: "var(--text-primary)" }}>
        {fmt(card, card.value)}
      </p>
      <div className="flex items-center gap-1.5 mt-1.5 min-h-[20px]">
        {diff != null && diff !== 0 && tone ? (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: tone.bg, color: tone.fg }}>
            <span className="material-symbols-outlined text-[12px]">{up ? "arrow_upward" : "arrow_downward"}</span>
            {card.kind === "cost" ? fmt(card, Math.abs(diff)) : Math.abs(diff).toLocaleString()}
          </span>
        ) : null}
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {card.previous == null
            ? "No comparison yet"
            : card.previous === 0
            ? "— (none before)"
            : diff === 0
            ? `Same as before (${fmt(card, card.previous)})`
            : `was ${fmt(card, card.previous)}`}
        </span>
      </div>
      {card.pace != null && <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>On pace for ~{card.pace.toLocaleString()}</p>}
      <MiniBars history={card.history} kind={card.kind} />
    </div>
  );
}

// Last 6 months, oldest → newest (the selected month is the last bar).
function MiniBars({ history, kind }: { history: SnapshotCard["history"]; kind: SnapshotCard["kind"] }) {
  const max = Math.max(...history.map((h) => h.value ?? 0), 0);
  if (!max) return null;
  return (
    <div className="flex items-end gap-1 h-8 mt-2" aria-hidden="true">
      {history.map((h, i) => (
        <div
          key={h.month}
          className="flex-1 rounded-t-[2px]"
          title={`${h.month}: ${h.value == null ? "—" : kind === "cost" ? `$${Math.round(h.value).toLocaleString()}` : h.value.toLocaleString()}`}
          style={{ height: `${Math.max(((h.value ?? 0) / max) * 100, h.value ? 6 : 0)}%`, background: i === history.length - 1 ? "var(--primary)" : "var(--primary-tint)" }}
        />
      ))}
    </div>
  );
}
