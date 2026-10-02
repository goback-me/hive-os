"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AlertRow, { type AlertItem } from "@/components/AlertRow";

// Sidebar bell (coaches / admins): open data alerts, red count, polled every
// 60s. The dropdown groups them by client, most serious first.
export default function AlertBell() {
  const [count, setCount] = useState<{ open: number; danger: number } | null>(null);
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
    if (next)
      fetch("/api/alerts")
        .then((r) => r.json())
        .then((d) => !d.error && setAlerts(d.alerts))
        .catch(() => {});
  }

  const groups = new Map<string, AlertItem[]>();
  for (const a of alerts ?? []) groups.set(a.clientName, [...(groups.get(a.clientName) ?? []), a]);
  // Clients with something serious first.
  const ordered = Array.from(groups.entries()).sort(([, a], [, b]) => Number(b.some((x) => x.severity === "DANGER")) - Number(a.some((x) => x.severity === "DANGER")));

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className="relative w-9 h-9 rounded-lg flex items-center justify-center" style={{ color: "var(--text-secondary)" }} aria-label={`Data alerts${count?.open ? `: ${count.open} open` : ""}`}>
        <span className="material-symbols-outlined">notifications</span>
        {!!count?.open && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: "var(--danger)", color: "#fff" }}>
            {count.open > 99 ? "99+" : count.open}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute left-0 top-11 z-[60] w-[420px] max-h-[70vh] overflow-y-auto rounded-xl p-4"
          style={{ background: "var(--surface-card)", border: "1px solid var(--border)", boxShadow: "0 20px 40px -16px rgba(0,0,0,0.3)" }}
        >
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
        </div>
      )}
    </div>
  );
}
