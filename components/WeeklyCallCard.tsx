"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import CallSlotEditor, { type Slot } from "@/components/CallSlotEditor";
import { StatusChip } from "@/components/ClientCallsDropdown";
import { openCallPanel } from "@/lib/url-param";

type Call = { id: string; scheduledAt: string; status: string; outcome: string | null };

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// A client's account management on their Weekly status tab (team): the
// account manager + regular slot and the health override (coaches change
// them), and the recent calls — each opens the update panel.
export default function WeeklyCallCard({
  clientId,
  slot,
  health,
  team,
  calls,
  onSaveSlot,
  onSaveHealth,
}: {
  clientId: string;
  slot: Slot;
  health: string | null; // manual override (lib/client-health.ts); null = computed
  team: { id: string; name: string }[] | null; // null = can't change (agents)
  calls: Call[];
  onSaveSlot: (clientId: string, slot: Slot) => Promise<void>;
  onSaveHealth: (clientId: string, health: string | null) => Promise<void>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const select = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };

  return (
    <div className="card rounded-2xl p-5 space-y-3">
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Account management</p>
      {team ? (
        <>
          <CallSlotEditor clientId={clientId} initial={slot} team={team} onSave={onSaveSlot} />
          <select
            defaultValue={health ?? ""}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value || null;
              setError(null);
              startTransition(async () => {
                try {
                  await onSaveHealth(clientId, v);
                  router.refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Couldn't save");
                }
              });
            }}
            className="w-full px-2 py-1.5 rounded-lg text-xs outline-none"
            style={select}
            aria-label="Health override"
          >
            <option value="">Health: computed</option>
            <option value="ON_TRACK">Health: On track (override)</option>
            <option value="AT_RISK">Health: At risk (override)</option>
            <option value="CRITICAL">Health: Critical (override)</option>
          </select>
        </>
      ) : (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{slot.callFrequency === "FORTNIGHTLY" ? "Every 2nd" : "Every"} {slot.callDay.charAt(0) + slot.callDay.slice(1, 3).toLowerCase()} {slot.callTime}</p>
      )}
      {calls.length ? (
        <div className="space-y-1">
          {calls.map((c) => (
            <button key={c.id} type="button" onClick={() => openCallPanel(c.id)} className="w-full flex items-center justify-between text-xs py-1 text-left">
              <span style={{ color: "var(--text-primary)" }}>{when(c.scheduledAt)}</span>
              <span className="flex items-center gap-1.5">
                {c.outcome && <span style={{ color: "var(--text-muted)" }}>{c.outcome}</span>}
                <StatusChip status={c.status} scheduledAt={c.scheduledAt} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{slot.accountManagerId ? "The next call is booked within the hour." : "Pick an account manager to start booking calls."}</p>
      )}
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
