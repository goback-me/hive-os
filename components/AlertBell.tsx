"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AlertRow, { type AlertItem } from "@/components/AlertRow";
import { openCallPanel } from "@/lib/url-param";

type CallDue = { id: string; clientName: string; scheduledAt: string };
const callWhen = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Sidebar bell (the team), polled every 60s: my calls a day+ past that still
// need an update (each opens its panel), then — coaches / admins — open data
// alerts grouped by client, most serious first. Red count = both.
export default function AlertBell({ showAlerts = true }: { showAlerts?: boolean }) {
  const [count, setCount] = useState<{ open: number; danger: number; calls: CallDue[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  function loadCount() {
    fetch("/api/alerts/count")
      .then((r) => r.json())
      .then((d) => !d.error && setCount(d))
      .catch(() => {});
  }
  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && showAlerts)
      fetch("/api/alerts")
        .then((r) => r.json())
        .then((d) => !d.error && setAlerts(d.alerts))
        .catch(() => {});
  }

  const total = (count?.open ?? 0) + (count?.calls.length ?? 0);
  const groups = new Map<string, AlertItem[]>();
  for (const a of alerts ?? []) groups.set(a.clientName, [...(groups.get(a.clientName) ?? []), a]);
  // Clients with something serious first.
  const ordered = Array.from(groups.entries()).sort(([, a], [, b]) => Number(b.some((x) => x.severity === "DANGER")) - Number(a.some((x) => x.severity === "DANGER")));

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className="relative w-9 h-9 rounded-lg flex items-center justify-center" style={{ color: "var(--text-secondary)" }} aria-label={`Notifications${total ? `: ${total}` : ""}`}>
        <span className="material-symbols-outlined">notifications</span>
        {!!total && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: "var(--danger)", color: "#fff" }}>
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute left-0 top-11 z-[60] w-[420px] max-h-[70vh] overflow-y-auto rounded-xl p-4"
          style={{ background: "var(--surface-card)", border: "1px solid var(--border)", boxShadow: "0 20px 40px -16px rgba(0,0,0,0.3)" }}
        >
          {!!count?.calls.length && (
            <div className="mb-4">
              <p className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Calls to update</p>
              {count.calls.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => (setOpen(false), openCallPanel(c.id))}
                  className="w-full text-left py-2 flex items-center justify-between text-xs"
                  style={{ borderBottom: "1px solid var(--border)", color: "var(--text-primary)" }}
                >
                  <span>How did your call with <b>{c.clientName}</b> on {callWhen(c.scheduledAt)} go?</span>
                  <span className="font-bold shrink-0 ml-2" style={{ color: "var(--primary)" }}>Update</span>
                </button>
              ))}
            </div>
          )}
          {!showAlerts ? (
            !count?.calls.length && <p className="text-sm py-6 text-center" style={{ color: "var(--text-secondary)" }}>Nothing needs you right now.</p>
          ) : (
          <>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Data alerts</p>
            <Link href="/alerts" onClick={() => setOpen(false)} className="text-xs font-bold" style={{ color: "var(--primary)" }}>View all →</Link>
          </div>
          {!alerts ? (
            <span className="skeleton h-16 w-full block" />
          ) : alerts.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: "var(--text-secondary)" }}>All clear — no open data problems.</p>
          ) : (
            ordered.map(([client, items]) => (
              <div key={client} className="mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wide mt-2" style={{ color: "var(--text-muted)" }}>{client}</p>
                {items.map((a) => (
                  <AlertRow
                    key={a.id}
                    alert={a}
                    onHandled={(id) => {
                      setAlerts((prev) => prev?.filter((x) => x.id !== id) ?? null);
                      loadCount();
                    }}
                  />
                ))}
              </div>
            ))
          )}
          </>
          )}
        </div>
      )}
    </div>
  );
}
