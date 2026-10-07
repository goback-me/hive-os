"use client";

import { useEffect, useState } from "react";
import type { ClientCallHistory, HistoryCall } from "@/lib/am-calls";
import { openCallPanel } from "@/lib/url-param";

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short" });

export const CALL_STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  PENDING: { label: "Upcoming", bg: "var(--primary-tint)", fg: "var(--primary)" },
  LATE: { label: "Needs update", bg: "var(--tag-amber-bg)", fg: "var(--tag-amber-fg)" },
  HELD: { label: "Held", bg: "var(--tag-green-bg)", fg: "var(--tag-green-fg)" },
  RESCHEDULED: { label: "Rescheduled", bg: "var(--tag-purple-bg)", fg: "var(--tag-purple-fg)" },
  NOT_HELD: { label: "Didn't happen", bg: "var(--danger-tint)", fg: "var(--danger)" },
};
export const statusKey = (status: string, scheduledAt: string) => (status === "PENDING" && new Date(scheduledAt) < new Date() ? "LATE" : status);
export function StatusChip({ status, scheduledAt }: { status: string; scheduledAt: string }) {
  const s = CALL_STATUS_STYLE[statusKey(status, scheduledAt)];
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>{s.label}</span>;
}

// One client's calls, opened inline under a row (My Calls, Account
// Management): the next call with [Reschedule] [Log now], the history with
// reschedule chains and how long each took to log, and quick stats. Buttons
// only open the call panel (?update=) — nothing here navigates away.
export default function ClientCallsDropdown({ clientId, initial }: { clientId: string; initial?: ClientCallHistory }) {
  const [data, setData] = useState<ClientCallHistory | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    fetch(`/api/clients/calls?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => r.json())
      .then((res) => (res.error ? setError(res.error) : setData(res)))
      .catch((e) => setError(e.message));
  }, [clientId, initial]);

  if (error) return <p className="text-xs p-4" style={{ color: "var(--danger)" }}>{error}</p>;
  if (!data) return <p className="text-xs p-4" style={{ color: "var(--text-muted)" }}>Loading calls…</p>;
  const btn = "px-3 py-1.5 rounded-lg text-xs font-bold";

  return (
    <div className="p-4 space-y-4" style={{ background: "var(--surface-hover)" }}>
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          <span style={{ color: "var(--text-muted)" }}>Next call: </span>
          {data.next ? when(data.next.scheduledAt) : "none booked"}
        </p>
        {data.next && (
          <div className="flex gap-2">
            <button type="button" className={btn} style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }} onClick={() => openCallPanel(data.next!.id, "reschedule")}>Reschedule</button>
            <button type="button" className={`${btn} btn-gradient`} onClick={() => openCallPanel(data.next!.id)}>Log now</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(
          [
            ["Held this month", data.stats.heldThisMonth],
            ["Missed this month", data.stats.missedThisMonth],
            ["Rescheduled this month", data.stats.rescheduledThisMonth],
            ["Avg days to log", data.stats.avgDaysToLog ?? "—"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg p-2" style={{ background: "var(--surface-card)" }}>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{k}</p>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{v}</p>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        {data.history.length === 0 && <p className="text-xs" style={{ color: "var(--text-muted)" }}>No calls yet.</p>}
        {data.history.map((c) => (
          <HistoryRow key={c.id} c={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
        ))}
      </div>
    </div>
  );
}

function HistoryRow({ c, open, onToggle }: { c: HistoryCall; open: boolean; onToggle: () => void }) {
  const chain = c.chain.length > 1 ? c.chain.map((x) => day(x.at)).join(" → ") : null;
  return (
    <div className="rounded-lg" style={{ background: "var(--surface-card)" }}>
      <button type="button" onClick={onToggle} className="w-full text-left px-3 py-2 flex flex-wrap items-center gap-2 text-xs" aria-expanded={open}>
        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{when(c.scheduledAt)}</span>
        <StatusChip status={c.status} scheduledAt={c.scheduledAt} />
        {c.outcome && <span style={{ color: c.outcome === "At risk" ? "var(--danger)" : "var(--text-secondary)" }}>{c.outcome}</span>}
        {c.callPerson && <span style={{ color: "var(--text-muted)" }}>{c.callPerson}</span>}
        {chain && <span style={{ color: "var(--text-muted)" }}>{chain} → {CALL_STATUS_STYLE[statusKey(c.status, c.scheduledAt)].label.toLowerCase()}</span>}
        {c.loggedDaysAfter != null && <span style={{ color: c.loggedDaysAfter > 1 ? "var(--tag-amber-fg)" : "var(--text-muted)" }}>logged {c.loggedDaysAfter === 0 ? "same day" : `${c.loggedDaysAfter} day${c.loggedDaysAfter === 1 ? "" : "s"} after call`}</span>}
        <span className="ml-auto material-symbols-outlined text-[16px]" style={{ color: "var(--text-muted)" }}>{open ? "expand_less" : "expand_more"}</span>
      </button>
      {!open && c.summary && <p className="px-3 pb-2 -mt-1 text-xs truncate" style={{ color: "var(--text-secondary)" }}>{c.summary}</p>}
      {open && (
        <div className="px-3 pb-3 space-y-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          {c.summary && <p className="whitespace-pre-wrap">{c.summary}</p>}
          {c.nextSteps.length > 0 && <ul className="list-disc pl-4">{c.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ul>}
          {c.reason && <p>Reason: {c.reason}</p>}
          {c.internalNotes && (
            <p className="rounded-lg p-2" style={{ background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }}>
              <b>Internal — not visible to client:</b> {c.internalNotes}
            </p>
          )}
          <button type="button" onClick={() => openCallPanel(c.id)} className="text-xs font-bold" style={{ color: "var(--primary)" }}>
            {c.status === "PENDING" ? "Update" : "Edit"}
          </button>
        </div>
      )}
    </div>
  );
}
