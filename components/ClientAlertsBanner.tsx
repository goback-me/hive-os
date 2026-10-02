"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import AlertRow, { type AlertItem } from "@/components/AlertRow";

// Client page, coaches only: this client's open data alerts, with Fix /
// Mark handled per alert and a Re-check that runs the health checks now.
export default function ClientAlertsBanner({
  clientId,
  initial,
  onRecheck,
}: {
  clientId: string;
  initial: AlertItem[];
  onRecheck: (clientId: string) => Promise<{ open: number }>;
}) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initial);
  const [expanded, setExpanded] = useState(initial.some((a) => a.severity === "DANGER"));
  const [pending, startTransition] = useTransition();
  const danger = alerts.some((a) => a.severity === "DANGER");

  function recheck() {
    startTransition(async () => {
      await onRecheck(clientId);
      const d = await fetch(`/api/alerts?clientId=${clientId}`).then((r) => r.json());
      if (!d.error) setAlerts(d.alerts);
      router.refresh();
    });
  }

  return (
    <div
      className="rounded-2xl p-4 mb-6"
      style={{
        background: !alerts.length ? "var(--surface-hover)" : danger ? "var(--danger-tint)" : "var(--tag-amber-bg)",
        border: `1px solid ${!alerts.length ? "var(--border)" : danger ? "var(--danger)" : "var(--tag-amber-fg)"}`,
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={() => setExpanded((e) => !e)} className="flex items-center gap-2 text-sm font-semibold text-left" style={{ color: "var(--text-primary)" }} disabled={!alerts.length}>
          <span className="material-symbols-outlined text-[18px]" style={{ color: !alerts.length ? "var(--tag-green-fg)" : danger ? "var(--danger)" : "var(--tag-amber-fg)" }}>
            {!alerts.length ? "check_circle" : danger ? "error" : "warning"}
          </span>
          {!alerts.length ? "No data problems" : `${alerts.length} data ${alerts.length === 1 ? "problem" : "problems"} for this client`}
          {danger && <span className="text-xs font-normal" style={{ color: "var(--text-secondary)" }}>— client reports may be paused</span>}
          {!!alerts.length && <span className="material-symbols-outlined text-[16px]">{expanded ? "expand_less" : "expand_more"}</span>}
        </button>
        <button onClick={recheck} disabled={pending} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50" style={{ border: "1px solid var(--border)", color: "var(--text-primary)", background: "var(--surface-card)" }}>
          {pending ? "Checking…" : "Re-check"}
        </button>
      </div>
      {expanded && alerts.length > 0 && (
        <div className="mt-2 rounded-xl px-3" style={{ background: "var(--surface-card)" }}>
          {alerts.map((a) => (
            <AlertRow key={a.id} alert={a} onHandled={(id) => setAlerts((prev) => prev.filter((x) => x.id !== id))} />
          ))}
        </div>
      )}
    </div>
  );
}
