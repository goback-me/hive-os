"use client";

import { useState } from "react";
// `internal` is only ever built for the team (getStatusCalls) — a CLIENT's
// props never contain it.
import type { StatusCall } from "@/lib/weekly-meetings";

export type EarlierUpdate = { id: string; weekOf: string; wins: string; issues: string; nextSteps: string; createdBy: string };

const sydDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short" });

// The client's Weekly status tab: the account manager's held calls, newest
// first — summary, next steps the client ticks off, next call. A call that
// didn't happen is just "No call this week" for the client; the team also
// sees the reason, outcome and internal notes.
export default function WeeklyStatusPanel({
  calls,
  nextCall,
  canTick,
  seenByClient,
  onToggle,
  onLogCall,
  earlier,
}: {
  calls: StatusCall[];
  nextCall: string | null;
  canTick: boolean;
  seenByClient: boolean | null; // team only: has a client login opened the tab since the latest call
  onToggle?: (meetingId: string, index: number, done: boolean) => Promise<void>;
  onLogCall?: () => Promise<void>;
  earlier: EarlierUpdate[];
}) {
  const [done, setDone] = useState<Record<string, number[]>>(() => Object.fromEntries(calls.map((c) => [c.id, c.stepsDone])));
  const [error, setError] = useState<string | null>(null);
  const latestHeld = calls.find((c) => c.status === "HELD")?.id;

  async function tick(id: string, i: number, on: boolean) {
    const before = done[id] ?? [];
    setDone((d) => ({ ...d, [id]: on ? [...before, i] : before.filter((x) => x !== i) }));
    setError(null);
    try {
      await onToggle!(id, i, on);
    } catch (e) {
      setDone((d) => ({ ...d, [id]: before }));
      setError(e instanceof Error ? e.message : "Couldn't save");
    }
  }

  return (
    <div className="space-y-5 max-w-[900px]">
      <div className="card rounded-2xl p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="icon-chip w-9 h-9" style={{ background: "var(--primary-tint)" }}>
            <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--primary)" }}>event</span>
          </span>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{nextCall ? `Next call: ${nextCall}` : "No call scheduled yet"}</p>
        </div>
        {onLogCall && (
          <form action={onLogCall}>
            <button className="btn-gradient px-4 py-2 rounded-lg text-sm font-bold">Log call</button>
          </form>
        )}
      </div>
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}

      {calls.length === 0 && earlier.length === 0 && (
        <div className="card rounded-2xl p-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>Your weekly updates will show here after each call.</div>
      )}

      {calls.map((c) => {
        const latest = c.id === latestHeld;
        return (
          <div key={c.id} className="card rounded-2xl p-5 space-y-3" style={latest ? { border: "2px solid var(--primary)" } : undefined}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {sydDate(c.weekOf)}
                {c.amName && <span className="font-normal" style={{ color: "var(--text-muted)" }}> · {c.amName}</span>}
              </p>
              <div className="flex items-center gap-2">
                {latest && seenByClient != null && (
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{seenByClient ? "Seen by client" : "Not seen by client yet"}</span>
                )}
                {latest && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: "var(--primary-tint)", color: "var(--primary)" }}>Latest update</span>
                )}
              </div>
            </div>

            {c.status === "NOT_HELD" ? (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No call this week{c.internal?.reason ? ` — ${c.internal.reason}` : ""}</p>
            ) : (
              <>
                {c.summary && <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{c.summary}</p>}
                {c.steps.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold" style={{ color: "var(--text-muted)" }}>NEXT STEPS</p>
                    {c.steps.map((s, i) => {
                      const on = (done[c.id] ?? []).includes(i);
                      return (
                        <label key={i} className="flex items-start gap-2 text-sm" style={{ color: on ? "var(--text-muted)" : "var(--text-primary)" }}>
                          <input type="checkbox" className="mt-1" checked={on} disabled={!canTick} onChange={(e) => tick(c.id, i, e.target.checked)} />
                          <span style={{ textDecoration: on ? "line-through" : undefined }}>{s}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {c.nextMeetingAt && <p className="text-xs" style={{ color: "var(--text-muted)" }}>Next call: {sydDate(c.nextMeetingAt)}</p>}
              </>
            )}

            {c.internal && (c.internal.notes || c.internal.outcome) && (
              <div className="rounded-xl p-3 text-sm" style={{ background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }}>
                <p className="text-xs font-bold mb-1">Internal — not visible to client</p>
                {c.internal.outcome && <p>Outcome: {c.internal.outcome}</p>}
                {c.internal.notes && <p className="whitespace-pre-wrap">{c.internal.notes}</p>}
              </div>
            )}
          </div>
        );
      })}

      {earlier.length > 0 && (
        <div className="card rounded-2xl p-5 space-y-4">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Earlier weekly updates</p>
          {earlier.map((u) => (
            <div key={u.id} className="text-sm space-y-1" style={{ color: "var(--text-secondary)" }}>
              <p className="text-xs font-bold" style={{ color: "var(--text-muted)" }}>Week of {sydDate(u.weekOf)} · {u.createdBy}</p>
              {([["Wins", u.wins], ["Issues", u.issues], ["Next steps", u.nextSteps]] as const).map(([label, text]) =>
                text.trim() ? <p key={label} className="whitespace-pre-wrap"><b>{label}:</b> {text}</p> : null
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
