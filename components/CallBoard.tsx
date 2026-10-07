"use client";

import { Fragment, useState } from "react";
import type { Health } from "@/lib/client-health";
import ClientCallsDropdown from "@/components/ClientCallsDropdown";
import { openCallPanel } from "@/lib/url-param";

export type BoardRow = {
  id: string;
  name: string;
  slug: string;
  am: string | null;
  callDay: string; // "FRIDAY"
  callTime: string;
  next: { id: string; at: string } | null;
  overdue: { id: string; at: string } | null; // oldest call past its time, not logged
  notes: number; // logged calls with notes
  health: Health;
};

const DOT = { ON_TRACK: { color: "#22c55e", label: "On track" }, AT_RISK: { color: "#eab308", label: "At risk" }, CRITICAL: { color: "#ef4444", label: "Critical" } } as const;
const DAY_TAG: Record<string, string> = { MONDAY: "indigo", TUESDAY: "teal", WEDNESDAY: "amber", THURSDAY: "green", FRIDAY: "pink", SATURDAY: "purple", SUNDAY: "purple" };
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// The Dashboard's call board — the ClickUp list, built in: each active client
// with their account manager, next call (the due date; red when one's overdue
// and not logged), health, regular call day and how many calls have notes.
// A row opens the client's calls inline; the due date opens the call itself.
export default function CallBoard({ rows }: { rows: BoardRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const th = "py-2.5 px-3 text-xs font-bold whitespace-nowrap";
  return (
    <div className="card rounded-2xl overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[860px]">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            <th className={th}>Client</th>
            <th className={th}>Account manager</th>
            <th className={th}>Due date</th>
            <th className={th}>Client health</th>
            <th className={th}>1:1 call day</th>
            <th className={th}>Call notes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-8 text-center" style={{ color: "var(--text-muted)" }}>No active clients with an account manager yet.</td></tr>
          )}
          {rows.map((r) => {
            const due = r.overdue ?? r.next;
            const tag = DAY_TAG[r.callDay] ?? "indigo";
            return (
              <Fragment key={r.id}>
                <tr className="cursor-pointer" style={{ borderBottom: "1px solid var(--border)" }} onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                  <td className="py-2.5 px-3 font-medium whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                    <span className="material-symbols-outlined text-[16px] align-middle mr-2" style={{ color: r.overdue ? "var(--danger)" : "var(--text-muted)" }}>{r.overdue ? "error" : "radio_button_unchecked"}</span>
                    {r.name}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap" style={{ color: r.am ? "var(--text-secondary)" : "var(--text-muted)" }}>{r.am ?? "—"}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {due ? (
                      <button
                        type="button"
                        onClick={(e) => (e.stopPropagation(), openCallPanel(due.id))}
                        className="text-sm font-semibold hover:underline"
                        style={{ color: r.overdue ? "var(--danger)" : "var(--text-primary)" }}
                        title={r.overdue ? "Past its time and not logged — open to update" : "Open the call"}
                      >
                        {when(due.at)}
                        {r.overdue && " · overdue"}
                      </button>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>Not booked</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }} title={r.health.reasons.join(" · ") || "No warning signs"}>
                      <span className="w-3 h-3 rounded-full" style={{ background: DOT[r.health.effective].color }} />
                      {DOT[r.health.effective].label}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold" style={{ background: `var(--tag-${tag}-bg)`, color: `var(--tag-${tag}-fg)` }}>
                      {r.callDay} {r.callTime}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                    <span className="material-symbols-outlined text-[16px] align-middle mr-1" style={{ color: "var(--text-muted)" }}>chat_bubble</span>
                    {r.notes}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--text-muted)" }}>{open === r.id ? "expand_less" : "expand_more"}</span>
                  </td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td colSpan={7} className="pb-2">
                      <ClientCallsDropdown clientId={r.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
