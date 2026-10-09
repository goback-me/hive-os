"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CLIENT_TABS, VISIBILITY_KEYS, VISIBILITY_LABELS, type ReportVisibility } from "@/lib/report-visibility";

// Coach-only: what this client's own login sees in their reports. Each
// toggle saves straight away; the server strips hidden data for the client.
export default function ReportVisibilityCard({
  clientId,
  initial,
  onSave,
  initialHiddenTabs,
  onSaveTabs,
}: {
  clientId: string;
  initial: ReportVisibility;
  onSave: (clientId: string, flags: Partial<ReportVisibility>) => Promise<ReportVisibility>;
  initialHiddenTabs: string[];
  onSaveTabs: (clientId: string, hiddenTabs: string[]) => Promise<void>;
}) {
  const router = useRouter();
  const [flags, setFlags] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [hiddenTabs, setHiddenTabs] = useState(initialHiddenTabs);

  function toggleTab(key: string) {
    const prev = hiddenTabs;
    const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    setHiddenTabs(next); // optimistic
    setError(null);
    startTransition(async () => {
      try {
        await onSaveTabs(clientId, next);
      } catch (e) {
        setHiddenTabs(prev);
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  function toggle(key: keyof ReportVisibility) {
    const prev = flags;
    const next = { ...flags, [key]: !flags[key] };
    setFlags(next); // optimistic
    setError(null);
    startTransition(async () => {
      try {
        setFlags(await onSave(clientId, { [key]: next[key] }));
        router.refresh(); // badges on the page follow the new settings
      } catch (e) {
        setFlags(prev);
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex justify-between items-center mb-1">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Client view settings</p>
        {pending && <span className="material-symbols-outlined text-[16px] animate-spin" style={{ color: "var(--text-muted)" }}>progress_activity</span>}
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>What this client sees when they log in. You always see everything.</p>
      <div className="space-y-3">
        {VISIBILITY_KEYS.map((key) => (
          <label key={key} className="flex items-start justify-between gap-3 cursor-pointer">
            <span className="min-w-0">
              <span className="block text-sm font-medium" style={{ color: "var(--text-primary)" }}>{VISIBILITY_LABELS[key].label}</span>
              <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>{VISIBILITY_LABELS[key].hint}</span>
            </span>
            <Switch on={flags[key]} label={`Show ${VISIBILITY_LABELS[key].label} to client`} onClick={() => toggle(key)} />
          </label>
        ))}
      </div>
      <p className="text-[10px] font-bold tracking-wide mt-5 mb-2" style={{ color: "var(--text-muted)" }}>TABS</p>
      <div className="space-y-2">
        {CLIENT_TABS.map((t) => (
          <label key={t.key} className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t.label}</span>
            <Switch on={!hiddenTabs.includes(t.key)} label={`Show the ${t.label} tab to client`} onClick={() => toggleTab(t.key)} />
          </label>
        ))}
      </div>
      {error && <p className="text-xs mt-3" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}

function Switch({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className="relative shrink-0 w-10 h-6 rounded-full transition-colors mt-0.5"
      style={{ background: on ? "var(--primary)" : "var(--border-strong)" }}
    >
      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all shadow" style={{ left: on ? "calc(100% - 22px)" : "2px" }} />
    </button>
  );
}
